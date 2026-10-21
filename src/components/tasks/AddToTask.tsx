"use client";

import { create } from "zustand";
import { ChromeMenu, type ChromeAnchor, type MenuEntry } from "@/components/chrome/ChromeMenu";
import {
  addCardsToTask,
  captureTaskPlan,
  taskBoardChoices,
  taskChoices,
  updateTaskFromPlan,
  type PlanTaskTarget,
  type TaskBoardChoice,
  type TaskCard,
  type TaskChoice,
  type TaskPlanSnapshot,
} from "@/lib/tasks/make-task";
import { TASK_STATUS_COLOR } from "@/lib/tasks/task-links";
import { showLiveNotice } from "@/store/live-session";

/**
 * Add to a task's two menus (the game's TaskActions.addMenu): "Which task board" (each with how many tasks, then New
 * task board), then the board's tasks (New task in To do first, then the tasks under way, each with its status dot and
 * its things done of all). Opened from anywhere with `openAddToTask`; mounted once beside the board.
 */
interface AddToTaskState {
  open?: {
    cards: TaskCard[];
    anchor: ChromeAnchor;
    boards?: TaskBoardChoice[];
    board?: TaskBoardChoice;
    tasks?: TaskChoice[];
    source?: TaskPlanSnapshot;
  };
}

const useAddToTask = create<AddToTaskState>(() => ({}));
const useUpdateTask = create<{ open?: { anchor: ChromeAnchor; targets: PlanTaskTarget[] } }>(
  () => ({}),
);

export function openUpdateTask(anchor: ChromeAnchor, targets: PlanTaskTarget[]): void {
  useUpdateTask.setState({ open: { anchor, targets } });
}

export async function openAddToTask(
  cards: TaskCard[],
  anchor: ChromeAnchor,
  source?: TaskPlanSnapshot,
): Promise<void> {
  if (cards.length === 0) return;
  useAddToTask.setState({ open: { cards, anchor, source } });
  const boards = await taskBoardChoices();
  const now = useAddToTask.getState().open;
  if (now?.cards === cards) useAddToTask.setState({ open: { ...now, boards } });
}

/** The plan becomes one task, with one checklist line per machine card. */
export async function openAddPlanToTask(anchor: ChromeAnchor): Promise<void> {
  const source = await captureTaskPlan();
  if (!source) return;
  if (source.cards.length === 0) {
    showLiveNotice("This plan has no machines to add.");
    return;
  }
  await openAddToTask(source.cards, anchor, source);
}

async function pickBoard(board: TaskBoardChoice): Promise<void> {
  const now = useAddToTask.getState().open;
  if (!now) return;
  useAddToTask.setState({ open: { ...now, board, tasks: undefined } });
  const tasks = await taskChoices(board.id);
  const after = useAddToTask.getState().open;
  if (after?.board === board) useAddToTask.setState({ open: { ...after, tasks } });
}

function close() {
  useAddToTask.setState({ open: undefined });
}

export function AddToTaskMenu() {
  const open = useAddToTask((state) => state.open);
  const update = useUpdateTask((state) => state.open);
  if (update)
    return (
      <ChromeMenu
        anchor={update.anchor}
        label="Update a task"
        title="Update a task"
        minWidth={180}
        onClose={() => useUpdateTask.setState({ open: undefined })}
        entries={update.targets.map((task) => ({
          label: task.title,
          detail: task.boardName,
          dot: TASK_STATUS_COLOR[task.status],
          onSelect: () => void updateTaskFromPlan(task.boardId, task.id),
        }))}
      />
    );
  if (!open || (!open.board && !open.boards) || (open.board && !open.tasks)) return null;
  const { cards, source } = open;
  if (open.board && open.tasks) {
    const board = open.board;
    const entries: MenuEntry[] = [
      {
        label: "New task",
        detail: "in To do",
        plus: true,
        onSelect: () => void addCardsToTask(cards, board.id, undefined, { source }),
      },
      ...open.tasks.map((task, at) => ({
        label: task.title,
        dot: TASK_STATUS_COLOR[task.status],
        detail: task.all === 0 ? "" : `${task.done}/${task.all}`,
        ruleAbove: at === 0,
        onSelect: () => void addCardsToTask(cards, board.id, task.id, { source }),
      })),
    ];
    return (
      <ChromeMenu
        anchor={open.anchor}
        entries={entries}
        label="Which task"
        title={board.name}
        minWidth={180}
        onClose={close}
      />
    );
  }
  const boards = open.boards ?? [];
  const entries: MenuEntry[] = [
    ...boards.map((board) => ({
      label: board.name,
      detail: board.tasks === 0 ? "" : `${board.tasks} ${board.tasks === 1 ? "task" : "tasks"}`,
      // The menu stays open for the second step: the row's own close is undone by the next menu opening.
      onSelect: () => {
        const anchor = open.anchor;
        useAddToTask.setState({ open: { cards, anchor, boards, source } });
        void pickBoard(board);
      },
    })),
    {
      label: "New task board",
      ruleAbove: boards.length > 0,
      onSelect: () => void addCardsToTask(cards, undefined, undefined, { source }),
    },
  ];
  return (
    <ChromeMenu
      anchor={open.anchor}
      entries={entries}
      label="Which task board"
      title="Which task board"
      minWidth={160}
      onClose={close}
    />
  );
}
