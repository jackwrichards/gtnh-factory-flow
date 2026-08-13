import { makeResourceKey } from "@/lib/model/resources";
import type { FactoryProject, ResourceBalance } from "@/lib/model/types";

/**
 * Outputs are ONE section. Product against byproduct is how a drawer asks its
 * machine (pull flat out, or catch what is left), and the board's tiles wear
 * that difference; to the reader of this panel both are simply what leaves
 * the line, and splitting them made one resource show up twice with neither
 * figure being the answer. The split lasted one day (13551d6) before the
 * players asked for the total back.
 */
export type FlowSectionId = "need" | "gather" | "output" | "internal";

export type FlowSectionTone = FlowSectionId;

export interface FlowSection {
  id: FlowSectionId;
  label: string;
  empty: string;
  tone: FlowSectionTone;
  /** Sign applied to the headline rate. Needs read negative, outputs positive. */
  sign: -1 | 0 | 1;
  items: ResourceBalance[];
  /** Total before the filter was applied, for the "12 / 187" count. */
  totalCount: number;
}

export type FlowRow =
  | { type: "header"; key: string; section: FlowSection; collapsed: boolean }
  | { type: "item"; key: string; section: FlowSection; balance: ResourceBalance }
  // A starred resource carries its chart in the row directly beneath it, so a
  // watched figure and its history read as one block while the list scrolls.
  | { type: "chart"; key: string; section: FlowSection; balance: ResourceBalance }
  | { type: "empty"; key: string; section: FlowSection };

/**
 * Headline rate for a balance, in the terms its section cares about.
 *
 * Needs report what is missing, outputs report what is spare, and internal rows
 * report throughput — three different questions about the same record.
 */
export function getFlowRowValue(section: FlowSectionId, balance: ResourceBalance) {
  switch (section) {
    case "need":
      return balance.deficitPerSecond;
    // What the mining source cards are being asked for: dug by hand, so a
    // demand on the player even though the books call it production.
    case "gather":
      return balance.minedPerSecond;
    // The whole spare figure: product drawers, byproduct drawers and unclaimed
    // surplus are one number, because they are one answer to "how much of this
    // leaves the line".
    case "output":
      return balance.surplusPerSecond;
    case "internal":
    default:
      return balance.consumedPerSecond;
  }
}

/**
 * The NET reading: an item cannot be a need and an output at once.
 *
 * RAW shows both figures - bring 10 in over here, take 4 away over there -
 * which is the honest ledger of the boundary drawers. NET does the
 * subtraction the reader was doing in their head: one signed figure per item,
 * filed under whichever side of the boundary the sign says. It is arithmetic
 * on the totals the panel already shows, never a claim that anything was
 * wired: an exactly-covered item stays listed as an output at 0/s, which is
 * the panel saying "you do not need to source this" out loud.
 *
 * Netted lists are re-ranked by their new size, the same ordering the raw
 * lists arrive with.
 */
export function applyNetFlow(
  needs: ResourceBalance[],
  outputs: ResourceBalance[],
): { needs: ResourceBalance[]; outputs: ResourceBalance[] } {
  const nettedNeeds: ResourceBalance[] = [];
  const nettedOutputs: ResourceBalance[] = [];

  for (const balance of needs) {
    const net = balance.surplusPerSecond - balance.deficitPerSecond;
    if (balance.surplusPerSecond <= 0) {
      nettedNeeds.push(balance);
    } else if (net < 0) {
      nettedNeeds.push({ ...balance, deficitPerSecond: -net, surplusPerSecond: 0 });
    }
    // net >= 0: the outputs pass below files it on the other side.
  }

  for (const balance of outputs) {
    const net = balance.surplusPerSecond - balance.deficitPerSecond;
    if (balance.deficitPerSecond <= 0) {
      nettedOutputs.push(balance);
    } else if (net >= 0) {
      nettedOutputs.push({ ...balance, surplusPerSecond: net, deficitPerSecond: 0 });
    }
    // net < 0: already filed as a need above.
  }

  nettedNeeds.sort((left, right) => right.deficitPerSecond - left.deficitPerSecond);
  nettedOutputs.sort((left, right) => right.surplusPerSecond - left.surplusPerSecond);
  return { needs: nettedNeeds, outputs: nettedOutputs };
}

export function filterFlowBalances(items: ResourceBalance[], filter: string) {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return items;
  }

  return items.filter((balance) => {
    if (balance.displayName && balance.displayName.toLowerCase().includes(normalized)) {
      return true;
    }

    return (
      balance.resourceId.toLowerCase().includes(normalized) ||
      balance.key.toLowerCase().includes(normalized)
    );
  });
}

export interface ResourceMarks {
  hidden: ReadonlySet<string>;
  favourites: ReadonlySet<string>;
  /** Hidden rows stay listed, greyed, instead of dropping out. */
  showHidden: boolean;
  /** Everything except favourites drops out. */
  favouritesOnly: boolean;
}

/**
 * Applies the user's own marks to one group: drops what they never want to
 * see, then floats what they starred to the top.
 *
 * Order within each half is left alone - the solver already sorted by size,
 * which is the ranking that matters once the starred rows are out of the way.
 * Stable partition rather than a sort, so equal rows can never swap places
 * between renders.
 *
 * No tie to break between the two marks: starring a resource unhides it and a
 * starred row offers no hide button, so nothing can be both at once.
 */
export function applyResourceMarks(
  items: ResourceBalance[],
  marks: ResourceMarks,
): ResourceBalance[] {
  const starred: ResourceBalance[] = [];
  const rest: ResourceBalance[] = [];

  for (const balance of items) {
    const isFavourite = marks.favourites.has(balance.key);
    if (marks.favouritesOnly && !isFavourite) {
      continue;
    }
    if (marks.hidden.has(balance.key) && !marks.showHidden) {
      continue;
    }
    (isFavourite ? starred : rest).push(balance);
  }

  return starred.length === 0 ? rest : [...starred, ...rest];
}

/**
 * Flattens the sections into the row list the virtualiser walks.
 *
 * A collapsed section contributes only its header, so folding a 200-row group
 * costs nothing to render.
 */
export function buildFlowRows(
  sections: FlowSection[],
  collapsed: Record<FlowSectionId, boolean>,
  favourites: ReadonlySet<string> = new Set(),
): FlowRow[] {
  const rows: FlowRow[] = [];
  for (const section of sections) {
    const isCollapsed = collapsed[section.id];
    rows.push({
      type: "header",
      key: `header:${section.id}`,
      section,
      collapsed: isCollapsed,
    });

    if (isCollapsed) {
      continue;
    }

    if (section.items.length === 0) {
      rows.push({ type: "empty", key: `empty:${section.id}`, section });
      continue;
    }

    for (const balance of section.items) {
      rows.push({ type: "item", key: `${section.id}:${balance.key}`, section, balance });
      if (favourites.has(balance.key)) {
        rows.push({
          type: "chart",
          key: `chart:${section.id}:${balance.key}`,
          section,
          balance,
        });
      }
    }
  }

  return rows;
}

/**
 * Running offset of every row plus the total, so the virtualiser can seek to a
 * scroll position without measuring the DOM.
 */
export function measureFlowRows(
  rows: FlowRow[],
  heights: { header: number; item: number; empty: number; chart: number },
  /**
   * Per-row height scale, for rows mid-arrival or mid-departure (the panel's
   * presence animation). The windowing math reads the ANIMATED height, so
   * the spacers and the scroll length stay exact while a row grows or
   * shrinks. Absent = every row at full height.
   */
  factorFor?: (row: FlowRow) => number,
) {
  const offsets = new Array<number>(rows.length + 1);
  let offset = 0;
  for (let index = 0; index < rows.length; index += 1) {
    offsets[index] = offset;
    const base = heights[rows[index].type];
    offset += factorFor ? Math.round(base * factorFor(rows[index])) : base;
  }

  offsets[rows.length] = offset;
  return { offsets, totalHeight: offset };
}

/** Index of the last row starting at or before `scrollTop`. */
export function findRowIndexAtOffset(offsets: number[], scrollTop: number) {
  let low = 0;
  let high = offsets.length - 2;
  let result = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] <= scrollTop) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

/**
 * Every card on the board that touches one resource, in board order.
 *
 * Recipe cards match on their raw inputs and outputs, oredict alternatives
 * included, which is the same test the board's own highlight uses - a row and
 * the cards it lights up must never disagree about what counts as a match.
 * Drawers and tanks match on the resource they hold.
 *
 * Order is the project's own card order rather than anything derived, so
 * stepping through the matches twice walks the same ring both times.
 */
export function findResourceCardIds(project: FactoryProject, resourceKey: string): string[] {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const ids: string[] = [];

  for (const node of project.nodes) {
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) {
      continue;
    }
    const matches = [...recipe.inputs, ...recipe.outputs].some(
      (resource) =>
        makeResourceKey(resource.kind, resource.id) === resourceKey ||
        resource.alternatives?.some(
          (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
        ),
    );
    if (matches) {
      ids.push(node.id);
    }
  }

  for (const storage of project.storages ?? []) {
    if (makeResourceKey(storage.kind, storage.resourceId) === resourceKey) {
      ids.push(storage.id);
    }
  }

  return ids;
}
