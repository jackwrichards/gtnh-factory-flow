"use client";

import "./tasks.css";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChromeMenu, type ChromeAnchor, type MenuEntry } from "@/components/chrome/ChromeMenu";
import { PixelIcon } from "@/components/chrome/pixel-icons";
import { tipAttrs } from "@/components/flow/clean/interaction";
import type { FactoryProject, PlanPicture, PlanTask, PlanTaskStatus } from "@/lib/model/types";
import {
  addTask,
  deleteTask,
  firstPicture,
  inColumnText,
  moveTask,
  moveTaskTo,
  NEW_TASK_TITLE,
  shownPriority,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  taskCardCounts,
  timeDotCount,
} from "@/lib/tasks/task-board";
import { byOrder } from "@/lib/tasks/order-key";
import { selectTask, useTaskBoardUi, useTaskView } from "@/lib/tasks/task-board-ui";
import { startTaskLinkIndex } from "@/lib/tasks/task-link-index";
import { TASK_STATUS_COLOR } from "@/lib/tasks/task-links";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { TaskBox } from "./TaskBox";
import { TaskChainView } from "./TaskChainView";
import { PriorityIcon, StatusDot, TaskFaces, TimeDots, useNameOf } from "./task-look";
import { useTaskAuthor } from "./task-people";
import { TaskPlanLabel } from "./TaskPlanLabel";

/**
 * A task board, the game's TaskBoardView: four columns, Blocked, To do, Doing and Done, each a stack of task cards.
 * A press let go within the slop is a click and opens the task in its box; moved further it carries the card and
 * letting go puts it where the gap shows. A column's + and the header's New task make a task at once and open it.
 * Covers the board the way the Library does, so the board underneath keeps its camera and its solve. The header (the
 * board's name, Board / Chain, New task) is the board toolbar's (BoardToolbar).
 */
export function TaskBoard() {
  const designId = useDesignStore((state) => state.activeDesignId);
  const view = useTaskView(designId);
  const tasks = useFactoryStore((state) => state.project.tasks);
  const editTasks = useFactoryStore((state) => state.editTasks);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const author = useTaskAuthor();
  const selectedId = useTaskBoardUi((state) => state.selectedId);
  const newTaskTick = useTaskBoardUi((state) => state.newTaskTick);

  const make = (status: PlanTaskStatus) => {
    if (isReadOnly) return;
    let made: string | undefined;
    editTasks((project) => {
      const result = addTask(project, { title: NEW_TASK_TITLE, status, author });
      made = result.id;
      return result.project;
    });
    if (made) selectTask(made);
  };

  // New task in the header: a task in To do at once, open in its box.
  const seenTick = useRef(newTaskTick);
  useEffect(() => {
    if (newTaskTick === seenTick.current) return;
    seenTick.current = newTaskTick;
    make("todo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTaskTick]);

  // Leaving a board closes its box (the game's box belongs to its board).
  useEffect(() => () => selectTask(undefined), [designId]);

  const selected = selectedId ? (tasks ?? []).find((task) => task.id === selectedId) : undefined;

  return (
    <div className="tb" data-task-board="" data-task-view={view}>
      {view === "chain" ? <TaskChainView key={designId} /> : <Columns onMake={make} />}
      {selected ? (
        <TaskBox key={selected.id} task={selected} onClose={() => selectTask(undefined)} />
      ) : null}
    </div>
  );
}

/** GUI pixels a press travels before it carries the card (the game's DRAG_SLOP). */
const DRAG_SLOP = 6;

interface Carry {
  id: string;
  /** The pointer in the card, and the card's size, in GUI pixels. */
  grabX: number;
  grabY: number;
  w: number;
  h: number;
  /** Where the card is drawn, in the board's GUI pixels. */
  x: number;
  y: number;
}

function Columns({ onMake }: { onMake: (status: PlanTaskStatus) => void }) {
  const tasks = useFactoryStore((state) => state.project.tasks);
  const items = useFactoryStore((state) => state.project.taskItems);
  const comments = useFactoryStore((state) => state.project.taskComments);
  const editTasks = useFactoryStore((state) => state.editTasks);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const nameOf = useNameOf();
  const rootRef = useRef<HTMLDivElement>(null);
  const [carry, setCarry] = useState<Carry>();
  const [drop, setDrop] = useState<{ status: PlanTaskStatus; index: number }>();
  const [menu, setMenu] = useState<{ task: PlanTask; anchor: ChromeAnchor }>();
  const suppressClick = useRef(false);

  const columns = useMemo(() => {
    const byStatus = new Map<PlanTaskStatus, PlanTask[]>(
      TASK_STATUSES.map((status) => [status, []]),
    );
    for (const task of tasks ?? []) byStatus.get(task.status)?.push(task);
    for (const [status, list] of byStatus) byStatus.set(status, byOrder(list));
    return byStatus;
  }, [tasks]);

  // Each task's things done of all, comments and first screenshot, worked out once per change of the plan.
  const facts = useMemo(() => {
    const project = { tasks, taskItems: items, taskComments: comments } as FactoryProject;
    const out = new Map<
      string,
      { counts: ReturnType<typeof taskCardCounts>; picture?: PlanPicture }
    >();
    for (const task of tasks ?? []) {
      out.set(task.id, {
        counts: taskCardCounts(project, task.id),
        picture: firstPicture(project, task.id),
      });
    }
    return out;
  }, [tasks, items, comments]);

  const board = () => rootRef.current?.closest<HTMLElement>(".tb") ?? undefined;
  /** Screen pixels per GUI pixel here (the views' zoom). */
  const scale = () => {
    const root = board();
    return root && root.offsetWidth > 0 ? root.getBoundingClientRect().width / root.offsetWidth : 2;
  };
  const local = (clientX: number, clientY: number) => {
    const box = board()?.getBoundingClientRect();
    const k = scale();
    return box ? { x: (clientX - box.left) / k, y: (clientY - box.top) / k } : { x: 0, y: 0 };
  };

  /** Where a carried card would land: the column under the pointer, its place there by the cards' middles. */
  const findDrop = (clientX: number, middleY: number, held: string) => {
    const lists = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-task-list]") ?? [])];
    if (lists.length === 0) return undefined;
    let list = lists[0]!;
    for (const each of lists) {
      if (clientX >= each.getBoundingClientRect().left - 8) list = each;
    }
    const status = list.dataset.taskList as PlanTaskStatus;
    let index = 0;
    for (const card of list.querySelectorAll<HTMLElement>("[data-task-card]")) {
      if (card.dataset.taskCard === held) continue;
      const box = card.getBoundingClientRect();
      if (middleY < box.top + box.height / 2) break;
      index += 1;
    }
    return { status, index };
  };

  const beginPress = (event: React.PointerEvent<HTMLElement>, task: PlanTask) => {
    if (event.button !== 0 || isReadOnly) return;
    const card = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let active: Carry | undefined;
    let landing: { status: PlanTaskStatus; index: number } | undefined;
    const move = (moved: PointerEvent) => {
      const k = scale();
      if (!active) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_SLOP * k) return;
        const box = card.getBoundingClientRect();
        const at = local(box.left, box.top);
        active = {
          id: task.id,
          grabX: (startX - box.left) / k,
          grabY: (startY - box.top) / k,
          w: box.width / k,
          h: box.height / k,
          x: at.x,
          y: at.y,
        };
      }
      const point = local(moved.clientX, moved.clientY);
      active = { ...active, x: point.x - active.grabX, y: point.y - active.grabY };
      setCarry(active);
      const middle = moved.clientY - active.grabY * k + (active.h * k) / 2;
      const next = findDrop(moved.clientX, middle, task.id);
      if (next?.status !== landing?.status || next?.index !== landing?.index) {
        landing = next;
        setDrop(next);
      }
      // Near a column's top or bottom, the column scrolls.
      const list = next
        ? rootRef.current?.querySelector<HTMLElement>(`[data-task-list="${next.status}"]`)
        : null;
      if (list) {
        const box = list.getBoundingClientRect();
        if (moved.clientY < box.top + 16 * k) list.scrollTop -= 6;
        else if (moved.clientY > box.bottom - 16 * k) list.scrollTop += 6;
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (active) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        if (landing) {
          const to = landing;
          editTasks((project) => moveTask(project, task.id, to.status, to.index));
        }
        setCarry(undefined);
        setDrop(undefined);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const empty = (tasks ?? []).length === 0;
  const carried = carry ? (tasks ?? []).find((task) => task.id === carry.id) : undefined;

  const menuEntries = (task: PlanTask): MenuEntry[] => [
    { label: "Open", onSelect: () => selectTask(task.id) },
    ...TASK_STATUSES.filter((status) => status !== task.status).map((status) => ({
      label: `Move to ${TASK_STATUS_LABEL[status]}`,
      disabled: isReadOnly,
      onSelect: () => editTasks((project) => moveTaskTo(project, task.id, status)),
    })),
    {
      label: "Delete task",
      tone: "red" as const,
      ruleAbove: true,
      disabled: isReadOnly,
      onSelect: () => editTasks((project) => deleteTask(project, task.id)),
    },
  ];

  return (
    <div ref={rootRef} className="tb-columns" data-task-columns="">
      {TASK_STATUSES.map((status) => {
        const list = columns.get(status) ?? [];
        const label = TASK_STATUS_LABEL[status];
        let place = 0;
        const gapAt = carry && drop?.status === status ? drop.index : -1;
        return (
          <section key={status} className="tb-col" data-task-column={status}>
            <header className="tb-col-head">
              <StatusDot status={status} />
              <span className="tb-col-name">{label}</span>
              <span className="tb-col-count">{list.length}</span>
              {isReadOnly ? null : (
                <button
                  type="button"
                  className="tb-add"
                  aria-label={`Add a task to ${label}`}
                  data-task-add={status}
                  {...tipAttrs({ id: `task-add|${status}`, title: `Add a task to ${label}` })}
                  onClick={() => onMake(status)}
                />
              )}
            </header>
            <div
              className="tb-well"
              data-task-list={status}
              data-drop-here={gapAt >= 0 ? "" : undefined}
              style={{ ["--tb-drop" as string]: TASK_STATUS_COLOR[status] }}
            >
              {list.map((task) => {
                const here = task.id !== carry?.id && gapAt === place;
                if (task.id !== carry?.id) place += 1;
                return (
                  <FragmentWithGap key={task.id} gap={here ? carry!.h : undefined}>
                    <TaskCard
                      task={task}
                      facts={facts.get(task.id)}
                      nameOf={nameOf}
                      carried={task.id === carry?.id}
                      onPress={(event) => beginPress(event, task)}
                      onOpen={() => {
                        if (!suppressClick.current) selectTask(task.id);
                      }}
                      onMenu={(anchor) => setMenu({ task, anchor })}
                    />
                  </FragmentWithGap>
                );
              })}
              {carry && gapAt >= place ? (
                <div className="tb-gap" style={{ height: carry.h }} />
              ) : null}
              {empty && status === TASK_STATUSES[0] ? (
                <div className="tb-empty" data-task-empty="">
                  <p>No tasks yet.</p>
                  <p>Press + to add one.</p>
                  <p>Or add a card from its menu.</p>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
      {carry && carried ? (
        <TaskCard
          task={carried}
          facts={facts.get(carried.id)}
          nameOf={nameOf}
          lifted={{ x: carry.x, y: carry.y, w: carry.w }}
          onPress={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
        />
      ) : null}
      {menu ? (
        <ChromeMenu
          anchor={menu.anchor}
          entries={menuEntries(menu.task)}
          label="Task"
          minWidth={120}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </div>
  );
}

function FragmentWithGap({
  gap,
  children,
}: {
  gap: number | undefined;
  children: React.ReactNode;
}) {
  return (
    <>
      {gap !== undefined ? <div className="tb-gap" style={{ height: gap }} /> : null}
      {children}
    </>
  );
}

const TaskCard = memo(function TaskCard({
  task,
  facts,
  nameOf,
  carried,
  lifted,
  onPress,
  onOpen,
  onMenu,
}: {
  task: PlanTask;
  facts?: { counts: ReturnType<typeof taskCardCounts>; picture?: PlanPicture };
  nameOf: (id: string) => string | undefined;
  carried?: boolean;
  lifted?: { x: number; y: number; w: number };
  onPress: (event: React.PointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onMenu: (anchor: ChromeAnchor) => void;
}) {
  const assignees = task.assignees ?? [];
  const counts = facts?.counts;
  const priority = shownPriority(task);
  const meta =
    assignees.length > 0 ||
    (counts?.items ?? 0) > 0 ||
    (counts?.comments ?? 0) > 0 ||
    timeDotCount(task) > 0;
  return (
    <div
      role="button"
      tabIndex={lifted ? -1 : 0}
      className="tb-card"
      data-task-card={lifted ? undefined : task.id}
      data-task-title={lifted ? undefined : task.title}
      data-status={task.status}
      data-carried={carried ? "" : undefined}
      data-lifted={lifted ? "" : undefined}
      style={{
        ["--tb-stripe" as string]: TASK_STATUS_COLOR[task.status],
        ...(lifted ? { left: lifted.x, top: lifted.y, width: lifted.w } : {}),
      }}
      {...(lifted
        ? {}
        : tipAttrs({
            id: `task|${task.id}`,
            title: task.title,
            sub: inColumnText(task),
            rows: [{ label: "Priority", value: TASK_PRIORITY_LABEL[priority] }],
            actions: [
              { input: "left", label: "Open it" },
              { input: "drag", label: "Move it" },
              { input: "right", label: "More" },
            ],
          }))}
      onPointerDown={onPress}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ left: event.clientX, top: event.clientY, bottom: event.clientY });
      }}
    >
      {facts?.picture ? (
        <img className="tb-card-pic" src={facts.picture.thumb} alt="" draggable={false} />
      ) : null}
      <div className="tb-card-body">
        <TaskPlanLabel task={task} />
        <div className="tb-card-top">
          <span className="tb-card-title">{task.title}</span>
          <PriorityIcon priority={priority} />
        </div>
        {meta ? (
          <div className="tb-card-meta">
            <TaskFaces ids={assignees} nameOf={nameOf} />
            <TimeDots task={task} />
            <span className="tb-grow" />
            {counts && counts.items > 0 ? (
              <span
                className="tb-count"
                data-all={counts.done === counts.items ? "" : undefined}
                data-task-things=""
              >
                <PixelIcon name="check" />
                {counts.done}/{counts.items}
              </span>
            ) : null}
            {counts && counts.comments > 0 ? (
              <span className="tb-count" data-task-comments-count="">
                <PixelIcon name="comment" />
                {counts.comments}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** Keeps the dots on cards current: which cards some task board is about. Mounted once beside the board. */
export function TaskLinkIndexController() {
  useEffect(() => startTaskLinkIndex(), []);
  return null;
}
