"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { GT_OVERCLOCK_TIERS } from "@/lib/model/tiers";
import {
  categorizeRecipeMap,
  loadSolveSettings,
  RECIPE_MAP_CATEGORIES,
  saveSolveSettings,
  type GapSolveSettings,
  type RecipeMapCategoryId,
  type SolveTierSetting,
} from "@/lib/planner/solve-settings";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { PlannerDialog } from "./PlannerDialog";

type CategoryFilter = "all" | RecipeMapCategoryId;

/**
 * The solver's rulebook, edited outside any running solve: tier cap, search
 * depth, and which machines are allowed at all. Settings persist and apply
 * from the next solve onward.
 */
export function SolveSettingsDialog({ onClose }: { onClose: () => void }) {
  const recipeMaps = useFactoryStore((state) => state.dataset?.recipeMaps);
  const recipeMapIcons = useFactoryStore((state) => state.dataset?.recipeMapIcons);
  const globalMaxTier = useFactoryStore((state) => state.maxTierFilter);
  const [settings, setSettings] = useState<GapSolveSettings>(loadSolveSettings);
  const [mapFilter, setMapFilter] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");

  const updateSettings = (patch: Partial<GapSolveSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveSolveSettings(next);
      return next;
    });
  };

  const iconsByMap = useMemo(
    () => new Map((recipeMapIcons ?? []).map((entry) => [entry.recipeMap, entry.resource])),
    [recipeMapIcons],
  );
  const blocked = useMemo(() => new Set(settings.blockedRecipeMaps), [settings.blockedRecipeMaps]);
  const categoriesByMap = useMemo(
    () => new Map((recipeMaps ?? []).map((entry) => [entry, categorizeRecipeMap(entry)])),
    [recipeMaps],
  );
  const visibleMaps = useMemo(() => {
    const normalized = mapFilter.trim().toLowerCase();
    return [...(recipeMaps ?? [])]
      .filter(
        (recipeMap) =>
          (category === "all" || categoriesByMap.get(recipeMap) === category) &&
          (!normalized || recipeMap.toLowerCase().includes(normalized)),
      )
      .sort((left, right) => left.localeCompare(right));
  }, [category, categoriesByMap, mapFilter, recipeMaps]);

  const setBlockedForVisible = (shouldBlock: boolean) => {
    const visible = new Set(visibleMaps);
    const next = shouldBlock
      ? [...new Set([...settings.blockedRecipeMaps, ...visibleMaps])]
      : settings.blockedRecipeMaps.filter((entry) => !visible.has(entry));
    updateSettings({ blockedRecipeMaps: next });
  };

  const toggleMap = (recipeMap: string) => {
    updateSettings({
      blockedRecipeMaps: blocked.has(recipeMap)
        ? settings.blockedRecipeMaps.filter((entry) => entry !== recipeMap)
        : [...settings.blockedRecipeMaps, recipeMap],
    });
  };

  const enabledCount = (recipeMaps?.length ?? 0) - settings.blockedRecipeMaps.length;

  return (
    <PlannerDialog
      title="Auto-build settings"
      onClose={onClose}
      widthClassName="w-[min(1100px,94vw)]"
      heightClassName="h-[86vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            Max tier
            <select
              value={settings.maxTier}
              onChange={(event) =>
                updateSettings({ maxTier: event.target.value as SolveTierSetting })
              }
              className="h-9 rounded border border-line bg-surface-sunken px-2 text-sm outline-none focus:border-cyan-500"
            >
              <option value="global">Recipe-book filter ({globalMaxTier})</option>
              {GT_OVERCLOCK_TIERS.map((entry) => (
                <option key={entry.tier} value={entry.tier}>
                  {entry.tier}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Max depth
            <input
              type="number"
              min={1}
              max={16}
              value={settings.maxDepth}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isInteger(parsed)) {
                  updateSettings({ maxDepth: Math.min(16, Math.max(1, parsed)) });
                }
              }}
              className="h-9 w-16 rounded border border-line bg-surface-sunken px-2 text-sm outline-none focus:border-cyan-500"
            />
            <span className="text-xs text-fg-muted">recipes deep</span>
          </label>
          <span className="ml-auto text-sm text-fg-muted">
            {enabledCount} of {recipeMaps?.length ?? 0} machines enabled
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip
            label="All"
            isActive={category === "all"}
            onClick={() => setCategory("all")}
          />
          {RECIPE_MAP_CATEGORIES.map((entry) => (
            <CategoryChip
              key={entry.id}
              label={entry.label}
              isActive={category === entry.id}
              onClick={() => setCategory(entry.id)}
            />
          ))}
          <span className="flex-1" />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
            <input
              type="text"
              value={mapFilter}
              onChange={(event) => setMapFilter(event.target.value)}
              placeholder="Filter machines…"
              className="h-9 w-56 rounded border border-line bg-surface-sunken pl-8 pr-2 text-sm outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setBlockedForVisible(false)}
            className="h-9 rounded border border-line px-2.5 text-sm hover:bg-surface-sunken"
            title="Enable every machine shown below"
          >
            Enable shown
          </button>
          <button
            type="button"
            onClick={() => setBlockedForVisible(true)}
            className="h-9 rounded border border-line px-2.5 text-sm hover:bg-surface-sunken"
            title="Disable every machine shown below"
          >
            Disable shown
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-line p-3">
          {visibleMaps.length === 0 ? (
            <div className="text-base text-fg-muted">No machines match.</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-1.5">
              {visibleMaps.map((recipeMap) => {
                const isBlocked = blocked.has(recipeMap);
                const icon = iconsByMap.get(recipeMap);
                return (
                  <button
                    key={recipeMap}
                    type="button"
                    onClick={() => toggleMap(recipeMap)}
                    title={isBlocked ? `Allow ${recipeMap}` : `Exclude ${recipeMap}`}
                    className={[
                      "flex h-11 items-center gap-2 rounded border px-2 text-left",
                      isBlocked
                        ? "border-line bg-surface opacity-45 hover:opacity-80"
                        : "border-emerald-500/50 bg-emerald-500/10 hover:border-emerald-400",
                    ].join(" ")}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center">
                      {icon ? (
                        <ResourceIcon
                          resource={{ ...icon, amount: 1 }}
                          size="sm"
                          showAmount={false}
                          bare
                          className="!h-8 !w-8"
                        />
                      ) : (
                        <span className="grid h-7 w-7 place-items-center rounded bg-surface-sunken text-xs font-semibold text-fg-muted">
                          {recipeMap.slice(0, 1)}
                        </span>
                      )}
                    </span>
                    <span
                      className={[
                        "min-w-0 flex-1 truncate text-sm",
                        isBlocked ? "line-through" : "",
                      ].join(" ")}
                    >
                      {recipeMap}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between">
          <span className="text-xs text-fg-muted">
            Applies from the next solve; a running search is not affected.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded border border-line px-5 text-base font-medium hover:bg-surface-sunken"
          >
            Done
          </button>
        </div>
      </div>
    </PlannerDialog>
  );
}

function CategoryChip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-9 rounded border px-3 text-sm",
        isActive
          ? "border-cyan-500 bg-cyan-500/10 font-medium"
          : "border-line hover:bg-surface-sunken",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
