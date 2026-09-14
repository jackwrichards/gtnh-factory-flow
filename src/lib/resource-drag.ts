import type { ResourceAmount } from "./model/types";
import { resourceAmountSchema } from "./model/schemas";

export const RESOURCE_DRAG_TYPE = "application/x-gtnh-resource";

export function writeResourceDrag(transfer: DataTransfer, resource: ResourceAmount) {
  transfer.effectAllowed = "copy";
  transfer.setData(RESOURCE_DRAG_TYPE, JSON.stringify({ ...resource, amount: 1 }));
}

export function readResourceDrag(transfer: DataTransfer): ResourceAmount | undefined {
  try {
    const parsed = resourceAmountSchema.safeParse(JSON.parse(transfer.getData(RESOURCE_DRAG_TYPE)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
