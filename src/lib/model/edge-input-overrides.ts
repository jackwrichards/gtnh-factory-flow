import type { FactoryEdge, FactoryProject, ResourceAmount } from "./types";
import { isOreDictionaryResource, isRecipeInputConsumed, resourceMatchesInput } from "./resources";
import { inputOverrideAmount } from "./recipe-input-overrides";
import { sectionHandleId, sectionNodeView, splitSectionHandleId } from "./shared-machine";

type ResourceFace = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor" | "tooltip"
>;

/** A wire chooses the whole resource row, including repeated crafting slots. */
export function applyEdgeInputOverride(
  project: FactoryProject,
  edge: FactoryEdge,
  resource?: ResourceFace,
): FactoryProject {
  if (edge.crossForm) return project;
  // Supplying an entire category does not select one of its members.
  if (isOreDictionaryResource({ id: edge.resourceId })) return project;
  const card = project.nodes.find((node) => node.id === edge.target);
  const { section, handleId } = splitSectionHandleId(edge.targetHandle);
  if (!card || (section > 0 && !card.extraRecipes?.[section - 1])) return project;
  const node = sectionNodeView(card, section);
  const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
  // Generator slots are rebuilt when fuel changes; overrides would outlive it.
  if (!recipe || recipe.power) return project;

  const wired = { kind: edge.resourceKind, id: edge.resourceId };
  const [side, kind, encodedId] = (handleId ?? "").split(":");
  let handleResourceId: string | undefined;
  try {
    handleResourceId = encodedId ? decodeURIComponent(encodedId) : undefined;
  } catch {
    return project;
  }
  const accepts = (input: ResourceAmount) =>
    isRecipeInputConsumed(input) && resourceMatchesInput(wired, input);
  const anchor =
    recipe.inputs.find((input, index) => {
      const current = node.recipeInputOverrides?.[String(index)] ?? input;
      return (
        accepts(input) &&
        side === "input" &&
        kind === input.kind &&
        (input.id === handleResourceId || current.id === handleResourceId)
      );
    }) ??
    recipe.inputs.find(
      (input, index) =>
        accepts(input) &&
        resourceMatchesInput(wired, node.recipeInputOverrides?.[String(index)] ?? input),
    );
  if (!anchor) return project;

  const overrides = { ...node.recipeInputOverrides };
  let changed = false;
  recipe.inputs.forEach((input, index) => {
    if (input.kind !== anchor.kind || input.id !== anchor.id || !accepts(input)) return;
    const old = overrides[String(index)];
    // Separately chosen variants already have their own rows. A wire must not
    // replace those picks just because their original dictionary entry matches.
    if (old && (old.kind !== wired.kind || (old.id !== wired.id && old.id !== handleResourceId)))
      return;
    const alternative = input.alternatives?.find(
      (entry) => entry.kind === wired.kind && entry.id === wired.id,
    );
    const override = {
      ...input,
      ...alternative,
      ...wired,
      // Each slot keeps its own quantity; a merged row's amount is not per slot.
      amount: inputOverrideAmount(input, wired.kind, alternative),
      displayName:
        resource?.displayName ??
        alternative?.displayName ??
        old?.displayName ??
        edge.label ??
        input.displayName,
      iconPath: resource?.iconPath ?? alternative?.iconPath ?? old?.iconPath ?? input.iconPath,
      iconAtlas: resource?.iconAtlas ?? alternative?.iconAtlas ?? old?.iconAtlas ?? input.iconAtlas,
      dominantColor:
        resource?.dominantColor ??
        alternative?.dominantColor ??
        old?.dominantColor ??
        input.dominantColor,
      tooltip:
        resource?.tooltip ?? alternative?.tooltip ?? (alternative ? undefined : input.tooltip),
      alternatives: undefined,
    };
    if (JSON.stringify(old) !== JSON.stringify(override)) {
      overrides[String(index)] = override;
      changed = true;
    }
  });
  // Once the row is concrete the old dictionary handle no longer exists.
  // Re-dock the wire as part of the same edit (also repairs legacy saves).
  const targetHandle = sectionHandleId(
    section,
    `input:${wired.kind}:${encodeURIComponent(wired.id)}`,
  );
  const hasWiredRow = recipe.inputs.some((input, index) => {
    const current = overrides[String(index)] ?? input;
    return isRecipeInputConsumed(input) && current.kind === wired.kind && current.id === wired.id;
  });
  const redock = hasWiredRow && handleResourceId !== wired.id;
  if (!changed && !redock) return project;
  return {
    ...project,
    edges: redock
      ? project.edges.map((entry) => (entry.id === edge.id ? { ...entry, targetHandle } : entry))
      : project.edges,
    nodes: !changed
      ? project.nodes
      : project.nodes.map((entry) =>
          entry !== card
            ? entry
            : section === 0
              ? { ...entry, recipeInputOverrides: overrides }
              : {
                  ...entry,
                  extraRecipes: entry.extraRecipes?.map((extra, index) =>
                    index === section - 1 ? { ...extra, recipeInputOverrides: overrides } : extra,
                  ),
                },
        ),
  };
}

/** Old saves stamped just the first slot of a wired crafting ingredient. */
export function repairWiredInputOverrides(project: FactoryProject): FactoryProject {
  return project.edges.reduce((next, edge) => {
    const card = next.nodes.find((node) => node.id === edge.target);
    if (!card) return next;
    const node = sectionNodeView(card, splitSectionHandleId(edge.targetHandle).section);
    const recipe = next.recipes.find((entry) => entry.id === node.recipeId);
    const matching = recipe?.inputs.filter(
      (input) =>
        isRecipeInputConsumed(input) &&
        resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, input),
    );
    const hasPick = Object.values(node.recipeInputOverrides ?? {}).some(
      (input) => input.kind === edge.resourceKind && input.id === edge.resourceId,
    );
    return matching && (matching.length > 1 || hasPick) ? applyEdgeInputOverride(next, edge) : next;
  }, project);
}
