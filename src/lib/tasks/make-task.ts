"use client";

import { readDesign } from "@/lib/designs/design-storage";
import { buildMachineList } from "@/lib/model/machine-list";
import type { FactoryProject, PlanTaskLink, PlanTaskStatus } from "@/lib/model/types";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { myAccountId, showLiveNotice, useLiveSession } from "@/store/live-session";
import { activateDesign } from "./open-link";
import {
  addTask,
  addTaskSourcePlan,
  addThing,
  boardCardLabel,
  cardLine,
  taskById,
  taskProgress,
  tasksIn,
  titleForCards,
} from "./task-board";
import { selectTask } from "./task-board-ui";
import { planLinkId, planLinkIds } from "./task-links";
import { syncTaskPlan } from "./task-plan";

/**
 * "Add to a task" (the game's TaskActions): cards of the open plan go into a task of one of the task boards on this
 * device (a plan of its own kind), each as a machine thing with its own checkbox saying how many to build. Asked from
 * a right click on cards, a card's actions and the overview's machine lines: which task board, then which task in it
 * (or a new one). A notice says what went where, with Open.
 */

/** A card of the open plan as a task names it. */
export interface TaskCard {
  nodeId: string;
  name: string;
  tier?: string;
  /** How many machines the solve builds for it, rounded up (0 before the plan has solved). */
  count: number;
}

/** A solved whole-plan snapshot, tied to the design the player asked to add or update. */
export interface TaskPlanSnapshot {
  designId: string;
  name: string;
  cards: TaskCard[];
}

/** Add and Update must both wait for current machine quantities before taking their snapshot. */
export async function captureTaskPlan(): Promise<TaskPlanSnapshot | undefined> {
  const designId = useDesignStore.getState().activeDesignId;
  if (!designId) return undefined;
  for (
    let waited = 0;
    waited < 5000 && useFactoryStore.getState().lastResult.stale;
    waited += 100
  ) {
    if (useDesignStore.getState().activeDesignId !== designId) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const designs = useDesignStore.getState();
  if (designs.activeDesignId !== designId) return undefined;
  const from = designs.designs.find((design) => design.id === designId);
  if (!from || useFactoryStore.getState().project.primaryView === "tasks") return undefined;
  if (useFactoryStore.getState().lastResult.stale) {
    showLiveNotice("This plan is still calculating. Try again when it finishes.");
    return undefined;
  }
  return { designId, name: from.name, cards: planCardsForTask() };
}

/** A task board on this device, for the first menu: its design and how many tasks it holds. */
export interface TaskBoardChoice {
  id: string;
  name: string;
  tasks: number;
}

/** A task of a board, for the second menu: the ones under way first. */
export interface TaskChoice {
  id: string;
  title: string;
  status: PlanTaskStatus;
  done: number;
  all: number;
}

export interface PlanTaskTarget extends TaskChoice {
  boardId: string;
  boardName: string;
}

/** Explicit whole-plan tasks only, read when the player opens the plan's menu. */
export async function relatedPlanTasks(designId: string): Promise<PlanTaskTarget[]> {
  const store = useDesignStore.getState();
  const design = store.designs.find((entry) => entry.id === designId);
  if (!design) return [];
  const aliases = new Set(planLinkIds(design, myAccountId()));
  const targets = await Promise.all(
    store.designs
      .filter((entry) => entry.taskBoard)
      .map(async (board) => {
        const project =
          board.id === store.activeDesignId
            ? useFactoryStore.getState().project
            : (await readDesign(board.id).catch(() => undefined))?.project;
        if (!project) return [];
        const ids = new Set(
          project.tasks
            ?.filter((task) => task.sourcePlans?.some((source) => aliases.has(source.plan)))
            .map((task) => task.id),
        );
        return taskChoicesOf(project)
          .filter((task) => ids.has(task.id))
          .map((task) => ({ ...task, boardId: board.id, boardName: board.name }));
      }),
  );
  return targets.flat();
}

/** The task boards on this device, the open design left out (it is the plan the cards are on). */
export async function taskBoardChoices(): Promise<TaskBoardChoice[]> {
  const { designs, activeDesignId } = useDesignStore.getState();
  const boards = designs.filter((design) => design.taskBoard && design.id !== activeDesignId);
  return Promise.all(
    boards.map(async (design) => {
      const record = await readDesign(design.id).catch(() => undefined);
      return {
        id: design.id,
        name: design.name,
        tasks: record?.project.tasks?.length ?? design.stats?.tasks ?? 0,
      };
    }),
  );
}

/** A board's tasks in the order the second menu lists them: Doing, Blocked, To do, then Done. */
export function taskChoicesOf(project: FactoryProject): TaskChoice[] {
  return (["doing", "blocked", "todo", "done"] as const).flatMap((status) =>
    tasksIn(project, status).map((task) => {
      const progress = taskProgress(project, task.id);
      return { id: task.id, title: task.title, status, done: progress.done, all: progress.all };
    }),
  );
}

export async function taskChoices(boardId: string): Promise<TaskChoice[]> {
  const record = await readDesign(boardId).catch(() => undefined);
  return record ? taskChoicesOf(record.project) : [];
}

/** The machine cards selected on the board. */
export function selectedTaskCards(): TaskCard[] {
  const { project, selectedBoardIds } = useFactoryStore.getState();
  const first = selectedBoardIds.find((id) => project.nodes.some((node) => node.id === id));
  return first ? cardsForTask(first) : [];
}

/** Every buildable machine in the open plan, including cards inside boards. */
export function planCardsForTask(): TaskCard[] {
  const { project, lastResult } = useFactoryStore.getState();
  return buildMachineList(project, lastResult).map((entry) => ({
    nodeId: entry.nodeId,
    name: entry.label,
    ...(entry.tier ? { tier: entry.tier } : {}),
    count: Math.ceil(entry.count - 1e-9),
  }));
}

/**
 * The cards a right click on `nodeId` means: the whole selection when the card is part of it, else the card alone.
 * Only machine cards (drawers, notes and groups are not built).
 */
export function cardsForTask(nodeId: string, withSelection = true): TaskCard[] {
  const { project, lastResult, selectedBoardIds } = useFactoryStore.getState();
  const cardIds = new Set(project.nodes.map((node) => node.id));
  const chosen =
    withSelection && selectedBoardIds.includes(nodeId)
      ? selectedBoardIds.filter((id) => cardIds.has(id))
      : [nodeId];
  const entries = new Map(
    buildMachineList(project, lastResult).map((entry) => [entry.nodeId, entry]),
  );
  const cards: TaskCard[] = [];
  for (const id of chosen) {
    if (!cardIds.has(id)) {
      continue;
    }
    const entry = entries.get(id);
    cards.push({
      nodeId: id,
      name: entry?.label ?? boardCardLabel(project, id) ?? "Machine",
      ...(entry?.tier ? { tier: entry.tier } : {}),
      count: entry ? Math.ceil(entry.count - 1e-9) : 0,
    });
  }
  return cards;
}

/** Opens a task in its box once its board is on the screen with the task on it (the game's openWhenShown). */
export async function openWhenShown(boardId: string, taskId: string): Promise<void> {
  for (let waited = 0; waited < 5000; waited += 50) {
    const shown =
      useDesignStore.getState().activeDesignId === boardId &&
      taskById(useFactoryStore.getState().project, taskId) !== undefined &&
      typeof document !== "undefined" &&
      document.querySelector("[data-task-board]") !== null;
    if (shown) {
      // A moment for the board to settle: leaving a board closes its box.
      await new Promise((resolve) => setTimeout(resolve, 100));
      selectTask(taskId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Waits until the open plan's edits are confirmed by the live service (or it is not live), at most `ms`. */
async function settled(designId: string, ms: number): Promise<void> {
  for (let waited = 0; waited < ms; waited += 100) {
    const live = useLiveSession.getState();
    if (
      live.status === "off" ||
      (live.designId === designId && live.status === "live" && live.pending === 0)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Adds cards of the open plan to a task on a board (the board of `boardDesignId`, or a new one) as machine things,
 * one a card with how many to build; with no task, a new one in To do titled from their machines. The edit is made on
 * the board itself (so a live board sends it as anyone's edit), then the plan comes back and a notice says what went
 * where with Open, which shows the board with the task open. Returns the task's id.
 */
export async function addCardsToTask(
  cards: readonly TaskCard[],
  boardDesignId: string | undefined,
  taskId?: string,
  options: { source?: TaskPlanSnapshot } = {},
): Promise<string | undefined> {
  return writeTaskMachines(cards, boardDesignId, taskId, { kind: "add", ...options });
}

/** Refreshes a linked task from the open plan, including a plan whose last machine was removed. */
export async function updateTaskFromPlan(
  boardDesignId: string,
  taskId: string,
): Promise<string | undefined> {
  const source = await captureTaskPlan();
  if (!source) return undefined;
  return writeTaskMachines(source.cards, boardDesignId, taskId, { kind: "update", source });
}

type TaskMachineOperation =
  | { kind: "add"; source?: TaskPlanSnapshot }
  | { kind: "update"; source: TaskPlanSnapshot };

async function writeTaskMachines(
  cards: readonly TaskCard[],
  boardDesignId: string | undefined,
  taskId: string | undefined,
  operation: TaskMachineOperation,
): Promise<string | undefined> {
  const update = operation.kind === "update";
  const wholePlanName = operation.source?.name;
  if (cards.length === 0 && !update) {
    return undefined;
  }
  const designStore = useDesignStore.getState();
  const from = designStore.designs.find((design) => design.id === designStore.activeDesignId);
  if (operation.source && operation.source.designId !== from?.id) return undefined;
  const plan = from ? planLinkId(from, myAccountId()) : "";
  const aliases = from ? planLinkIds(from, myAccountId()) : [];
  if (boardDesignId) {
    const board = designStore.designs.find((design) => design.id === boardDesignId);
    if (!board) {
      return undefined;
    }
    await activateDesign(board);
  } else {
    await designStore.addTaskBoard();
  }
  const boardId = useDesignStore.getState().activeDesignId;
  // The board lands on the canvas a moment after the design is named.
  for (let waited = 0; waited < 3000; waited += 50) {
    if (useFactoryStore.getState().project.primaryView === "tasks") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const me = useLiveSession.getState().me;
  const author = me ? { id: me.id, username: me.username } : { id: "local", username: "You" };
  let made: string | undefined;
  let title = "";
  useFactoryStore.getState().editTasks((project) => {
    let next = project;
    let id = taskId && taskById(project, taskId) ? taskId : undefined;
    if (project.primaryView !== "tasks") return project;
    if (update) {
      if (
        !id ||
        !wholePlanName ||
        !taskById(project, id)?.sourcePlans?.some((source) => aliases.includes(source.plan))
      )
        return project;
      title = taskById(project, id)!.title;
      made = id;
      return syncTaskPlan(project, id, { plan, name: wholePlanName }, aliases, cards);
    }
    if (!id) {
      const added = addTask(next, {
        title: wholePlanName ?? titleForCards(cards.map((card) => card.name)),
        author,
      });
      next = added.project;
      id = added.id;
    }
    title = taskById(next, id)?.title ?? "";
    if (wholePlanName && plan) next = addTaskSourcePlan(next, id, { plan, name: wholePlanName });
    for (const card of cards) {
      const link: PlanTaskLink = { plan, node: card.nodeId };
      next = addThing(next, id, { kind: "machine", text: cardLine(card), link });
    }
    made = id;
    return next;
  });
  // Back to the plan the cards are on, once the board's edit is safe.
  if (from) {
    if (boardId) await settled(boardId, 8000);
    const back = useDesignStore.getState().designs.find((design) => design.id === from.id);
    if (back) await activateDesign(back);
  }
  if (!made || !boardId) {
    showLiveNotice(
      update ? "That task is no longer linked to this plan." : "The task could not be added.",
    );
    return undefined;
  }
  const task = made;
  const what = cards.length === 1 ? cards[0]!.name : `${cards.length} machines`;
  showLiveNotice(
    update ? `Updated '${title}' from '${wholePlanName}'` : `Added ${what} to '${title}'`,
    {
      label: "Open",
      run: () => {
        useLiveSession.setState({ notice: undefined });
        const board = useDesignStore.getState().designs.find((design) => design.id === boardId);
        if (!board) return;
        void activateDesign(board).then(() => openWhenShown(boardId, task));
      },
    },
  );
  return task;
}
