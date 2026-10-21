import type { FactoryProject, Recipe, MachineProfile, MachineConfigControl } from "../model/types";
import { parseFactoryProjectJson } from "./factory-json";
import { getRecipeSpecialValue } from "../model/recipe-rules";

export const FINGERPRINT_VERSION = 6;
export interface PlanFingerprints {
  version: typeof FINGERPRINT_VERSION;
  simple: string;
  full: string;
}

/** One representation for incoming plans, old saves and every subsequent save. */
export async function planFingerprints(project: FactoryProject): Promise<PlanFingerprints> {
  const normalized = parseFactoryProjectJson(JSON.stringify(project), { keepMode: false });
  // Dataset refresh replaces game recipe ids and presentation data. References
  // use recipe content, never dataset ids, icons, tooltips or runtime tables.
  const keys = new Map<string, string>();
  const fullKeys = new Map<string, string>();
  for (const recipe of normalized.recipes) {
    const identity = recipeIdentity(recipe);
    keys.set(recipe.id, canonicalJson(identity));
    fullKeys.set(recipe.id, canonicalJson({ identity, settings: recipeSettings(recipe) }));
  }
  const recipeKey = (id: string) => keys.get(id) ?? "missing:" + id;
  const mapNodes = (key: (id: string) => string) =>
    normalized.nodes
      .map((node) => ({
        ...node,
        recipeId: key(node.recipeId),
        ...(node.recipeInputOverrides
          ? { recipeInputOverrides: inputOverrides(node.recipeInputOverrides) }
          : {}),
        ...(node.extraRecipes
          ? {
              extraRecipes: node.extraRecipes.map((extra) => ({
                ...extra,
                recipeId: key(extra.recipeId),
                ...(extra.recipeInputOverrides
                  ? { recipeInputOverrides: inputOverrides(extra.recipeInputOverrides) }
                  : {}),
              })),
            }
          : {}),
      }))
      .sort(byId);
  const simple = {
    nodes: normalized.nodes
      .map((node) => ({
        id: node.id,
        recipeId: recipeKey(node.recipeId),
        extraRecipes: node.extraRecipes?.map((extra) => recipeKey(extra.recipeId)),
      }))
      .sort(byId),
    storages: normalized.storages
      ?.map((storage) => ({ id: storage.id, kind: storage.kind, resourceId: storage.resourceId }))
      .sort(byId),
    edges: normalized.edges
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        resourceKind: edge.resourceKind,
        resourceId: edge.resourceId,
      }))
      .sort((a, b) => compare(canonicalJson(a), canonicalJson(b))),
    primaryView: normalized.primaryView,
  };
  const { id, name, metadata, view, recipes, ...content } = normalized;
  void id;
  void name;
  void metadata;
  void view;
  void recipes;
  const full = {
    ...content,
    nodes: mapNodes((id) => fullKeys.get(id) ?? "missing:" + id),
    recipes: [...new Set(fullKeys.values())].sort(),
    edges: [...normalized.edges].sort(byId),
    storages: normalized.storages ? [...normalized.storages].sort(byId) : [],
  };
  const [simpleHash, fullHash] = await Promise.all([hash(simple), hash(full)]);
  return { version: FINGERPRINT_VERSION, simple: simpleHash, full: fullHash };
}

/** Functional settings distinguish versions without changing basic recipe identity. */
function recipeSettings(recipe: Recipe): unknown {
  return {
    requiredSpecialValue: getRecipeSpecialValue(recipe),
    // The map selects machine behaviour, including the tower/distillery mode.
    recipeMap: recipe.source?.recipeMap,
    minimumTier: recipe.minimumTier,
    maximumTier: recipe.maximumTier,
    availableTiers: recipe.availableTiers,
    machineProfile: profileSettings(recipe.machineProfile),
    machineHandlers: recipe.machineHandlers?.map(({ id, machineConfigControls, ...profile }) => ({
      id,
      ...profileSettings(profile),
      controls: controlSettings(machineConfigControls),
    })),
    machineConfigControls: controlSettings(recipe.machineConfigControls),
    power: recipe.power && { sourceId: recipe.power.sourceId, euPerTick: recipe.power.euPerTick },
  };
}

function inputOverrides(
  overrides: NonNullable<FactoryProject["nodes"][number]["recipeInputOverrides"]>,
) {
  return Object.fromEntries(
    Object.entries(overrides).map(([slot, input]) => [
      slot,
      {
        kind: input.kind,
        id: input.id,
        amount: input.amount,
        consumed: input.consumed !== false,
        optional: input.optional === true,
        alternatives: input.alternatives?.map((alternative) => ({
          kind: alternative.kind,
          id: alternative.id,
          amount: alternative.amount ?? input.amount,
        })),
      },
    ]),
  );
}

function profileSettings(profile: (MachineProfile & { label?: string }) | undefined) {
  if (!profile) return undefined;
  const { notes, label, ...functional } = profile;
  void notes;
  // Handler labels are presentation; ids are retained separately for node references.
  void label;
  return functional;
}

function controlSettings(controls: MachineConfigControl[] | undefined) {
  return controls?.map(({ label, tiers, ...control }) => {
    void label;
    return {
      ...control,
      tiers: tiers.map(({ label, resource, ...tier }) => {
        void label;
        return {
          ...tier,
          resource: { kind: resource.kind, id: resource.id, amount: resource.amount },
        };
      }),
    };
  });
}

function recipeIdentity(recipe: Recipe): unknown {
  const slots = (values: Recipe["inputs"] | Recipe["outputs"]) =>
    values.map((value) => {
      const { kind, id, amount } = value;
      const data = value as unknown as Record<string, unknown>;
      return {
        kind,
        id,
        amount,
        consumed: data.consumed !== false,
        optional: data.optional === true,
        chance: data.chance ?? 1,
        byproduct: data.byproduct === true,
        alternatives: value.alternatives?.map((alternative) => ({
          kind: alternative.kind,
          id: alternative.id,
          amount: alternative.amount ?? amount,
        })),
      };
    });
  return {
    machineType: recipe.machineType,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    specialValue: recipe.specialValue,
    programmedCircuit: recipe.programmedCircuit,
    inputs: slots(recipe.inputs),
    outputs: slots(recipe.outputs),
    // These values affect machine behaviour even on GregTech/legacy recipes.
    // Recipe labels, NEI presentation and regenerated runtime tables stay out.
    metadata: functionalMetadata(recipe),
    ...(recipe.kind && recipe.kind !== "gregtech_machine" && recipe.kind !== "unknown"
      ? { kind: recipe.kind }
      : {}),
  };
}

function functionalMetadata(recipe: Recipe): unknown {
  if (recipe.kind && recipe.kind !== "gregtech_machine" && recipe.kind !== "unknown") {
    return recipe.metadata;
  }
  const metadata = Object.fromEntries(
    ["fusionStartupEu", "eec", "beeLifespan", "cropsNh"]
      .filter((key) => recipe.metadata?.[key] !== undefined)
      .map((key) => [key, recipe.metadata![key]]),
  );
  return Object.keys(metadata).length ? metadata : undefined;
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function byId(a: { id: string }, b: { id: string }): number {
  return compare(a.id, b.id);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}
async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
