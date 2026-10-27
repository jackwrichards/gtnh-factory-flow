import { randomUUID } from "@/lib/random-id";
import type {
  FactoryProject,
  PlanPlace,
  PlanPicture,
  PlanTask,
  PlanTaskComment,
  PlanTaskItem,
  PlanTaskItemKind,
  PlanTaskLink,
  PlanTaskPriority,
  PlanTaskStatus,
  PlanTaskSourcePlan,
} from "@/lib/model/types";
import { PLAN_TASK_LIMITS } from "@/lib/model/schemas";
import { byOrder, orderBetween } from "./order-key";

/**
 * The task board's edits, pure, as the game's TaskEdits: each takes the plan and gives the plan after it, or the
 * same object when nothing changed. Tasks, their things and comments are things of their own (`tasks`,
 * `taskItems`, `taskComments`), so two people ticking two things, or moving two cards, change different things. A
 * move writes one order key (order-key.ts).
 */

/** The title a task starts with when New task or a column's + makes it. */
export const NEW_TASK_TITLE = "New task";

/** The columns, left to right: Blocked, To do, Doing, Done. */
export const TASK_STATUSES: readonly PlanTaskStatus[] = ["blocked", "todo", "doing", "done"];

export const TASK_STATUS_LABEL: Record<PlanTaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
};

export const TASK_PRIORITIES: readonly PlanTaskPriority[] = ["high", "medium", "low"];

export const TASK_PRIORITY_LABEL: Record<PlanTaskPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** A priority's colour: red-orange high, amber medium, blue low. */
export const TASK_PRIORITY_COLOR: Record<PlanTaskPriority, string> = {
  high: "#f2602f",
  medium: "#f5b83d",
  low: "#4f9bf2",
};

/** The priority a task shows: none, or one this build does not know, is Medium. */
export function shownPriority(task: Pick<PlanTask, "priority">): PlanTaskPriority {
  return task.priority === "high" || task.priority === "low" ? task.priority : "medium";
}

export interface TaskAuthor {
  id: string;
  username: string;
}

function tasksOf(project: FactoryProject): PlanTask[] {
  return project.tasks ?? [];
}

function itemsOf(project: FactoryProject): PlanTaskItem[] {
  return project.taskItems ?? [];
}

function commentsOf(project: FactoryProject): PlanTaskComment[] {
  return project.taskComments ?? [];
}

export function taskById(project: FactoryProject, id: string): PlanTask | undefined {
  return tasksOf(project).find((task) => task.id === id);
}

/** A column's tasks, top to bottom. */
export function tasksIn(project: FactoryProject, status: PlanTaskStatus): PlanTask[] {
  return byOrder(tasksOf(project).filter((task) => task.status === status));
}

/** The board's tasks in its order: column by column, top first. */
export function boardOrder(project: FactoryProject): PlanTask[] {
  return TASK_STATUSES.flatMap((status) => tasksIn(project, status));
}

/** A task's things, top to bottom. */
export function itemsOfTask(project: FactoryProject, taskId: string): PlanTaskItem[] {
  return byOrder(itemsOf(project).filter((item) => item.taskId === taskId));
}

/** A task's comments, oldest first. */
export function commentsOfTask(project: FactoryProject, taskId: string): PlanTaskComment[] {
  return commentsOf(project)
    .filter((comment) => comment.taskId === taskId)
    .sort((left, right) =>
      left.at < right.at ? -1 : left.at > right.at ? 1 : left.id < right.id ? -1 : 1,
    );
}

export function clipTitle(title: string): string {
  return title.trim().slice(0, PLAN_TASK_LIMITS.titleLength).trim();
}

/** A new task at the bottom of its column, its column stamp now. Returns the plan and the task's id. */
export function addTask(
  project: FactoryProject,
  input: {
    title: string;
    status?: PlanTaskStatus;
    author?: TaskAuthor;
    links?: PlanTaskLink[];
    id?: string;
  },
  now = new Date().toISOString(),
): { project: FactoryProject; id: string } {
  const title = clipTitle(input.title);
  const id = input.id ?? randomUUID();
  if (!title) {
    return { project, id };
  }
  const status = input.status ?? "todo";
  const column = tasksIn(project, status);
  const task: PlanTask = {
    id,
    title,
    status,
    order: orderBetween(column.at(-1)?.order),
    createdAt: now,
    ...(input.links && input.links.length > 0 ? { links: uniqueLinks(input.links) } : {}),
    ...(input.author ? { createdBy: input.author.id } : {}),
    ...(status === "done" ? { doneAt: now } : {}),
    movedAt: now,
  };
  return { project: { ...project, tasks: [...tasksOf(project), task] }, id };
}

const linkKeyOf = (link: PlanTaskLink) => `${link.plan}\u0000${link.node}`;

/** Records an explicit whole-plan addition; machine links alone never imply a whole plan. */
export function addTaskSourcePlan(
  project: FactoryProject,
  id: string,
  source: PlanTaskSourcePlan,
): FactoryProject {
  const task = taskById(project, id);
  const name = clipTitle(source.name);
  if (
    !task ||
    !source.plan ||
    !name ||
    (task.sourcePlans?.length ?? 0) >= PLAN_TASK_LIMITS.nodeIds ||
    task.sourcePlans?.some((entry) => entry.plan === source.plan)
  )
    return project;
  return {
    ...project,
    tasks: tasksOf(project).map((entry) =>
      entry.id === id
        ? { ...entry, sourcePlans: [...(entry.sourcePlans ?? []), { plan: source.plan, name }] }
        : entry,
    ),
  };
}

/** A link list without repeats (the same plan and card twice), in order, within the schema's bound. */
export function uniqueLinks(links: readonly PlanTaskLink[]): PlanTaskLink[] {
  const seen = new Set<string>();
  const out: PlanTaskLink[] = [];
  for (const link of links) {
    const key = linkKeyOf(link);
    if (!seen.has(key) && out.length < PLAN_TASK_LIMITS.nodeIds) {
      seen.add(key);
      out.push({ plan: link.plan, node: link.node });
    }
  }
  return out;
}

type TaskPatch = Partial<
  Pick<PlanTask, "title" | "text" | "assignees" | "nodeIds" | "links" | "priority">
>;

/** Sets fields of one task; an empty text, assignee list or card list is removed, and Medium is written as none. */
export function updateTask(project: FactoryProject, id: string, patch: TaskPatch): FactoryProject {
  let changed = false;
  const tasks = tasksOf(project).map((task) => {
    if (task.id !== id) {
      return task;
    }
    const next: PlanTask = { ...task };
    if (patch.title !== undefined) {
      const title = clipTitle(patch.title);
      if (title && title !== task.title) {
        next.title = title;
        changed = true;
      }
    }
    if (patch.text !== undefined) {
      const text = patch.text.trim() ? patch.text.slice(0, PLAN_TASK_LIMITS.textLength) : "";
      if ((text || undefined) !== task.text) {
        if (text) {
          next.text = text;
        } else {
          delete next.text;
        }
        changed = true;
      }
    }
    if (patch.priority !== undefined) {
      const priority = patch.priority === "medium" ? undefined : patch.priority;
      if (priority !== task.priority) {
        if (priority) {
          next.priority = priority;
        } else {
          delete next.priority;
        }
        changed = true;
      }
    }
    if (patch.links !== undefined) {
      const links = uniqueLinks(patch.links);
      const before = task.links ?? [];
      if (
        links.length !== before.length ||
        links.some((link, at) => link.plan !== before[at]!.plan || link.node !== before[at]!.node)
      ) {
        if (links.length > 0) {
          next.links = links;
        } else {
          delete next.links;
        }
        changed = true;
      }
    }
    for (const key of ["assignees", "nodeIds"] as const) {
      const list = patch[key];
      if (list === undefined) {
        continue;
      }
      const unique = [...new Set(list)];
      const before = task[key] ?? [];
      if (unique.length !== before.length || unique.some((value, at) => value !== before[at])) {
        if (unique.length > 0) {
          next[key] = unique;
        } else {
          delete next[key];
        }
        changed = true;
      }
    }
    return next;
  });
  return changed ? { ...project, tasks } : project;
}

/**
 * Moves a task into `status` at `index` among that column's other tasks (the end when out of range). Moving to
 * another column stamps `movedAt`; into Done stamps `doneAt` (kept when it was already done), out of it clears it.
 */
export function moveTask(
  project: FactoryProject,
  id: string,
  status: PlanTaskStatus,
  index: number,
  now = new Date().toISOString(),
): FactoryProject {
  const task = taskById(project, id);
  if (!task) {
    return project;
  }
  const column = tasksIn(project, status).filter((entry) => entry.id !== id);
  const at = Math.max(0, Math.min(index, column.length));
  const before = column[at - 1];
  const after = column[at];
  // Already there: nothing to write.
  if (
    task.status === status &&
    tasksIn(project, status).findIndex((entry) => entry.id === id) === at
  ) {
    return project;
  }
  const next: PlanTask = { ...task, status, order: orderBetween(before?.order, after?.order) };
  if (status !== task.status) {
    next.movedAt = now;
  }
  if (status === "done" && task.status !== "done") {
    next.doneAt = now;
  } else if (status !== "done") {
    delete next.doneAt;
  }
  return {
    ...project,
    tasks: tasksOf(project).map((entry) => (entry.id === id ? next : entry)),
  };
}

/** Moves a task to the bottom of another column (the status picker). */
export function moveTaskTo(
  project: FactoryProject,
  id: string,
  status: PlanTaskStatus,
  now = new Date().toISOString(),
): FactoryProject {
  const task = taskById(project, id);
  if (!task || task.status === status) {
    return project;
  }
  return moveTask(project, id, status, tasksIn(project, status).length, now);
}

/** Removes a task with its things and comments; the tasks that waited on it wait on it no more. */
export function deleteTask(project: FactoryProject, id: string): FactoryProject {
  if (!taskById(project, id)) {
    return project;
  }
  const next: FactoryProject = {
    ...project,
    tasks: tasksOf(project)
      .filter((task) => task.id !== id)
      .map((task) =>
        task.blockedBy?.includes(id)
          ? withBlockedBy(
              task,
              task.blockedBy.filter((b) => b !== id),
            )
          : task,
      ),
  };
  if (itemsOf(project).some((item) => item.taskId === id)) {
    next.taskItems = itemsOf(project).filter((item) => item.taskId !== id);
  }
  if (commentsOf(project).some((comment) => comment.taskId === id)) {
    next.taskComments = commentsOf(project).filter((comment) => comment.taskId !== id);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Waiting on
// ---------------------------------------------------------------------------

function withBlockedBy(task: PlanTask, blockedBy: readonly string[]): PlanTask {
  const waits = [...new Set(blockedBy.filter((id) => id !== task.id))];
  const next = { ...task };
  if (waits.length > 0) {
    next.blockedBy = waits;
  } else {
    delete next.blockedBy;
  }
  return next;
}

/** The tasks a task waits on that are on the board, in the order it lists them. */
export function blockersOf(project: FactoryProject, id: string): PlanTask[] {
  const task = taskById(project, id);
  const out: PlanTask[] = [];
  for (const blocker of task?.blockedBy ?? []) {
    const found = blocker !== id ? taskById(project, blocker) : undefined;
    if (found && !out.includes(found)) {
      out.push(found);
    }
  }
  return out;
}

/** The tasks waiting on a task (what it unblocks), in the board's order. */
export function unblockedBy(project: FactoryProject, id: string): PlanTask[] {
  return boardOrder(project).filter((task) => task.id !== id && task.blockedBy?.includes(id));
}

/** Whether `task` waiting on `blocker` would close a loop: the blocker is the task, or waits on it down the chain. */
export function wouldLoop(project: FactoryProject, task: string, blocker: string): boolean {
  if (task === blocker) {
    return true;
  }
  const seen = new Set<string>();
  const todo = [blocker];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (seen.has(at)) {
      continue;
    }
    seen.add(at);
    for (const next of taskById(project, at)?.blockedBy ?? []) {
      if (next === task) {
        return true;
      }
      todo.push(next);
    }
  }
  return false;
}

/**
 * Makes `task` wait on `blocker`. Refused (the same plan) when either is not on the board, it already waits on it,
 * or it would close a loop.
 */
export function addBlocker(project: FactoryProject, task: string, blocker: string): FactoryProject {
  const found = taskById(project, task);
  if (
    !found ||
    !taskById(project, blocker) ||
    found.blockedBy?.includes(blocker) ||
    (found.blockedBy?.length ?? 0) >= PLAN_TASK_LIMITS.blockedBy ||
    wouldLoop(project, task, blocker)
  ) {
    return project;
  }
  const next = withBlockedBy(found, [...(found.blockedBy ?? []), blocker]);
  return { ...project, tasks: tasksOf(project).map((entry) => (entry.id === task ? next : entry)) };
}

/** `task` waits on `blocker` no more. */
export function removeBlocker(
  project: FactoryProject,
  task: string,
  blocker: string,
): FactoryProject {
  const found = taskById(project, task);
  if (!found?.blockedBy?.includes(blocker)) {
    return project;
  }
  const next = withBlockedBy(
    found,
    found.blockedBy.filter((id) => id !== blocker),
  );
  return { ...project, tasks: tasksOf(project).map((entry) => (entry.id === task ? next : entry)) };
}

// ---------------------------------------------------------------------------
// Things
// ---------------------------------------------------------------------------

/**
 * What a thing shows as: its kind when it carries what that kind needs, else an older line: a machine when it
 * points at a card, words ("") when not.
 */
export function shownKind(item: PlanTaskItem): PlanTaskItemKind | "" {
  if (
    (item.kind === "machine" && item.link) ||
    (item.kind === "location" && item.place) ||
    (item.kind === "picture" && item.picture)
  ) {
    return item.kind;
  }
  return item.link || item.nodeId ? "machine" : "";
}

/** A location in words: its label and its block, "Ore field at 120 64 -30 in Overworld". */
export function placeText(place: PlanPlace): string {
  const at = `${place.x} ${place.y} ${place.z}${place.dimName ? ` in ${place.dimName}` : ""}`;
  return place.label ? `${place.label} at ${at}` : at;
}

/**
 * A new thing at the bottom of a task's things, not done: a machine (`link`), a location (`place`), a screenshot
 * (`picture`) or, with no kind, words. `text` is the thing in words.
 */
export function addThing(
  project: FactoryProject,
  taskId: string,
  thing: {
    kind?: PlanTaskItemKind;
    text: string;
    link?: PlanTaskLink;
    place?: PlanPlace;
    picture?: PlanPicture;
    id?: string;
    done?: boolean;
  },
): FactoryProject {
  const clipped = thing.text.trim().slice(0, PLAN_TASK_LIMITS.itemTextLength).trim();
  if (!clipped || !taskById(project, taskId)) {
    return project;
  }
  const last = itemsOfTask(project, taskId).at(-1);
  const item: PlanTaskItem = {
    id: thing.id ?? randomUUID(),
    taskId,
    ...(thing.kind ? { kind: thing.kind } : {}),
    text: clipped,
    done: thing.done ?? false,
    order: orderBetween(last?.order),
    ...(thing.link ? { link: { plan: thing.link.plan, node: thing.link.node } } : {}),
    ...(thing.place ? { place: thing.place } : {}),
    ...(thing.picture ? { picture: thing.picture } : {}),
  };
  return { ...project, taskItems: [...itemsOf(project), item] };
}

/** A line of words at the bottom of a task's things (an older checklist's line), optionally about a card. */
export function addTaskItem(
  project: FactoryProject,
  taskId: string,
  text: string,
  link?: PlanTaskLink,
): FactoryProject {
  return addThing(project, taskId, { text, link });
}

export function updateTaskItem(
  project: FactoryProject,
  id: string,
  patch: Partial<Pick<PlanTaskItem, "text" | "done">>,
): FactoryProject {
  let changed = false;
  const taskItems = itemsOf(project).map((item) => {
    if (item.id !== id) {
      return item;
    }
    const next = { ...item };
    if (patch.done !== undefined && patch.done !== item.done) {
      next.done = patch.done;
      changed = true;
    }
    if (patch.text !== undefined) {
      const text = patch.text.trim().slice(0, PLAN_TASK_LIMITS.itemTextLength).trim();
      if (text && text !== item.text) {
        next.text = text;
        changed = true;
      }
    }
    return next;
  });
  return changed ? { ...project, taskItems } : project;
}

/** Moves a thing to `index` among the other things of its task (0 the top). */
export function moveTaskItemTo(project: FactoryProject, id: string, index: number): FactoryProject {
  const item = itemsOf(project).find((entry) => entry.id === id);
  if (!item) {
    return project;
  }
  const lines = itemsOfTask(project, item.taskId);
  const others = lines.filter((entry) => entry.id !== id);
  const at = Math.max(0, Math.min(index, others.length));
  if (lines.findIndex((entry) => entry.id === id) === at) {
    return project;
  }
  const order = orderBetween(others[at - 1]?.order, others[at]?.order);
  return {
    ...project,
    taskItems: itemsOf(project).map((entry) => (entry.id === id ? { ...entry, order } : entry)),
  };
}

/** Moves a thing up (-1) or down (+1) one place. */
export function moveTaskItem(
  project: FactoryProject,
  id: string,
  direction: -1 | 1,
): FactoryProject {
  const item = itemsOf(project).find((entry) => entry.id === id);
  if (!item) {
    return project;
  }
  const at = itemsOfTask(project, item.taskId).findIndex((entry) => entry.id === id);
  return moveTaskItemTo(project, id, at + direction);
}

export function deleteTaskItem(project: FactoryProject, id: string): FactoryProject {
  return itemsOf(project).some((item) => item.id === id)
    ? { ...project, taskItems: itemsOf(project).filter((item) => item.id !== id) }
    : project;
}

/**
 * Takes a thing off its task; a card it was also linked by (an older task's link) goes with it, so it does not come
 * back as a loose card.
 */
export function removeThing(project: FactoryProject, id: string): FactoryProject {
  const item = itemsOf(project).find((entry) => entry.id === id);
  if (!item) {
    return project;
  }
  let next = deleteTaskItem(project, id);
  const task = taskById(next, item.taskId);
  const link = item.link;
  if (
    task &&
    link &&
    task.links?.some((entry) => entry.plan === link.plan && entry.node === link.node)
  ) {
    next = updateTask(next, task.id, {
      links: task.links.filter((entry) => !(entry.plan === link.plan && entry.node === link.node)),
    });
  }
  return next;
}

/**
 * The cards a task links that none of its things names: an older task's cards, made before every card was a thing
 * of its own. Each once, in its order; `ownPlan` spells a link that names no plan (the older same-plan spelling).
 */
export function looseLinks(project: FactoryProject, taskId: string, ownPlan = ""): PlanTaskLink[] {
  const task = taskById(project, taskId);
  if (!task) {
    return [];
  }
  const spell = (link: { plan: string; node: string }) => ({
    plan: link.plan || ownPlan,
    node: link.node,
  });
  const named = new Set<string>();
  for (const item of itemsOfTask(project, taskId)) {
    if (item.link) {
      named.add(linkKeyOf(spell(item.link)));
    } else if (item.nodeId) {
      named.add(linkKeyOf({ plan: ownPlan, node: item.nodeId }));
    }
  }
  const out: PlanTaskLink[] = [];
  const candidates = [
    ...(task.links ?? []),
    ...(task.nodeIds ?? []).map((node) => ({ plan: "", node })),
  ];
  for (const link of candidates) {
    const spelled = spell(link);
    const key = linkKeyOf(spelled);
    if (!named.has(key)) {
      named.add(key);
      out.push(spelled);
    }
  }
  return out;
}

/** A task's things done and all of them; an older task's loose cards count as things not done. */
export function taskProgress(
  project: FactoryProject,
  taskId: string,
): { done: number; all: number } {
  let done = 0;
  let all = looseLinks(project, taskId).length;
  for (const item of itemsOf(project)) {
    if (item.taskId === taskId) {
      all += 1;
      if (item.done) {
        done += 1;
      }
    }
  }
  return { done, all };
}

/** A task's first screenshot, in its order. */
export function firstPicture(project: FactoryProject, taskId: string): PlanPicture | undefined {
  return itemsOfTask(project, taskId).find((item) => shownKind(item) === "picture")?.picture;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** A comment by `author`. On a live plan the live service writes who and when itself; these are what a plan on this device alone keeps. */
export function addTaskComment(
  project: FactoryProject,
  taskId: string,
  text: string,
  author: TaskAuthor,
  now = new Date().toISOString(),
): FactoryProject {
  const clipped = text.trim().slice(0, PLAN_TASK_LIMITS.commentTextLength);
  if (!clipped || !taskById(project, taskId)) {
    return project;
  }
  const comment: PlanTaskComment = {
    id: randomUUID(),
    taskId,
    by: author.id,
    byName: author.username.slice(0, PLAN_TASK_LIMITS.accountNameLength),
    at: now,
    text: clipped,
  };
  return { ...project, taskComments: [...commentsOf(project), comment] };
}

export function deleteTaskComment(project: FactoryProject, id: string): FactoryProject {
  return commentsOf(project).some((comment) => comment.id === id)
    ? { ...project, taskComments: commentsOf(project).filter((comment) => comment.id !== id) }
    : project;
}

/** What a task card shows: its things done of all of them, and how many comments. */
export function taskCardCounts(
  project: FactoryProject,
  taskId: string,
): { items: number; done: number; comments: number } {
  const progress = taskProgress(project, taskId);
  let comments = 0;
  for (const comment of commentsOf(project)) {
    if (comment.taskId === taskId) {
      comments += 1;
    }
  }
  return { items: progress.all, done: progress.done, comments };
}

// ---------------------------------------------------------------------------
// Time in a column
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since a time the plan wrote; 0 when it does not read. */
export function daysSince(iso: string | undefined, now = Date.now()): number {
  if (!iso) {
    return 0;
  }
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY_MS)) : 0;
}

/** How many whole days a task has sat in its column: from its move stamp, else when it was made. */
export function inColumnDays(task: PlanTask, now = Date.now()): number {
  return daysSince(task.movedAt ?? task.createdAt, now);
}

/** The dots a card shows for its days in a column: one a day to four, none in Done. */
export function timeDotCount(task: PlanTask, now = Date.now()): number {
  return task.status === "done" ? 0 : Math.min(4, inColumnDays(task, now));
}

/** The dots' colour: grey, amber from a week, red from two. */
export function timeDotColor(days: number): string {
  return days >= 14 ? "#e5484d" : days >= 7 ? "#f5b83d" : "#6b6f7a";
}

/** "5 days", "1 day" or "under a day". */
export function daySpan(days: number): string {
  return days < 1 ? "under a day" : `${days} ${days === 1 ? "day" : "days"}`;
}

/** "In Doing for 5 days": a card's tip. */
export function inColumnText(task: PlanTask, now = Date.now()): string {
  return `In ${TASK_STATUS_LABEL[task.status]} for ${daySpan(inColumnDays(task, now))}`;
}

/** "In Doing 5 days": the task box's line. */
export function inColumnShort(task: PlanTask, now = Date.now()): string {
  return `In ${TASK_STATUS_LABEL[task.status]} ${daySpan(inColumnDays(task, now))}`;
}

/** "just now", "5m ago", "3h ago", "12d ago", "2mo ago"; "" when it does not read. */
export function agoText(iso: string | undefined, now = Date.now()): string {
  if (!iso) {
    return "";
  }
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) {
    return "";
  }
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 60) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return `${Math.floor(minutes / (60 * 24 * 30))}mo ago`;
}

// ---------------------------------------------------------------------------
// Cards as tasks name them
// ---------------------------------------------------------------------------

/** A board card's name for a task's thing: its machine, resource or words. */
export function boardCardLabel(project: FactoryProject, id: string): string | undefined {
  const node = project.nodes.find((entry) => entry.id === id);
  if (node) {
    const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
    return recipe?.name || recipe?.machineType || "Machine";
  }
  const storage = project.storages?.find((entry) => entry.id === id);
  if (storage) {
    return storage.displayName ? `Drawer: ${storage.displayName}` : "Drawer";
  }
  const annotation = project.annotations?.find((entry) => entry.id === id);
  if (annotation) {
    const text = annotation.text?.trim();
    return text ? `Note: ${text.slice(0, 40)}` : "Note";
  }
  const pocket = project.pockets?.find((entry) => entry.id === id);
  if (pocket) {
    return `Board: ${pocket.name}`;
  }
  return undefined;
}

/** A card as a machine thing says it: "4× Electric Blast Furnace (HV)" (no count before the solve has one). */
export function cardLine(card: { name: string; tier?: string; count: number }): string {
  const count = card.count > 0 ? `${card.count}× ` : "";
  return `${count}${card.name}${card.tier ? ` (${card.tier})` : ""}`.slice(
    0,
    PLAN_TASK_LIMITS.itemTextLength,
  );
}

/** "Build A", "Build A and B", "Build A and 3 more": a title from the machines of some cards. */
export function titleForCards(names: readonly string[]): string {
  const unique = [...new Set(names)];
  const title =
    unique.length === 0
      ? "Build"
      : unique.length === 1
        ? `Build ${unique[0]}`
        : unique.length === 2
          ? `Build ${unique[0]} and ${unique[1]}`
          : `Build ${unique[0]} and ${unique.length - 1} more`;
  return clipTitle(title);
}
