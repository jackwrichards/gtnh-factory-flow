"use client";

import "./chrome.css";

import { useRef, useState } from "react";
import { useDeviceSettings } from "@/lib/device-settings";
import { isLiveConfigured } from "@/lib/live/live-config";
import { leaveLibrary } from "@/lib/library/library-tab";
import type { RateUnit } from "@/lib/model/rate-unit";
import { requestNewTask, setTaskView, useTaskView } from "@/lib/tasks/task-board-ui";
import { tipAttrs } from "@/components/flow/clean/interaction";
import "@/components/tasks/tasks.css";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { arrangeLabel, getBoardCommands, pressArrange, useArrangeState } from "./board-commands";
import { BarKey, useBarFit } from "./bar-parts";
import { ChromeMenu, chromeAnchorOf, type ChromeAnchor } from "./ChromeMenu";
import { PixelBolt, PixelIcon } from "./pixel-icons";

/** Task boards come with live plans: none of it shows without NEXT_PUBLIC_LIVE_URL. */
const LIVE = isLiveConfigured();

/** The rate unit key's four clocks, in the mod's order. */
const RATE_ORDER: RateUnit[] = ["tick", "second", "minute", "hour"];
const RATE_LABEL: Record<string, string> = { tick: "/t", second: "/s", minute: "/min", hour: "/hr", eu: "/s" };

/** This strip has fewer keys than the top bar: it tightens at its own width (its own px); its two groups wrap by themselves. */
const STRIP_FIT = { tightBelow: 390, foldedBelow: 0 } as const;

/**
 * The board's toolbar, along the top of the board between the overview and the items list: what edits or views the
 * board, in the mod's order (Non-recipe, undo and redo, Arrange and Fit, the rate unit, EU/t, Avg), the same keys and
 * words as the game's. Its right group drops to a second row when the board is too narrow for both. A task board has no cards to edit: its
 * strip carries the board's title and New task instead.
 */
export function BoardToolbar() {
  const ref = useRef<HTMLElement | null>(null);
  const fit = useBarFit(ref, STRIP_FIT);
  const isTaskBoard = useFactoryStore((state) => LIVE && state.project.primaryView === "tasks");
  return (
    <header ref={ref} className="mb mb-strip" data-board-toolbar="" data-fit={fit}>
      {isTaskBoard ? <TaskBoardHeader /> : <BoardKeys tight={fit !== "roomy"} />}
    </header>
  );
}

/**
 * A task board's header, as the game's (TaskBoardView.drawHeader): its title and how many tasks it holds as plain
 * words, then Board / Chain (remembered per board in this browser) and New task at the right.
 */
function TaskBoardHeader() {
  const designId = useDesignStore((state) => state.activeDesignId);
  const name = useDesignStore(
    (state) => state.designs.find((entry) => entry.id === state.activeDesignId)?.name,
  );
  const count = useFactoryStore((state) => state.project.tasks?.length ?? 0);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const view = useTaskView(designId);
  const views = [
    { id: "board", label: "Board", tip: "Show the tasks in columns", sub: undefined },
    {
      id: "chain",
      label: "Chain",
      tip: "Show the tasks as chains",
      sub: "What each task waits on, left to right",
    },
  ] as const;
  return (
    <>
      <div className="mb-group mb-group-left">
        <span className="mb-title" data-plain="" data-task-board-title="">
          {name?.trim() ? name : "Tasks"}
        </span>
        <span className="mb-count" data-plain="">
          {count === 1 ? "1 task" : `${count} tasks`}
        </span>
      </div>
      <div className="mb-group mb-group-right">
        <span className="tb-switch" role="group" aria-label="View" data-task-view-switch="">
          {views.map((each) => (
            <button
              key={each.id}
              type="button"
              aria-pressed={view === each.id}
              data-task-view={each.id}
              {...tipAttrs({ id: `task-view|${each.id}`, title: each.tip, sub: each.sub })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => designId && setTaskView(designId, each.id)}
            >
              {each.label}
            </button>
          ))}
        </span>
        <BarKey
          id="new-task"
          label="New task"
          off={isReadOnly}
          tip="Add a task to To do"
          onClick={() => requestNewTask()}
        />
      </div>
    </>
  );
}

function BoardKeys({ tight }: { tight: boolean }) {
  // A live plan's undo is its own (recorded inverses of this person's edits): the keys read it when it is set.
  const canUndo = useFactoryStore((state) => (state.liveUndo ? state.liveUndo.canUndo : state.undoHistory.length > 0));
  const canRedo = useFactoryStore((state) => (state.liveUndo ? state.liveUndo.canRedo : state.redoHistory.length > 0));
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const rateUnit = useFactoryStore((state) => state.rateUnit);
  const setRateUnit = useFactoryStore((state) => state.setRateUnit);
  const powerDisplayUnit = useFactoryStore((state) => state.powerDisplayUnit);
  const setPowerDisplayUnit = useFactoryStore((state) => state.setPowerDisplayUnit);
  const { scrollChangesValues } = useDeviceSettings();
  const powerMenuOpen = useFactoryStore((state) => state.powerMenuOpen);
  const openPowerMenu = useFactoryStore((state) => state.openPowerMenu);
  const closePowerMenu = useFactoryStore((state) => state.closePowerMenu);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const arrange = useArrangeState();
  const hasGroups = useFactoryStore((state) => (state.project.pockets?.length ?? 0) > 0);
  // A plan with groups asks how to treat them; one without arranges at once.
  const [arrangeMenu, setArrangeMenu] = useState<ChromeAnchor | undefined>(undefined);

  const rateIndex = Math.max(0, RATE_ORDER.indexOf(rateUnit === "eu" ? "second" : rateUnit));
  const stepRate = (step: number) => {
    const next = RATE_ORDER[(rateIndex + step + RATE_ORDER.length) % RATE_ORDER.length];
    setRateUnit(next);
  };

  const isAmps = powerDisplayUnit !== "eu";
  // The mod's Amps: every card counts in its own machine's tier.
  const togglePower = () => setPowerDisplayUnit(isAmps ? "eu" : "amps");

  return (
    <>
      <div className="mb-group mb-group-left">
      <BarKey
        id="nonrecipe"
        glyph="bolt"
        width={tight ? undefined : 78}
        ariaLabel="Non-recipe machines"
        tip="Non-recipe machines: generators, turbines, boilers, reactors"
        open={powerMenuOpen}
        off={isReadOnly}
        onClick={() => {
          // The key opens the picker and closes it again.
          if (powerMenuOpen) closePowerMenu();
          else {
            leaveLibrary();
            openPowerMenu();
          }
        }}
        menuAnchor
      >
        <PixelBolt className="mb-bolt" />
        {tight ? null : "Non-recipe"}
      </BarKey>
      <BarKey
        id="undo"
        gap
        icon
        off={!canUndo || isReadOnly}
        ariaLabel="Undo"
        tip="Undo (Ctrl+Z)"
        onClick={() => undo()}
      >
        <PixelIcon name="undo" />
      </BarKey>
      <BarKey
        id="redo"
        icon
        off={!canRedo || isReadOnly}
        ariaLabel="Redo"
        tip="Redo (Ctrl+Shift+Z or Ctrl+Y)"
        onClick={() => redo()}
      >
        <PixelIcon name="undo" mirror />
      </BarKey>
      </div>
      <div className="mb-group mb-group-right">
      <BarKey
        id="arrange"
        label={arrangeLabel(arrange)}
        width={arrange.running ? 90 : undefined}
        tip="Auto-arrange the plan (press again to stop)"
        off={isReadOnly}
        open={arrangeMenu !== undefined}
        menuAnchor={hasGroups}
        onClick={(event) => {
          if (arrange.running || !hasGroups) {
            pressArrange();
          } else if (arrangeMenu) {
            setArrangeMenu(undefined);
          } else {
            setArrangeMenu(chromeAnchorOf(event.currentTarget));
          }
        }}
      />
      {arrangeMenu ? (
        <ChromeMenu
          anchor={arrangeMenu}
          label="Arrange"
          minWidth={110}
          entries={[
            {
              label: "Keep groups",
              tip: "Each group moves as one block. What is inside a group stays where it is.",
              onSelect: () => pressArrange(),
            },
            {
              label: "Ungroup all",
              tip: "Takes every group apart, then arranges all the cards. Undo brings the groups back.",
              onSelect: () => pressArrange({ ungroup: true }),
            },
          ]}
          onClose={() => setArrangeMenu(undefined)}
        />
      ) : null}
      <BarKey id="fit" label="Fit" width={24} tip="Zoom to fit the whole plan" onClick={() => getBoardCommands()?.fit()} />
      <BarKey
        id="rate"
        gap
        label={RATE_LABEL[rateUnit] ?? "/s"}
        width={32}
        tip="Rate unit: per tick, second, minute or hour"
        onClick={() => stepRate(1)}
        onContext={() => stepRate(-1)}
        onWheel={scrollChangesValues ? stepRate : undefined}
      />
      <BarKey
        id="power"
        label={isAmps ? "Amps" : "EU/t"}
        width={36}
        tip="Show power as EU/t, or as amps at each machine's tier"
        onClick={togglePower}
        onContext={togglePower}
        onWheel={scrollChangesValues ? togglePower : undefined}
      />
      <BarKey
        id="annotate"
        gap
        icon
        off={isReadOnly}
        ariaLabel="Annotations"
        tip="Add a sticky note, box or arrow, or change the background"
        menuAnchor
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          getBoardCommands()?.openBoardMenu?.({ x: rect.left, y: rect.bottom + 2 });
        }}
      >
        <PixelIcon name="pencil" />
      </BarKey>
      </div>
    </>
  );
}
