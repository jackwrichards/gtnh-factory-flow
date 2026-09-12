export const RATIO_EDITOR_EVENT = "gtnh:ratio-editor";
export interface RatioEditorRequest {
  storageId: string;
}

export function openRatioEditor(storageId: string): void {
  window.dispatchEvent(
    new CustomEvent<RatioEditorRequest>(RATIO_EDITOR_EVENT, {
      detail: { storageId },
    }),
  );
}
