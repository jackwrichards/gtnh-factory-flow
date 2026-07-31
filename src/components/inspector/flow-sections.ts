import type { ResourceBalance } from "@/lib/model/types";

export type FlowSectionId = "need" | "output" | "internal";

export type FlowSectionTone = "need" | "output" | "internal";

export interface FlowSection {
  id: FlowSectionId;
  label: string;
  /** Shown next to the count so the group explains itself without a legend. */
  hint: string;
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
    case "output":
      return balance.surplusPerSecond;
    case "internal":
    default:
      return balance.consumedPerSecond;
  }
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

/**
 * Flattens the sections into the row list the virtualiser walks.
 *
 * A collapsed section contributes only its header, so folding a 200-row group
 * costs nothing to render.
 */
export function buildFlowRows(
  sections: FlowSection[],
  collapsed: Record<FlowSectionId, boolean>,
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
      rows.push({
        type: "item",
        key: `${section.id}:${balance.key}`,
        section,
        balance,
      });
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
  heights: { header: number; item: number; empty: number },
) {
  const offsets = new Array<number>(rows.length + 1);
  let offset = 0;
  for (let index = 0; index < rows.length; index += 1) {
    offsets[index] = offset;
    offset += heights[rows[index].type];
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
