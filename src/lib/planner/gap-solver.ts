import {
  getChanceMultiplier,
  getResourceKey,
  isRecipeInputConsumed,
  resourceLabel,
} from "@/lib/model/resources";
import { plannerResourceSatisfiesInput } from "./resource-matching";
import { GT_VOLTAGE_TIERS, getVoltageTierForEuT } from "@/lib/model/tiers";
import type { MachineTier, RecipeInput, RecipeOutput } from "@/lib/model/types";
import { TICKS_PER_SECOND } from "@/lib/model/types";
import type {
  ExistingProduction,
  GapFillPlan,
  GapFillStep,
  GapFillStepInput,
  GapSolveHooks,
  GapSolveRequest,
  GapSolveResult,
  PlannerResource,
  RecipeProducerLookup,
  SolverRecipe,
  StepInputSource,
} from "./types";

const DEFAULT_BEAM_WIDTH = 5;
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_STEPS = 40;
const DEFAULT_PLAN_COUNT = 3;
const DEFAULT_EXPANSION_BUDGET = 400;
const RATE_EPSILON = 0.000001;

/**
 * Recipe maps that only shuffle a resource between shapes (nuggets, blocks,
 * scanning copies, recycling loops). Chaining through them never gets a plan
 * closer to raw supply, but they produce nearly everything, so an unguarded
 * backward search drowns in them.
 */
const DEGENERATE_MAP_PATTERNS = [
  "packag",
  "packer",
  "unpack",
  "scanner",
  "replicat",
  "recycl",
  "disassembl",
];

interface DraftInputLink {
  inputIndex: number;
  input: RecipeInput;
  source: StepInputSource;
}

interface DraftStep {
  recipe: SolverRecipe;
  links: DraftInputLink[];
}

interface DraftState {
  steps: DraftStep[];
  producerByKey: Map<string, { stepIndex: number; outputKey: string }>;
  missing: Map<string, PlannerResource>;
}

interface DraftSnapshot {
  stepCount: number;
  producerByKey: Map<string, { stepIndex: number; outputKey: string }>;
  missing: Map<string, PlannerResource>;
}

interface SolveContext {
  supply: PlannerResource[];
  existing: ExistingProduction[];
  beamWidth: number;
  maxDepth: number;
  maxSteps: number;
  maxTierIndex?: number;
  allowedRecipeMaps?: Set<string>;
  budget: { remaining: number };
  getProducers: (resource: PlannerResource) => Promise<SolverRecipe[]>;
}

export async function solveGapFill(
  request: GapSolveRequest,
  lookup: RecipeProducerLookup,
  hooks: GapSolveHooks = {},
): Promise<GapSolveResult> {
  const options = request.options ?? {};
  const producerCache = new Map<string, Promise<SolverRecipe[]>>();
  const context: SolveContext = {
    supply: request.supply,
    existing: request.existingOutputs ?? [],
    beamWidth: options.beamWidth ?? DEFAULT_BEAM_WIDTH,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    maxTierIndex: options.maxTierIndex,
    allowedRecipeMaps: options.allowedRecipeMaps
      ? new Set(options.allowedRecipeMaps.map((name) => name.trim().toLowerCase()))
      : undefined,
    budget: { remaining: options.expansionBudget ?? DEFAULT_EXPANSION_BUDGET },
    getProducers: (resource) => {
      const key = getResourceKey(resource);
      const cached = producerCache.get(key);
      if (cached) {
        return cached;
      }

      const pending = Promise.resolve(lookup.getProducers(resource)).catch(() => []);
      producerCache.set(key, pending);
      return pending;
    },
  };

  const notes: string[] = [];
  const targetLabel = resourceLabel({
    id: request.target.id,
    displayName: request.target.displayName,
  });
  if (context.supply.some((entry) => matchesConcreteResource(entry, request.target))) {
    notes.push(`${targetLabel} is already in your stockpile.`);
  }

  const plans: GapFillPlan[] = [];

  const existingTarget = pickExistingProducer(context.existing, request.target);
  if (existingTarget) {
    plans.push(buildExistingTapPlan(request, existingTarget, plans.length));
  }

  context.budget.remaining -= 1;
  const rootCandidates = rankProducers(
    await context.getProducers(request.target),
    asPseudoInput(request.target),
    new Set<string>(),
    new Set<number>(),
    emptyDraft(),
    context,
  );

  const planCount = options.planCount ?? DEFAULT_PLAN_COUNT;
  const seenRootIds = new Set<string>();
  // Recipe families repeat one name across log types and circuit configs;
  // offering "via Pyrolyse Oven: Charcoal" three times is no choice at all.
  const seenRootNames = new Set<string>();
  for (const root of rootCandidates) {
    if (plans.length >= planCount + (existingTarget ? 1 : 0)) {
      break;
    }
    if (seenRootIds.has(root.id) || seenRootNames.has(root.name)) {
      continue;
    }
    seenRootIds.add(root.id);
    seenRootNames.add(root.name);

    hooks.onPlanStart?.(root.name, plans.length);
    const plan = await buildPlanForRoot(request, root, plans.length, context);
    if (plan) {
      plans.push(plan);
    }
  }

  if (rootCandidates.length === 0 && !existingTarget) {
    notes.push(`No recipe in this dataset produces ${targetLabel} within the tier limit.`);
  }

  plans.sort(
    (left, right) =>
      Number(right.closed) - Number(left.closed) ||
      left.missing.length - right.missing.length ||
      left.stats.machineCount - right.stats.machineCount ||
      left.stats.maxTierIndex - right.stats.maxTierIndex,
  );

  return { plans, notes };
}

async function buildPlanForRoot(
  request: GapSolveRequest,
  root: SolverRecipe,
  planIndex: number,
  context: SolveContext,
): Promise<GapFillPlan | undefined> {
  const state = emptyDraft();
  const source = await commitCandidate(
    root,
    asPseudoInput(request.target),
    new Set<string>(),
    new Set<number>(),
    0,
    state,
    context,
  );
  if (source.type !== "step") {
    return undefined;
  }

  const steps = computeRates(state, request, source.outputKey);
  const missing = [...state.missing.values()];

  return {
    id: `plan-${planIndex + 1}`,
    label: `via ${root.name}`,
    closed: missing.length === 0,
    missing,
    steps,
    stats: buildStats(steps),
  };
}

function buildExistingTapPlan(
  request: GapSolveRequest,
  existing: ExistingProduction,
  planIndex: number,
): GapFillPlan {
  const draw = {
    kind: existing.kind,
    id: existing.id,
    displayName: existing.displayName,
    iconPath: existing.iconPath,
    iconAtlas: existing.iconAtlas,
    dominantColor: existing.dominantColor,
    nodeId: existing.nodeId,
    ratePerSecond: request.target.amountPerSecond,
  };

  return {
    id: `plan-${planIndex + 1}`,
    label: "Tap what you already make",
    closed: true,
    missing: [],
    steps: [],
    stats: {
      stepCount: 0,
      machineCount: 0,
      maxTierIndex: 0,
      totalEuT: 0,
      supplyDraws: [],
      existingDraws: [draw],
    },
  };
}

function emptyDraft(): DraftState {
  return { steps: [], producerByKey: new Map(), missing: new Map() };
}

function snapshot(state: DraftState): DraftSnapshot {
  return {
    stepCount: state.steps.length,
    producerByKey: new Map(state.producerByKey),
    missing: new Map(state.missing),
  };
}

function restore(state: DraftState, saved: DraftSnapshot): void {
  state.steps.length = saved.stepCount;
  state.producerByKey = new Map(saved.producerByKey);
  state.missing = new Map(saved.missing);
}

async function resolveInputSource(
  input: RecipeInput,
  path: Set<string>,
  ancestors: Set<number>,
  depth: number,
  state: DraftState,
  context: SolveContext,
): Promise<StepInputSource> {
  const supplyMatch = context.supply.find((entry) => plannerResourceSatisfiesInput(entry, input));
  if (supplyMatch) {
    return { type: "supply", resource: supplyMatch };
  }

  const existingMatch = pickExistingProducer(context.existing, input);
  if (existingMatch) {
    return {
      type: "existing",
      nodeId: existingMatch.nodeId,
      resource: toPlannerResource(existingMatch),
    };
  }

  const inPlan = findInPlanProducer(state, input, ancestors);
  if (inPlan) {
    return inPlan;
  }

  if (
    depth >= context.maxDepth ||
    state.steps.length >= context.maxSteps ||
    path.has(getResourceKey(input))
  ) {
    return markMissing(input, state);
  }

  return resolveViaProduction(input, path, ancestors, depth, state, context);
}

async function resolveViaProduction(
  input: RecipeInput,
  path: Set<string>,
  ancestors: Set<number>,
  depth: number,
  state: DraftState,
  context: SolveContext,
): Promise<StepInputSource> {
  if (context.budget.remaining <= 0) {
    return markMissing(input, state);
  }

  context.budget.remaining -= 1;
  const candidates = rankProducers(
    await context.getProducers(toPlannerResource(input)),
    input,
    path,
    ancestors,
    state,
    context,
  ).slice(0, context.beamWidth);

  if (candidates.length === 0) {
    return markMissing(input, state);
  }

  const base = snapshot(state);
  let bestCandidate: SolverRecipe | undefined;
  let bestMissingDelta = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    restore(state, base);
    const missingBefore = state.missing.size;
    const source = await commitCandidate(candidate, input, path, ancestors, depth, state, context);
    const missingDelta = state.missing.size - missingBefore;

    if (source.type === "step" && missingDelta === 0) {
      return source;
    }

    if (source.type === "step" && missingDelta < bestMissingDelta) {
      bestMissingDelta = missingDelta;
      bestCandidate = candidate;
    }

    if (context.budget.remaining <= 0) {
      break;
    }
  }

  restore(state, base);
  if (!bestCandidate) {
    return markMissing(input, state);
  }

  return commitCandidate(bestCandidate, input, path, ancestors, depth, state, context);
}

async function commitCandidate(
  recipe: SolverRecipe,
  input: RecipeInput,
  path: Set<string>,
  ancestors: Set<number>,
  depth: number,
  state: DraftState,
  context: SolveContext,
): Promise<StepInputSource> {
  const matched = findMatchingOutput(recipe, input);
  if (!matched) {
    return markMissing(input, state);
  }

  const stepIndex = state.steps.length;
  const step: DraftStep = { recipe, links: [] };
  state.steps.push(step);
  registerOutputs(state, stepIndex, recipe);

  const nextPath = new Set(path);
  nextPath.add(getResourceKey(input));
  nextPath.add(getResourceKey(matched));
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(stepIndex);

  for (const [inputIndex, recipeInput] of recipe.inputs.entries()) {
    if (!isRecipeInputConsumed(recipeInput)) {
      continue;
    }

    const source = await resolveInputSource(
      recipeInput,
      nextPath,
      nextAncestors,
      depth + 1,
      state,
      context,
    );
    step.links.push({ inputIndex, input: recipeInput, source });
  }

  return {
    type: "step",
    stepIndex,
    outputKey: getResourceKey(matched),
    resource: toPlannerResource(matched),
  };
}

function registerOutputs(state: DraftState, stepIndex: number, recipe: SolverRecipe): void {
  for (const output of recipe.outputs) {
    const key = getResourceKey(output);
    if (!state.producerByKey.has(key)) {
      state.producerByKey.set(key, { stepIndex, outputKey: key });
    }
  }
}

/**
 * Finds a step already in the plan whose output covers the input. Ancestor
 * steps â€” the ones currently being expanded above this input â€” are off limits:
 * linking to one closes a loop that feeds itself, the perpetual-motion shape a
 * naive backward search happily "solves". Sibling reuse (one salt electrolyzer
 * feeding both a sodium and a chlorine consumer) stays allowed.
 */
function findInPlanProducer(
  state: DraftState,
  input: RecipeInput,
  ancestors: Set<number>,
): StepInputSource | undefined {
  const direct = state.producerByKey.get(getResourceKey(input));
  if (direct && !ancestors.has(direct.stepIndex)) {
    const output = state.steps[direct.stepIndex]?.recipe.outputs.find(
      (entry) => getResourceKey(entry) === direct.outputKey,
    );
    return {
      type: "step",
      stepIndex: direct.stepIndex,
      outputKey: direct.outputKey,
      resource: output ? toPlannerResource(output) : { kind: input.kind, id: input.id },
    };
  }

  for (const [stepIndex, step] of state.steps.entries()) {
    if (ancestors.has(stepIndex)) {
      continue;
    }

    for (const output of step.recipe.outputs) {
      if (plannerResourceSatisfiesInput(output, input)) {
        return {
          type: "step",
          stepIndex,
          outputKey: getResourceKey(output),
          resource: toPlannerResource(output),
        };
      }
    }
  }

  return undefined;
}

function markMissing(input: RecipeInput, state: DraftState): StepInputSource {
  const key = getResourceKey(input);
  const resource = state.missing.get(key) ?? toPlannerResource(input);
  state.missing.set(key, resource);
  return { type: "missing", resource };
}

function rankProducers(
  producers: SolverRecipe[],
  input: RecipeInput,
  path: Set<string>,
  ancestors: Set<number>,
  state: DraftState,
  context: SolveContext,
): SolverRecipe[] {
  const scored: Array<{ recipe: SolverRecipe; score: number }> = [];

  for (const recipe of producers) {
    if (isDegenerateRecipe(recipe) || !isRecipeMapAllowed(recipe, context.allowedRecipeMaps)) {
      continue;
    }

    const tierIndex = getRecipeTierIndex(recipe);
    if (context.maxTierIndex !== undefined && tierIndex > context.maxTierIndex) {
      continue;
    }

    const matched = findMatchingOutput(recipe, input);
    if (!matched || matched.amount <= 0) {
      continue;
    }

    const matchedKey = getResourceKey(matched);
    const inputKey = getResourceKey(input);
    let unsatisfied = 0;
    let blocked = false;

    for (const candidateInput of recipe.inputs) {
      if (!isRecipeInputConsumed(candidateInput)) {
        continue;
      }

      const candidateKey = getResourceKey(candidateInput);
      // A producer that consumes the very thing it makes is shape-shuffling,
      // not production; committing it would cycle immediately.
      if (candidateKey === matchedKey || candidateKey === inputKey) {
        blocked = true;
        break;
      }

      const quicklyResolvable =
        context.supply.some((entry) => plannerResourceSatisfiesInput(entry, candidateInput)) ||
        Boolean(pickExistingProducer(context.existing, candidateInput)) ||
        Boolean(findInPlanProducer(state, candidateInput, ancestors));

      if (!quicklyResolvable) {
        unsatisfied += 1;
        const cyclePotential =
          path.has(candidateKey) ||
          (candidateInput.alternatives ?? []).some((alternative) =>
            path.has(getResourceKey(alternative)),
          );
        if (cyclePotential) {
          blocked = true;
          break;
        }
      }
    }

    if (blocked) {
      continue;
    }

    const primary = recipe.outputs.find((output) => !output.byproduct) ?? recipe.outputs[0];
    const primaryMatch = primary ? getResourceKey(primary) === matchedKey : false;
    const chancePenalty = matched.chance !== undefined && matched.chance < 1 ? 25 : 0;
    const consumedInputs = recipe.inputs.filter(isRecipeInputConsumed).length;
    const unpackingPenalty = isUnpackingShapedRecipe(recipe, matched) ? 80 : 0;
    const score =
      unsatisfied * 20 +
      tierIndex * 3 +
      (primaryMatch ? 0 : 12) +
      chancePenalty +
      unpackingPenalty +
      consumedInputs +
      recipe.durationTicks / 2000;

    scored.push({ recipe, score });
  }

  return scored
    .sort((left, right) => left.score - right.score || left.recipe.id.localeCompare(right.recipe.id))
    .map((entry) => entry.recipe);
}

function computeRates(
  state: DraftState,
  request: GapSolveRequest,
  rootOutputKey: string,
): GapFillStep[] {
  const stepCount = state.steps.length;
  const opsByStep = new Array<number>(stepCount).fill(0);
  const maxPasses = stepCount + 2;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const demandByStep = new Map<number, Map<string, number>>();
    const addDemand = (stepIndex: number, outputKey: string, amount: number) => {
      const demands = demandByStep.get(stepIndex) ?? new Map<string, number>();
      demands.set(outputKey, (demands.get(outputKey) ?? 0) + amount);
      demandByStep.set(stepIndex, demands);
    };

    addDemand(0, rootOutputKey, request.target.amountPerSecond);
    for (const [stepIndex, step] of state.steps.entries()) {
      const ops = opsByStep[stepIndex];
      if (ops <= RATE_EPSILON) {
        continue;
      }

      for (const link of step.links) {
        if (link.source.type === "step") {
          addDemand(link.source.stepIndex, link.source.outputKey, link.input.amount * ops);
        }
      }
    }

    let changed = false;
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const step = state.steps[stepIndex];
      let requiredOps = 0;
      for (const [outputKey, demandedRate] of demandByStep.get(stepIndex) ?? []) {
        const perOp = outputAmountPerOperation(step.recipe, outputKey);
        if (perOp > RATE_EPSILON) {
          requiredOps = Math.max(requiredOps, demandedRate / perOp);
        }
      }

      if (Math.abs(requiredOps - opsByStep[stepIndex]) > RATE_EPSILON) {
        opsByStep[stepIndex] = requiredOps;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return state.steps.map((step, stepIndex) => {
    const operationsPerSecond = opsByStep[stepIndex];
    const operationsPerMachine = TICKS_PER_SECOND / Math.max(1, step.recipe.durationTicks);
    const inputs: GapFillStepInput[] = step.links.map((link) => ({
      inputIndex: link.inputIndex,
      ratePerSecond: link.input.amount * operationsPerSecond,
      source: link.source,
    }));

    return {
      recipe: step.recipe,
      operationsPerSecond,
      machineCount: Math.max(
        1,
        Math.ceil(operationsPerSecond / operationsPerMachine - RATE_EPSILON),
      ),
      inputs,
    };
  });
}

function buildStats(steps: GapFillStep[]): GapFillPlan["stats"] {
  const supplyDraws = new Map<string, PlannerResource & { ratePerSecond: number }>();
  const existingDraws = new Map<string, PlannerResource & { nodeId: string; ratePerSecond: number }>();
  let machineCount = 0;
  let maxTierIndex = 0;
  let totalEuT = 0;

  for (const step of steps) {
    machineCount += step.machineCount;
    maxTierIndex = Math.max(maxTierIndex, getRecipeTierIndex(step.recipe));
    totalEuT += step.recipe.eut * step.machineCount;

    for (const input of step.inputs) {
      if (input.source.type === "supply") {
        const key = getResourceKey(input.source.resource);
        const existing = supplyDraws.get(key);
        supplyDraws.set(key, {
          ...input.source.resource,
          ratePerSecond: (existing?.ratePerSecond ?? 0) + input.ratePerSecond,
        });
      } else if (input.source.type === "existing") {
        const key = `${input.source.nodeId}|${getResourceKey(input.source.resource)}`;
        const existing = existingDraws.get(key);
        existingDraws.set(key, {
          ...input.source.resource,
          nodeId: input.source.nodeId,
          ratePerSecond: (existing?.ratePerSecond ?? 0) + input.ratePerSecond,
        });
      }
    }
  }

  return {
    stepCount: steps.length,
    machineCount,
    maxTierIndex,
    totalEuT,
    supplyDraws: [...supplyDraws.values()],
    existingDraws: [...existingDraws.values()],
  };
}

function outputAmountPerOperation(recipe: SolverRecipe, outputKey: string): number {
  let amount = 0;
  for (const output of recipe.outputs) {
    if (getResourceKey(output) === outputKey) {
      amount += output.amount * getChanceMultiplier(output);
    }
  }
  return amount;
}

function findMatchingOutput(recipe: SolverRecipe, input: RecipeInput): RecipeOutput | undefined {
  return recipe.outputs.find((output) => plannerResourceSatisfiesInput(output, input));
}

function pickExistingProducer(
  existing: ExistingProduction[],
  input: Pick<RecipeInput, "kind" | "id" | "displayName" | "alternatives">,
): ExistingProduction | undefined {
  return existing
    .filter((entry) => plannerResourceSatisfiesInput(entry, input))
    .sort((left, right) => right.availablePerSecond - left.availablePerSecond)[0];
}

function matchesConcreteResource(entry: PlannerResource, resource: PlannerResource): boolean {
  return entry.kind === resource.kind && entry.id === resource.id;
}

function asPseudoInput(resource: PlannerResource): RecipeInput {
  return {
    kind: resource.kind,
    id: resource.id,
    amount: 1,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor,
  };
}

function toPlannerResource(
  resource: Pick<
    RecipeInput,
    "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
  >,
): PlannerResource {
  return {
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor,
  };
}

function isRecipeMapAllowed(recipe: SolverRecipe, allowed: Set<string> | undefined): boolean {
  if (!allowed) {
    return true;
  }

  const recipeMap = (recipe.recipeMap ?? recipe.source?.recipeMap ?? "").trim().toLowerCase();
  const machineType = recipe.machineType.trim().toLowerCase();
  return (recipeMap.length > 0 && allowed.has(recipeMap)) || allowed.has(machineType);
}

function isDegenerateRecipe(recipe: SolverRecipe): boolean {
  const map = `${recipe.recipeMap ?? recipe.source?.recipeMap ?? ""} ${recipe.machineType}`
    .trim()
    .toLowerCase();
  return DEGENERATE_MAP_PATTERNS.some((pattern) => map.includes(pattern));
}

/**
 * Decompression ladders slip past the map denylist because they live on
 * ordinary machines (Forge Hammer: Block of Charcoal â†’ 9 Charcoal). The shape
 * they share: one consumed input whose name contains the output's name â€” the
 * input IS the output, packed bigger. The reverse direction (Charcoal â†’
 * Charcoal Dust) is real processing and stays untouched. Scored as a heavy
 * penalty rather than banned, so a ladder can still be a last resort.
 */
function isUnpackingShapedRecipe(recipe: SolverRecipe, matched: RecipeOutput): boolean {
  const consumed = recipe.inputs.filter(isRecipeInputConsumed);
  if (consumed.length !== 1) {
    return false;
  }

  const inputLabel = normalizeLabel(resourceLabel(consumed[0]));
  const outputLabel = normalizeLabel(resourceLabel(matched));
  return outputLabel.length > 0 && inputLabel !== outputLabel && inputLabel.includes(outputLabel);
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function getRecipeTierIndex(recipe: Pick<SolverRecipe, "minimumTier" | "eut">): number {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === recipe.minimumTier);
  if (index !== -1) {
    return index;
  }

  const powerTier = getVoltageTierForEuT(recipe.eut);
  return GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === powerTier);
}

export function getTierIndexForFilter(tier: "all" | Exclude<MachineTier, "DEMO">): number | undefined {
  if (tier === "all") {
    return undefined;
  }

  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? undefined : index;
}
