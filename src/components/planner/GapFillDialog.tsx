"use client";

import { Wand2 } from "lucide-react";
import { useMemo } from "react";
import {
  formatNumberWithThousands,
  formatRate,
  getResourceKey,
  resourceLabel,
} from "@/lib/model";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { Recipe, ResourceBalance } from "@/lib/model/types";
import { materializeGapFillPlan } from "@/lib/planner/materialize";
import type { GapFillPlan } from "@/lib/planner/types";
import { calculateThroughput } from "@/lib/solver";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { PlannerDialog } from "./PlannerDialog";

interface VerifiedPlan {
  plan: GapFillPlan<Recipe>;
  /** Needs the plan would newly leave open, per the real throughput solver. */
  newNeeds: ResourceBalance[];
  euTDelta: number;
  verifiedClosed: boolean;
}

/**
 * Shows the finished solve's plans. Solving itself runs in the background via
 * the store; this dialog only exists once results are ready, and closing it
 * keeps them available from the canvas status card.
 */
export function GapFillPlansDialog() {
  const gapSolve = useFactoryStore((state) => state.gapSolve);

  if (!gapSolve || gapSolve.status !== "ready" || gapSolve.dismissed || !gapSolve.result) {
    return null;
  }

  return <GapFillPlansContent key={gapSolve.id} />;
}

function GapFillPlansContent() {
  const gapSolve = useFactoryStore((state) => state.gapSolve);
  const project = useFactoryStore((state) => state.project);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const applyGapFillPlan = useFactoryStore((state) => state.applyGapFillPlan);
  const dismissGapSolveResults = useFactoryStore((state) => state.dismissGapSolveResults);

  const request = (project.requests ?? []).find((entry) => entry.id === gapSolve?.requestId);
  const requestTitle = request
    ? resourceLabel({ id: request.resourceId, displayName: request.displayName })
    : "…";

  const verifiedPlans = useMemo<VerifiedPlan[]>(() => {
    if (!gapSolve?.result) {
      return [];
    }

    const baselineNeeds = new Set(lastResult.externalInputs.map((balance) => balance.key));
    return gapSolve.result.plans.map((plan) => {
      const draft = materializeGapFillPlan(
        project,
        gapSolve.stockpileId,
        gapSolve.requestId,
        plan,
      );
      const throughput = calculateThroughput(draft.project);
      const newNeeds = throughput.externalInputs.filter(
        (balance) => !baselineNeeds.has(balance.key),
      );
      return {
        plan,
        newNeeds,
        euTDelta: throughput.totalEuT - lastResult.totalEuT,
        verifiedClosed: newNeeds.length === 0,
      };
    });
  }, [gapSolve, lastResult, project]);

  if (!gapSolve?.result) {
    return null;
  }

  return (
    <PlannerDialog
      title={`Build a chain for ${requestTitle}`}
      onClose={dismissGapSolveResults}
      widthClassName="w-[640px]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {gapSolve.result.notes.map((note) => (
          <div
            key={note}
            className="rounded border border-line bg-surface-sunken px-3 py-2 text-sm text-fg-muted"
          >
            {note}
          </div>
        ))}
        {verifiedPlans.length === 0 ? (
          <div className="py-6 text-sm text-fg-muted">
            No path found from your stockpile to {requestTitle} with the current solver settings.
            Add more base resources, raise the tier cap, or allow more machines.
          </div>
        ) : (
          verifiedPlans.map((entry) => (
            <PlanCard
              key={entry.plan.id}
              entry={entry}
              onApply={() =>
                applyGapFillPlan(gapSolve.stockpileId, gapSolve.requestId, entry.plan)
              }
            />
          ))
        )}
      </div>
    </PlannerDialog>
  );
}

const VISIBLE_STEPS = 6;
const VISIBLE_DRAWS = 5;

function PlanCard({ entry, onApply }: { entry: VerifiedPlan; onApply: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const { plan, newNeeds, euTDelta, verifiedClosed } = entry;
  const isClosed = plan.closed && verifiedClosed;
  const tierName = GT_VOLTAGE_TIERS[plan.stats.maxTierIndex]?.tier ?? "?";
  const missingLabels = [
    ...plan.missing.map((resource) => resourceLabel(resource)),
    ...newNeeds.map((balance) =>
      resourceLabel({ id: balance.resourceId, displayName: balance.displayName }),
    ),
  ];
  const suppliedCount = plan.stats.supplyDraws.length + plan.stats.existingDraws.length;
  const edgeInputCount = suppliedCount + plan.missing.length;
  const visibleSteps = plan.steps.slice(0, VISIBLE_STEPS);
  const visibleDraws = plan.stats.supplyDraws.slice(0, VISIBLE_DRAWS);

  return (
    <div className="rounded border border-line bg-surface-raised">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{plan.label}</span>
        {isClosed ? (
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500">
            Closed — nothing missing
          </span>
        ) : (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
            Still needs {missingLabels.length}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-sm text-fg-subtle">
        {plan.steps.length > 0 ? (
          <>
            <span>{plan.stats.stepCount} steps</span>
            <span>{plan.stats.machineCount} machines</span>
            <span>up to {tierName}</span>
            <span>
              {euTDelta >= 0 ? "+" : ""}
              {formatNumberWithThousands(Math.round(euTDelta))} EU/t
            </span>
            {edgeInputCount > 0 ? (
              <span
                className={
                  suppliedCount === edgeInputCount ? "text-emerald-500" : "text-fg-subtle"
                }
                title="How many of this chain's edge inputs come from your stockpile or existing machines"
              >
                {suppliedCount}/{edgeInputCount} inputs from what you have
              </span>
            ) : null}
          </>
        ) : (
          <span>No new machines — reroutes existing production.</span>
        )}
      </div>

      {missingLabels.length > 0 ? (
        <div className="px-3 pb-2 text-sm text-amber-500">
          Missing: {missingLabels.join(", ")}
        </div>
      ) : null}

      {visibleDraws.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          <span className="text-xs uppercase tracking-wide text-fg-muted">From stockpile</span>
          {visibleDraws.map((draw) => (
            <span
              key={getResourceKey(draw)}
              className="flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-xs"
              title={resourceLabel(draw)}
            >
              <ResourceIcon
                resource={{ ...draw, amount: 1 }}
                size="sm"
                showAmount={false}
                bare
                className="!h-5 !w-5"
              />
              {formatRate(draw.ratePerSecond)}
              {draw.kind === "fluid" ? "L/s" : "/s"}
            </span>
          ))}
          {plan.stats.supplyDraws.length > visibleDraws.length ? (
            <span className="text-xs text-fg-muted">
              +{plan.stats.supplyDraws.length - visibleDraws.length} more
            </span>
          ) : null}
        </div>
      ) : null}

      {plan.stats.existingDraws.length > 0 ? (
        <div className="px-3 pb-2 text-sm text-fg-subtle">
          Taps{" "}
          {plan.stats.existingDraws
            .map((draw) => {
              const node = project.nodes.find((entry) => entry.id === draw.nodeId);
              const recipe = project.recipes.find((entry) => entry.id === node?.recipeId);
              return `${recipe?.name ?? "an existing machine"} (${formatRate(draw.ratePerSecond)}${
                draw.kind === "fluid" ? "L/s" : "/s"
              })`;
            })
            .join(", ")}
        </div>
      ) : null}

      {visibleSteps.length > 0 ? (
        <div className="border-t border-line px-3 py-2">
          {visibleSteps.map((step, index) => (
            <div key={`${step.recipe.id}-${index}`} className="flex items-baseline gap-2 py-0.5">
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                {step.machineCount}×
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{step.recipe.name}</span>
            </div>
          ))}
          {plan.steps.length > visibleSteps.length ? (
            <div className="pt-0.5 text-xs text-fg-muted">
              +{plan.steps.length - visibleSteps.length} more steps
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={onApply}
          className="flex h-8 items-center gap-1.5 rounded bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Build it
        </button>
      </div>
    </div>
  );
}
