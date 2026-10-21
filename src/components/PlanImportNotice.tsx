"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useDesignStore } from "@/store/design-store";
import {
  dismissPlanImportNotice,
  importPlanNoticeAsNew,
  usePlanImportNotice,
  updatePlanFromNotice,
  type PlanImportNotice as ImportNotice,
} from "@/lib/open-plan-code";

export function PlanImportNotice() {
  const notice = usePlanImportNotice((state) => state.notice);
  const activeId = useDesignStore((state) => state.activeDesignId);
  if (!notice || notice.designId !== activeId) return null;
  return <ImportNoticeContent key={notice.designId + notice.full} notice={notice} />;
}

function ImportNoticeContent({ notice }: { notice: ImportNotice }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [targetId, setTargetId] = useState(notice.related[0]?.id ?? "");

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The plan could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      data-plan-import-notice
      className="flex min-w-0 flex-wrap items-center gap-2 border-b border-sky-700/60 bg-sky-950/60 px-3 py-1.5 text-xs text-sky-100"
    >
      <p className={notice.kind === "related" ? "min-w-0 basis-full" : "min-w-0 flex-1"}>
        {notice.kind === "existing" ? (
          <>Opened your saved plan &ldquo;{notice.name}&rdquo;.</>
        ) : (
          <>This looks like another version of a saved plan. Opened as a separate plan.</>
        )}
        {error ? <span role="alert"> {error}</span> : null}
      </p>
      {notice.kind === "related" ? (
        <>
          <select
            aria-label="Saved plan to update"
            value={targetId}
            disabled={busy}
            onChange={(event) => setTargetId(event.target.value)}
            className="min-w-0 max-w-48 rounded border border-sky-500/70 bg-sky-950 px-2 py-0.5"
          >
            {notice.related.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => updatePlanFromNotice(notice, targetId))}
            className="shrink-0 rounded border border-sky-500/70 px-2 py-0.5 hover:bg-sky-900/60 disabled:opacity-50"
          >
            Update saved plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={dismissPlanImportNotice}
            className="shrink-0 rounded border border-sky-500/70 px-2 py-0.5 hover:bg-sky-900/60"
          >
            Keep separate
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(() => importPlanNoticeAsNew(notice))}
          className="shrink-0 rounded border border-sky-500/70 px-2 py-0.5 text-sky-50 hover:bg-sky-900/60 disabled:opacity-50"
        >
          Import as new plan
        </button>
      )}
      <button
        type="button"
        onClick={dismissPlanImportNotice}
        aria-label="Dismiss import notice"
        className="shrink-0 rounded p-0.5 text-sky-200 hover:bg-sky-900/60"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
