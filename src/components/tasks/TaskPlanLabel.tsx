import type { PlanTask } from "@/lib/model/types";
import { tipAttrs } from "@/components/flow/clean/interaction";
import { openTaskPlan } from "@/lib/tasks/open-link";
import { showLiveNotice } from "@/store/live-session";

/** Only explicit whole-plan additions get this label, even when a normal task links every machine. */
export function TaskPlanLabel({ task, compact = false }: { task: PlanTask; compact?: boolean }) {
  if (!task.sourcePlans?.length) return null;
  return (
    <span
      className="tb-task-plan"
      data-compact={compact ? "" : undefined}
      data-task-plan-label=""
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {task.sourcePlans.map((source) => (
        <button
          key={source.plan}
          type="button"
          className="tb-plan-link"
          aria-label={`Open plan ${source.name}`}
          {...tipAttrs({
            id: `task-plan|${task.id}|${source.plan}`,
            title: source.name,
            sub: "Open this plan",
          })}
          onClick={(event) => {
            event.stopPropagation();
            void openTaskPlan(source.plan).then((opened) => {
              if (!opened) showLiveNotice("That plan is gone.");
            });
          }}
        >
          <span className="tb-plan-chip">Plan</span>
          {compact ? null : <span className="tb-plan-name">{source.name}</span>}
        </button>
      ))}
    </span>
  );
}
