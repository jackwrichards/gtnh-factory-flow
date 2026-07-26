import type { Recipe, ResourceIconAtlasRef, ResourceKind } from "@/lib/model/types";

/**
 * The gap solver's view of a resource. `stockpileId` survives the round trip so
 * the materializer can wire a supply edge back to the drawer that offered it.
 */
export interface PlannerResource {
  kind: ResourceKind;
  id: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  stockpileId?: string;
}

export interface GapSolveTarget extends PlannerResource {
  amountPerSecond: number;
}

/** Something the current plan already makes; tapping it beats building anew. */
export interface ExistingProduction extends PlannerResource {
  nodeId: string;
  availablePerSecond: number;
}

export interface GapSolveOptions {
  /** How many producer candidates to weigh per resource. */
  beamWidth?: number;
  maxDepth?: number;
  maxSteps?: number;
  planCount?: number;
  /** Index into GT_VOLTAGE_TIERS; recipes above it are ignored. */
  maxTierIndex?: number;
  /** Global cap on producer lookups, so a hostile chain cannot run away. */
  expansionBudget?: number;
}

export interface GapSolveRequest {
  target: GapSolveTarget;
  supply: PlannerResource[];
  existingOutputs?: ExistingProduction[];
  options?: GapSolveOptions;
}

/**
 * What the solver needs to know about a recipe. Recipe and RecipeSummary both
 * satisfy it, so the same solver runs against fixtures and the dataset alike.
 */
export type SolverRecipe = Pick<
  Recipe,
  | "id"
  | "name"
  | "machineType"
  | "minimumTier"
  | "durationTicks"
  | "eut"
  | "inputs"
  | "outputs"
> & {
  recipeMap?: string;
  source?: { recipeMap?: string };
};

export interface RecipeProducerLookup {
  getProducers(resource: PlannerResource): Promise<SolverRecipe[]> | SolverRecipe[];
}

export type StepInputSource =
  | { type: "supply"; resource: PlannerResource }
  | { type: "step"; stepIndex: number; outputKey: string; resource: PlannerResource }
  | { type: "existing"; nodeId: string; resource: PlannerResource }
  | { type: "missing"; resource: PlannerResource };

export interface GapFillStepInput {
  /** Index into `recipe.inputs`. */
  inputIndex: number;
  ratePerSecond: number;
  source: StepInputSource;
}

export interface GapFillStep<TRecipe extends SolverRecipe = SolverRecipe> {
  recipe: TRecipe;
  operationsPerSecond: number;
  machineCount: number;
  inputs: GapFillStepInput[];
}

export interface GapFillPlanStats {
  stepCount: number;
  machineCount: number;
  maxTierIndex: number;
  totalEuT: number;
  supplyDraws: Array<PlannerResource & { ratePerSecond: number }>;
  existingDraws: Array<PlannerResource & { nodeId: string; ratePerSecond: number }>;
}

export interface GapFillPlan<TRecipe extends SolverRecipe = SolverRecipe> {
  id: string;
  label: string;
  closed: boolean;
  missing: PlannerResource[];
  /** Step 0 produces the target; the rest were pulled in as its dependencies. */
  steps: Array<GapFillStep<TRecipe>>;
  stats: GapFillPlanStats;
}

export interface GapSolveResult<TRecipe extends SolverRecipe = SolverRecipe> {
  plans: Array<GapFillPlan<TRecipe>>;
  notes: string[];
}

export interface GapSolveHooks {
  /** Fires as the solver starts exploring each candidate root. */
  onPlanStart?: (rootName: string, planIndex: number) => void;
}

/**
 * A heartbeat from a running solve, streamed to whoever is waiting so the
 * spinner can say what is actually happening instead of just spinning.
 */
export interface GapSolveProgress {
  stage: "indexing" | "exploring" | "hydrating";
  /** Producer lookups performed so far. */
  lookups?: number;
  /** The resource currently being expanded. */
  resource?: string;
  planLabel?: string;
  planIndex?: number;
}
