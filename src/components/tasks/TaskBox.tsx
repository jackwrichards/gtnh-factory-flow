"use client";

import "./tasks.css";
import "./task-box.css";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChromeMenu,
  chromeAnchorOf,
  type ChromeAnchor,
  type MenuEntry,
} from "@/components/chrome/ChromeMenu";
import { PixelIcon } from "@/components/chrome/pixel-icons";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { machineArtPixels } from "@/components/flow/MachinePicker";
import { useMachineHandlerIcons } from "@/components/flow/machine-icons";
import { tipAttrs } from "@/components/flow/clean/interaction";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import { useCommunityUser } from "@/components/community/auth";
import type { PlanPicture, PlanTask, PlanTaskItem, PlanTaskLink } from "@/lib/model/types";
import { PLAN_TASK_LIMITS } from "@/lib/model/schemas";
import {
  addBlocker,
  addTaskComment,
  agoText,
  blockersOf,
  commentsOfTask,
  deleteTask,
  deleteTaskComment,
  inColumnShort,
  itemsOfTask,
  looseLinks,
  moveTaskItemTo,
  moveTaskTo,
  removeBlocker,
  removeThing,
  shownKind,
  shownPriority,
  boardOrder,
  TASK_PRIORITIES,
  TASK_PRIORITY_COLOR,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  addThing,
  unblockedBy,
  updateTask,
  updateTaskItem,
  wouldLoop,
} from "@/lib/tasks/task-board";
import { openTaskLink, useLinkStates, type LinkState } from "@/lib/tasks/open-link";
import { itemLink, linkKey, planLinkId, TASK_STATUS_COLOR } from "@/lib/tasks/task-links";
import { selectTask } from "@/lib/tasks/task-board-ui";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { myAccountId, useLiveSession } from "@/store/live-session";
import { PriorityIcon, StatusDot, TaskFace, useNameOf } from "./task-look";
import { useTaskAuthor, useTaskPeople } from "./task-people";
import { TaskPlanLabel } from "./TaskPlanLabel";

/**
 * A task, open in a box over its board, laid out as an issue is in Jira (the game's TaskPanel): a wide main column
 * (the title, big and written in place; its notes; its things, each with its own checkbox: machines, places in a
 * world and screenshots; then the comments) and a side column on a panel of its own (Status and Priority as pickers,
 * People; Waiting on and Unblocks; Board, Made and Time). The comment box sits along the foot, Delete task beside it
 * under the side column. Below 400 GUI pixels the side column goes under the title. Every change is one undoable
 * edit of the plan, made as it happens. The website adds no locations or screenshots: only the game takes them.
 */

const MAX_W = 600;
const MAX_H = 460;
const TWO_COLUMNS = 400;
const PAD = 12;
const GUTTER = 14;
const SIDE_W = 150;
const ROW_DRAG_SLOP = 6;

/** The words "That task already waits on this one." stay this long. */
const REFUSED_MS = 4000;

/** A thing as the box shows it: the item it is (a loose card's is made up, never in the plan), and its kind. */
interface Shown {
  item: PlanTaskItem;
  kind: "machine" | "location" | "picture" | "";
  /** A card an older task links with no thing of its own. */
  loose: boolean;
  link?: PlanTaskLink;
}

function useBoxSize(): { w: number; h: number; rect?: DOMRect } {
  const [size, setSize] = useState<{ w: number; h: number; rect?: DOMRect }>({
    w: MAX_W,
    h: MAX_H,
  });
  useLayoutEffect(() => {
    const measure = () => {
      const board = document.querySelector<HTMLElement>("[data-task-board]");
      if (!board || board.offsetWidth === 0) return;
      const rect = board.getBoundingClientRect();
      const k = rect.width / board.offsetWidth;
      const roomW = rect.width / k;
      const roomH = rect.height / k;
      setSize({
        w: Math.floor(Math.min(MAX_W, roomW - 8)),
        h: Math.floor(Math.min(MAX_H, roomH - 8)),
        rect,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    const board = document.querySelector<HTMLElement>("[data-task-board]");
    if (board) observer?.observe(board);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);
  return size;
}

export function TaskBox({ task, onClose }: { task: PlanTask; onClose: () => void }) {
  const editTasks = useFactoryStore((state) => state.editTasks);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const project = useFactoryStore((state) => state.project);
  const boardName = useDesignStore((state) => {
    const design = state.designs.find((entry) => entry.id === state.activeDesignId);
    return design?.name?.trim() ? design.name : "Task board";
  });
  const ownPlan = useDesignStore((state) => {
    const design = state.designs.find((entry) => entry.id === state.activeDesignId);
    return design ? planLinkId(design, myAccountId()) : "";
  });
  const author = useTaskAuthor();
  const nameOf = useNameOf();
  const { w: boxW, h: boxH, rect } = useBoxSize();
  const wide = boxW >= TWO_COLUMNS;
  const sideW = wide ? Math.max(SIDE_W, Math.min(184, Math.round(boxW * 0.31))) : boxW - 2 * PAD;
  const mainW = wide ? boxW - PAD - sideW - GUTTER - PAD : boxW - 2 * PAD;
  const [comment, setComment] = useState("");
  const [refused, setRefused] = useState<string>();
  const [menu, setMenu] = useState<{
    entries: MenuEntry[];
    anchor: ChromeAnchor;
    title?: string;
    label: string;
  }>();
  const [bigPicture, setBigPicture] = useState<PlanPicture>();
  const [gone, setGone] = useState<string>();
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!refused) return;
    const timer = window.setTimeout(() => setRefused(undefined), REFUSED_MS);
    return () => window.clearTimeout(timer);
  }, [refused]);

  // Escape closes the box (a menu or a picture open over it closes first).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || menu || bigPicture) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest("[data-task-panel]") &&
        active.matches("textarea, input")
      ) {
        active.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, bigPicture, onClose]);

  const things = useMemo<Shown[]>(() => {
    const out: Shown[] = itemsOfTask(project, task.id).map((item) => {
      const kind = shownKind(item);
      return {
        item,
        kind,
        loose: false,
        link: kind === "machine" ? itemLink(item, ownPlan) : undefined,
      };
    });
    looseLinks(project, task.id, ownPlan).forEach((link, at) =>
      out.push({
        item: {
          id: `link:${at}:${link.plan}:${link.node}`,
          taskId: task.id,
          kind: "machine",
          text: "",
          done: false,
          order: "",
        },
        kind: "machine",
        loose: true,
        link,
      }),
    );
    return out;
  }, [project, task.id, ownPlan]);
  const links = useMemo(
    () => things.flatMap((thing) => (thing.link ? [thing.link] : [])),
    [things],
  );
  const states = useLinkStates(links);
  const comments = useMemo(() => commentsOfTask(project, task.id), [project, task.id]);
  const done = things.filter((thing) => thing.item.done).length;

  const show = async (link: PlanTaskLink) => {
    setGone(undefined);
    const result = await openTaskLink(link);
    if (result === "plan-gone") setGone("That plan is gone");
    else if (result === "card-gone") setGone("That card is gone");
  };

  const toggle = (thing: Shown) => {
    if (isReadOnly) return;
    if (thing.loose && thing.link) {
      // A card an older task linked becomes a thing of its own to be ticked.
      const words = linkWords(states[linkKey(thing.link)]);
      editTasks((plan) =>
        addThing(plan, task.id, { kind: "machine", text: words, link: thing.link, done: true }),
      );
      return;
    }
    editTasks((plan) => updateTaskItem(plan, thing.item.id, { done: !thing.item.done }));
  };

  const takeOff = (thing: Shown) => {
    if (isReadOnly) return;
    if (thing.loose && thing.link) {
      const off = thing.link;
      editTasks((plan) =>
        updateTask(plan, task.id, {
          links: (task.links ?? []).filter(
            (link) => !((link.plan || ownPlan) === off.plan && link.node === off.node),
          ),
          nodeIds: (task.nodeIds ?? []).filter(
            (node) => !(ownPlan === off.plan && node === off.node),
          ),
        }),
      );
      return;
    }
    editTasks((plan) => removeThing(plan, thing.item.id));
  };

  const copyPlace = (thing: Shown) => {
    const place = thing.item.place;
    if (!place) return;
    void navigator.clipboard?.writeText(`${place.x} ${place.y} ${place.z}`).catch(() => {});
  };

  /** What a click on a thing does: a card shows on its plan, a spot's block is copied, a screenshot shows big. */
  const act = (thing: Shown) => {
    if (thing.kind === "machine" && thing.link) void show(thing.link);
    else if (thing.kind === "location") copyPlace(thing);
    else if (thing.kind === "picture" && thing.item.picture) setBigPicture(thing.item.picture);
  };

  const thingMenu = (thing: Shown, anchor: ChromeAnchor, rewrite: () => void) => {
    const entries: MenuEntry[] = [];
    if (thing.kind === "machine" && thing.link)
      entries.push({ label: "Show on its plan", onSelect: () => act(thing) });
    else if (thing.kind === "location")
      entries.push({ label: "Copy where it is", onSelect: () => copyPlace(thing) });
    else if (thing.kind === "picture")
      entries.push({ label: "See it big", onSelect: () => act(thing) });
    else entries.push({ label: "Change the words", disabled: isReadOnly, onSelect: rewrite });
    entries.push({
      label: thing.item.done ? "Mark not done" : "Mark done",
      disabled: isReadOnly,
      onSelect: () => toggle(thing),
    });
    entries.push({
      label: "Take it off the task",
      tone: "red",
      disabled: isReadOnly,
      onSelect: () => takeOff(thing),
    });
    setMenu({ entries, anchor, label: "Thing" });
  };

  const post = () => {
    const text = comment.trim();
    if (!text || isReadOnly) return;
    editTasks((plan) => addTaskComment(plan, task.id, text, author));
    setComment("");
    // The newest comment is at the foot of the page: show it.
    window.requestAnimationFrame(() => {
      const page = pageRef.current;
      if (page) page.scrollTop = page.scrollHeight;
    });
  };

  const side = (
    <SidePanel
      task={task}
      wide={wide}
      boardName={boardName}
      nameOf={nameOf}
      refused={refused}
      onRefuse={setRefused}
      onMenu={setMenu}
      onOpen={(id) => selectTask(id)}
      onDelete={(anchor) => askDelete(anchor)}
    />
  );

  function askDelete(anchor: ChromeAnchor) {
    setMenu({
      title: "Delete this task for good?",
      label: "Delete task",
      anchor,
      entries: [
        {
          label: "Delete it",
          tone: "red",
          onSelect: () => {
            onClose();
            editTasks((plan) => deleteTask(plan, task.id));
          },
        },
        { label: "Keep it", onSelect: () => {} },
      ],
    });
  }

  const box = (
    <div className="tbx-layer" data-task-layer="">
      <div className="tbx-dim" onMouseDown={onClose} />
      <div
        className="tbx-room"
        style={
          rect
            ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            : undefined
        }
      >
        <div
          className="tbx"
          role="dialog"
          aria-label={`Task: ${task.title}`}
          data-task-panel={task.id}
          data-wide={wide ? "" : undefined}
          style={{
            width: boxW,
            height: boxH,
            ["--main-w" as string]: `${mainW}px`,
            ["--side-w" as string]: `${sideW}px`,
          }}
        >
          <div className="tbx-bar">
            <StatusDot status={task.status} />
            <span className="tbx-where">
              {boardName}
              <i>/</i>
              {TASK_STATUS_LABEL[task.status]}
            </span>
            <button
              type="button"
              className="tbx-close"
              aria-label="Close the task"
              {...tipAttrs({ id: "task-box|close", title: "Close (Esc)" })}
              onClick={onClose}
            >
              <svg
                width="7"
                height="7"
                viewBox="0 0 7 7"
                shapeRendering="crispEdges"
                aria-hidden
                fill="currentColor"
              >
                <path d="M0 0h1v1h1v1h1v1h1v-1h1v-1h1v-1h1v1h-1v1h-1v1h-1v1h1v1h1v1h1v1h-1v-1h-1v-1h-1v-1h-1v1h-1v1h-1v1h-1v-1h1v-1h1v-1h1v-1h-1v-1h-1v-1h-1z" />
              </svg>
            </button>
          </div>
          <div className="tbx-page" ref={pageRef}>
            <div className="tbx-main">
              <TitleField task={task} readOnly={isReadOnly} />
              <TaskPlanLabel task={task} />
              {wide ? null : <div className="tbx-side-under">{side}</div>}
              <div className="tbx-label">Notes</div>
              <NotesField task={task} readOnly={isReadOnly} />
              <div className="tbx-label tbx-things-head" data-task-things-head="">
                Things
                {things.length > 0 ? (
                  <>
                    <i>
                      {done}/{things.length}
                    </i>
                    <span className="tbx-progress" aria-hidden>
                      <span style={{ width: `${(100 * done) / things.length}%` }} />
                    </span>
                  </>
                ) : null}
              </div>
              <ThingList
                things={things}
                states={states}
                readOnly={isReadOnly}
                onToggle={toggle}
                onTakeOff={takeOff}
                onAct={act}
                onCopy={copyPlace}
                onMenu={thingMenu}
                onRewrite={(thing, text) =>
                  editTasks((plan) => updateTaskItem(plan, thing.item.id, { text }))
                }
                onMove={(thing, index) =>
                  editTasks((plan) => moveTaskItemTo(plan, thing.item.id, index))
                }
              />
              {things.length === 0 ? (
                <p className="tbx-faint tbx-nothing">Nothing on it yet.</p>
              ) : null}
              {gone ? (
                <p className="tbx-gone" role="status" data-task-link-gone="">
                  {gone}
                </p>
              ) : null}
              <p className="tbx-faint tbx-hint">Add machines from a card&apos;s menu.</p>
              <div className="tbx-label tbx-comments-head" data-task-comments="">
                Comments{comments.length > 0 ? <i>{comments.length}</i> : null}
              </div>
              {comments.length === 0 ? (
                <p className="tbx-faint tbx-nothing">No comments yet.</p>
              ) : null}
              {comments.map((entry) => (
                <div key={entry.id} className="tbx-comment" data-task-comment="">
                  <TaskFace id={entry.by} name={entry.byName || nameOf(entry.by)} />
                  <div className="tbx-comment-body">
                    <div className="tbx-comment-head">
                      <span>{entry.byName || "Someone"}</span>
                      <i>{agoText(entry.at)}</i>
                      {(entry.by === author.id || entry.by === "local") && !isReadOnly ? (
                        <button
                          type="button"
                          className="tbx-comment-delete"
                          {...tipAttrs({
                            id: `task-box|comment|${entry.id}`,
                            title: "Delete your comment",
                          })}
                          onClick={() => editTasks((plan) => deleteTaskComment(plan, entry.id))}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                    <p>{entry.text}</p>
                  </div>
                </div>
              ))}
            </div>
            {wide ? <div className="tbx-side-col">{side}</div> : null}
          </div>
          <div className="tbx-foot">
            {isReadOnly ? null : (
              <>
                <CommentField value={comment} onChange={setComment} onPost={post} mainW={mainW} />
                <button
                  type="button"
                  className="tb-key tbx-post"
                  data-any={comment.trim() ? "" : undefined}
                  {...tipAttrs({ id: "task-box|post", title: "Add your comment" })}
                  onClick={post}
                >
                  Comment
                </button>
                {wide ? (
                  <button
                    type="button"
                    className="tb-key tbx-delete"
                    data-tone="red"
                    {...tipAttrs({
                      id: "task-box|delete",
                      title: "Delete this task with its things and comments",
                    })}
                    onClick={(event) => askDelete(chromeAnchorOf(event.currentTarget))}
                  >
                    Delete task
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      {menu ? (
        <ChromeMenu
          anchor={menu.anchor}
          entries={menu.entries}
          label={menu.label}
          title={menu.title}
          minWidth={140}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
      {bigPicture ? (
        <PictureView picture={bigPicture} rect={rect} onClose={() => setBigPicture(undefined)} />
      ) : null}
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(box, document.body);
}

/** A machine thing's words when its card is here: its card's machine. */
function linkWords(state: LinkState | undefined): string {
  return state?.label ?? "A machine";
}

// ---------------------------------------------------------------------------
// The title, the notes and the comment box
// ---------------------------------------------------------------------------

function useGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  min: number,
  max: number,
) {
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.max(min, Math.min(max, area.scrollHeight))}px`;
  }, [ref, value, min, max]);
}

function TitleField({ task, readOnly }: { task: PlanTask; readOnly: boolean }) {
  const editTasks = useFactoryStore((state) => state.editTasks);
  const [draft, setDraft] = useState<string>();
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = draft ?? task.title;
  useGrow(ref, value, 18, 200);
  return (
    <textarea
      ref={ref}
      className="tbx-title"
      value={value}
      rows={1}
      maxLength={PLAN_TASK_LIMITS.titleLength}
      readOnly={readOnly}
      placeholder="Name this task"
      aria-label="Task title"
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft?.trim();
        setDraft(undefined);
        // A title cannot be empty: the one it had comes back.
        if (next && next !== task.title)
          editTasks((plan) => updateTask(plan, task.id, { title: next }));
      }}
    />
  );
}

function NotesField({ task, readOnly }: { task: PlanTask; readOnly: boolean }) {
  const editTasks = useFactoryStore((state) => state.editTasks);
  const [draft, setDraft] = useState<string>();
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = draft ?? task.text ?? "";
  useGrow(ref, value, 30, 120);
  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    if (text !== (task.text ?? "")) editTasks((plan) => updateTask(plan, task.id, { text }));
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <textarea
      ref={ref}
      className="tbx-well tbx-notes"
      value={value}
      maxLength={PLAN_TASK_LIMITS.textLength}
      readOnly={readOnly}
      placeholder="Add notes"
      aria-label="Task notes"
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(text), 800);
      }}
      onBlur={(event) => {
        commit(event.target.value);
        setDraft(undefined);
      }}
    />
  );
}

function CommentField({
  value,
  onChange,
  onPost,
  mainW,
}: {
  value: string;
  onChange: (value: string) => void;
  onPost: () => void;
  mainW: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useGrow(ref, value, 22, 52);
  return (
    <textarea
      ref={ref}
      className="tbx-well tbx-write"
      style={{ width: mainW - 62 - 6 }}
      value={value}
      maxLength={PLAN_TASK_LIMITS.commentTextLength}
      placeholder="Write a comment"
      aria-label="New comment"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onPost();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Things
// ---------------------------------------------------------------------------

function ThingList({
  things,
  states,
  readOnly,
  onToggle,
  onTakeOff,
  onAct,
  onCopy,
  onMenu,
  onRewrite,
  onMove,
}: {
  things: Shown[];
  states: Record<string, LinkState>;
  readOnly: boolean;
  onToggle: (thing: Shown) => void;
  onTakeOff: (thing: Shown) => void;
  onAct: (thing: Shown) => void;
  onCopy: (thing: Shown) => void;
  onMenu: (thing: Shown, anchor: ChromeAnchor, rewrite: () => void) => void;
  onRewrite: (thing: Shown, text: string) => void;
  onMove: (thing: Shown, index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [carrying, setCarrying] = useState<{ id: string; drop: number }>();
  const [writing, setWriting] = useState<string>();
  const suppressClick = useRef(false);

  const press = (event: React.PointerEvent<HTMLElement>, thing: Shown) => {
    if (event.button !== 0 || readOnly || thing.loose) return;
    if ((event.target as HTMLElement).closest("button, input, textarea")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const k =
      listRef.current && listRef.current.offsetWidth > 0
        ? listRef.current.getBoundingClientRect().width / listRef.current.offsetWidth
        : 2;
    let active = false;
    let drop = -1;
    const move = (moved: PointerEvent) => {
      if (!active && Math.hypot(moved.clientX - startX, moved.clientY - startY) < ROW_DRAG_SLOP * k)
        return;
      active = true;
      let index = 0;
      for (const row of listRef.current?.querySelectorAll<HTMLElement>("[data-task-thing]") ?? []) {
        if (row.dataset.taskThing === thing.item.id || row.dataset.loose !== undefined) continue;
        const box = row.getBoundingClientRect();
        if (moved.clientY < box.top + box.height / 2) break;
        index += 1;
      }
      drop = index;
      setCarrying({ id: thing.item.id, drop: index });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (active) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        setCarrying(undefined);
        if (drop >= 0) onMove(thing, drop);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  let place = 0;
  return (
    <div className="tbx-things" ref={listRef} data-task-checklist="">
      {things.map((thing) => {
        const carried = carrying?.id === thing.item.id;
        const dropHere = carrying && !carried && carrying.drop === place;
        if (!carried && !thing.loose) place += 1;
        return (
          <Fragment key={thing.item.id}>
            {dropHere ? <div className="tbx-drop" /> : null}
            <ThingRow
              thing={thing}
              state={thing.link ? states[linkKey(thing.link)] : undefined}
              readOnly={readOnly}
              carried={carried}
              writing={writing === thing.item.id}
              onPress={(event) => press(event, thing)}
              onToggle={() => onToggle(thing)}
              onTakeOff={() => onTakeOff(thing)}
              onAct={() => {
                if (suppressClick.current) return;
                if (thing.kind === "" && !readOnly) setWriting(thing.item.id);
                else onAct(thing);
              }}
              onCopy={() => onCopy(thing)}
              onMenu={(anchor) => onMenu(thing, anchor, () => setWriting(thing.item.id))}
              onRewrite={(text) => {
                setWriting(undefined);
                if (text && text !== thing.item.text) onRewrite(thing, text);
              }}
            />
          </Fragment>
        );
      })}
      {carrying && carrying.drop >= place ? <div className="tbx-drop" /> : null}
    </div>
  );
}

/** "120 64 -30", or the label with the block under it, and the dimension: a spot's words and its line. */
function placeLines(item: PlanTaskItem): { words: string; parts: string[] } {
  const place = item.place!;
  const at = `${place.x} ${place.y} ${place.z}`;
  const parts: string[] = [];
  if (place.label) parts.push(at);
  parts.push(place.dimName || `Dimension ${place.dim}`);
  return { words: place.label || at, parts };
}

function machineLines(
  thing: Shown,
  state: LinkState | undefined,
): { words: string; parts: string[]; gone: boolean } {
  const words = thing.item.text || state?.label || "A machine";
  if (!state) return { words, parts: [], gone: false };
  if (state.state === "plan") return { words, parts: ["Its plan is gone"], gone: true };
  if (state.state === "card")
    return { words, parts: [`Its card is gone from ${state.planName ?? "its plan"}`], gone: true };
  if (state.state === "away") return { words, parts: ["On a plan shared with you"], gone: false };
  return { words, parts: [`On ${state.planName ?? "its plan"}`], gone: false };
}

function ThingRow({
  thing,
  state,
  readOnly,
  carried,
  writing,
  onPress,
  onToggle,
  onTakeOff,
  onAct,
  onCopy,
  onMenu,
  onRewrite,
}: {
  thing: Shown;
  state: LinkState | undefined;
  readOnly: boolean;
  carried: boolean;
  writing: boolean;
  onPress: (event: React.PointerEvent<HTMLElement>) => void;
  onToggle: () => void;
  onTakeOff: () => void;
  onAct: () => void;
  onCopy: () => void;
  onMenu: (anchor: ChromeAnchor) => void;
  onRewrite: (text: string) => void;
}) {
  const { item, kind } = thing;
  let words = item.text;
  let parts: string[] = [];
  let gone = false;
  let picture: ReactNode = null;
  if (kind === "machine") {
    const lines = machineLines(thing, state);
    words = lines.words;
    parts = lines.parts;
    gone = lines.gone;
    picture = <MachinePicture state={state} />;
  } else if (kind === "location") {
    const lines = placeLines(item);
    words = lines.words;
    parts = lines.parts;
    picture = (
      <span className="tbx-tile" aria-hidden>
        <PixelIcon name="pin" style={{ color: "#22d3ee" }} />
      </span>
    );
  } else if (kind === "picture") {
    words = "Screenshot";
    const ago = agoText(item.picture?.takenAt);
    parts = ago ? [`Taken ${ago}`] : [];
    picture = <img className="tbx-thumb" src={item.picture!.thumb} alt="" draggable={false} />;
  }
  const tip =
    kind === "machine"
      ? { action: "Show it on its plan", title: words }
      : kind === "location"
        ? { action: "Copy where it is", title: words }
        : kind === "picture"
          ? { action: "See it big", title: "Screenshot" }
          : { action: "Change the words", title: words };
  const anchorOf = (event: React.MouseEvent) => ({
    left: event.clientX,
    top: event.clientY,
    bottom: event.clientY,
  });
  return (
    <div
      className="tbx-thing"
      data-task-thing={item.id}
      data-task-item={words}
      data-kind={kind || "words"}
      data-loose={thing.loose ? "" : undefined}
      data-done={item.done ? "" : undefined}
      data-gone={gone ? "" : undefined}
      data-carried={carried ? "" : undefined}
      onPointerDown={onPress}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, input, textarea")) return;
        onAct();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(anchorOf(event));
      }}
      {...tipAttrs({
        id: `task-thing|${item.id}`,
        title: tip.title,
        actions: [
          ...(gone ? [] : [{ input: "left" as const, label: tip.action }]),
          ...(thing.loose ? [] : [{ input: "drag" as const, label: "Move it" }]),
          { input: "right" as const, label: "More" },
        ],
      })}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={`Done: ${words}`}
        className="tbx-box"
        disabled={readOnly}
        {...tipAttrs({
          id: `task-thing|box|${item.id}`,
          title: item.done ? "Not done after all" : "Tick it off",
        })}
        onClick={onToggle}
      >
        {item.done ? (
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            shapeRendering="crispEdges"
            aria-hidden
            fill="currentColor"
          >
            <path d="M1 4h1v2h-1zM2 5h1v2h-1zM3 4h1v2h-1zM4 3h1v2h-1zM5 2h1v2h-1zM6 1h1v2h-1z" />
          </svg>
        ) : null}
      </button>
      {picture}
      <div className="tbx-thing-text">
        {writing ? (
          <input
            className="tbx-well tbx-rewrite"
            autoFocus
            defaultValue={item.text}
            maxLength={PLAN_TASK_LIMITS.itemTextLength}
            aria-label="Change the words"
            onBlur={(event) => onRewrite(event.currentTarget.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = item.text;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className="tbx-words">{words}</span>
        )}
        {parts.length > 0 ? (
          <span className="tbx-parts">
            {parts.map((part, at) => (
              <span key={at}>{part}</span>
            ))}
          </span>
        ) : null}
      </div>
      {kind === "machine" && thing.link && !gone ? (
        <button
          type="button"
          className="tb-key tbx-show"
          aria-label="Show it on its plan"
          {...tipAttrs({ id: `task-thing|show|${item.id}`, title: "Show it on its plan" })}
          onClick={onAct}
        >
          <PixelIcon name="card" style={{ color: "#22d3ee" }} />
        </button>
      ) : null}
      {kind === "location" ? (
        <button
          type="button"
          className="tb-key tbx-show"
          aria-label="Copy where it is"
          {...tipAttrs({
            id: `task-thing|copy|${item.id}`,
            title: "Copy where it is",
            sub: "Its x y z, to paste in the game",
          })}
          onClick={onCopy}
        >
          Copy
        </button>
      ) : null}
      {readOnly ? null : (
        <button
          type="button"
          className="tbx-off"
          aria-label={`Take it off the task: ${words}`}
          {...tipAttrs({ id: `task-thing|off|${item.id}`, title: "Take it off the task" })}
          onClick={onTakeOff}
        >
          <Cross />
        </button>
      )}
    </div>
  );
}

function Cross() {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 7 7"
      shapeRendering="crispEdges"
      aria-hidden
      fill="currentColor"
    >
      <path d="M0 0h1v1h1v1h1v1h1v-1h1v-1h1v-1h1v1h-1v1h-1v1h-1v1h1v1h1v1h1v1h-1v-1h-1v-1h-1v-1h-1v1h-1v1h-1v1h-1v-1h1v-1h1v-1h1v-1h-1v-1h-1v-1h-1z" />
    </svg>
  );
}

/** A machine's picture, 16 pixels: its machine's icon, or a tile with a card on it. */
function MachinePicture({ state }: { state: LinkState | undefined }) {
  const icons = useMachineHandlerIcons();
  const icon = state?.powerSourceId
    ? getPowerMachineIcon(state.powerSourceId)
    : state?.handlerId
      ? icons.get(state.handlerId)
      : undefined;
  if (!icon) {
    return (
      <span className="tbx-tile" aria-hidden>
        <PixelIcon
          name="card"
          style={{ color: state && state.state !== "ok" ? "#6a6c74" : "#9a9ca4" }}
        />
      </span>
    );
  }
  return (
    <span className="tbx-icon" aria-hidden>
      <ResourceIcon
        resource={{ ...(icon as object), amount: 1, consumed: true } as never}
        size="sm"
        showAmount={false}
        bare
        tooltip={false}
        iconPixelSize={machineArtPixels(20)}
        className="tbx-icon-art"
      />
    </span>
  );
}

/** A screenshot big, over the box: the thumbnail as large as fits, its caption, a click closes it. */
function PictureView({
  picture,
  rect,
  onClose,
}: {
  picture: PlanPicture;
  rect: DOMRect | undefined;
  onClose: () => void;
}) {
  const ago = agoText(picture.takenAt);
  const said = `${ago ? `Taken ${ago}` : "Screenshot"}. The full shot is on the computer that took it`;
  return (
    <div className="tbp-layer" data-task-picture="" onMouseDown={onClose}>
      <div
        className="tbx-room"
        style={
          rect
            ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            : undefined
        }
      >
        <div className="tbp">
          <img src={picture.thumb} alt="Screenshot" draggable={false} />
          <div className="tbp-caption">
            <span>{said}</span>
            <i>Click to close</i>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The side column
// ---------------------------------------------------------------------------

function SidePanel({
  task,
  wide,
  boardName,
  nameOf,
  refused,
  onRefuse,
  onMenu,
  onOpen,
  onDelete,
}: {
  task: PlanTask;
  wide: boolean;
  boardName: string;
  nameOf: (id: string) => string | undefined;
  refused: string | undefined;
  onRefuse: (why: string) => void;
  onMenu: (menu: {
    entries: MenuEntry[];
    anchor: ChromeAnchor;
    title?: string;
    label: string;
  }) => void;
  onOpen: (id: string) => void;
  onDelete: (anchor: ChromeAnchor) => void;
}) {
  const editTasks = useFactoryStore((state) => state.editTasks);
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const project = useFactoryStore((state) => state.project);
  const people = useTaskPeople();
  const liveStatus = useLiveSession((state) => state.status);
  const { user } = useCommunityUser();
  const me = useTaskAuthor();
  const priority = shownPriority(task);
  const waits = blockersOf(project, task.id);
  const unblocks = unblockedBy(project, task.id);
  const assignees = task.assignees ?? [];

  const pickStatus = (event: React.MouseEvent<HTMLElement>) =>
    onMenu({
      label: "Status",
      anchor: chromeAnchorOf(event.currentTarget),
      entries: TASK_STATUSES.map((status) => ({
        label: TASK_STATUS_LABEL[status],
        dot: TASK_STATUS_COLOR[status],
        current: status === task.status,
        onSelect: () => editTasks((plan) => moveTaskTo(plan, task.id, status)),
      })),
    });
  const pickPriority = (event: React.MouseEvent<HTMLElement>) =>
    onMenu({
      label: "Priority",
      anchor: chromeAnchorOf(event.currentTarget),
      entries: TASK_PRIORITIES.map((each) => ({
        label: TASK_PRIORITY_LABEL[each],
        icon: <PriorityIcon priority={each} className="mm-prio" />,
        current: each === priority,
        onSelect: () => editTasks((plan) => updateTask(plan, task.id, { priority: each })),
      })),
    });
  const shared = liveStatus !== "off" && people.length > 0;
  const assign = (event: React.MouseEvent<HTMLElement>) => {
    if (!shared) {
      const on = assignees.includes(me.id);
      editTasks((plan) =>
        updateTask(plan, task.id, {
          assignees: on ? assignees.filter((id) => id !== me.id) : [...assignees, me.id],
        }),
      );
      return;
    }
    onMenu({
      label: "Who is on it",
      title: "Who is on it",
      anchor: chromeAnchorOf(event.currentTarget),
      entries: people.map((person) => {
        const on = assignees.includes(person.id);
        return {
          label: person.id === me.id ? "You" : person.username,
          detail: on ? "On it" : "",
          current: on,
          onSelect: () =>
            editTasks((plan) =>
              updateTask(plan, task.id, {
                assignees: on
                  ? assignees.filter((id) => id !== person.id)
                  : [...assignees, person.id],
              }),
            ),
        };
      }),
    });
  };
  const pickBlocker = (event: React.MouseEvent<HTMLElement>) => {
    const others = boardOrder(project).filter(
      (other) => other.id !== task.id && !(task.blockedBy ?? []).includes(other.id),
    );
    if (others.length === 0) {
      onRefuse("There is no other task to wait on.");
      return;
    }
    onMenu({
      label: "Waiting on",
      title: "Waiting on",
      anchor: chromeAnchorOf(event.currentTarget),
      entries: others.map((other) => {
        const loops = wouldLoop(project, task.id, other.id);
        return {
          label: other.title,
          dot: TASK_STATUS_COLOR[other.status],
          detail: loops ? "waits on this" : "",
          onSelect: () => {
            if (loops) {
              onRefuse("That task already waits on this one.");
              return;
            }
            editTasks((plan) => addBlocker(plan, task.id, other.id));
          },
        };
      }),
    });
  };

  const statusPicker = (
    <button
      type="button"
      className="tbx-picker"
      data-task-status-picker=""
      disabled={isReadOnly}
      style={{ ["--pick" as string]: TASK_STATUS_COLOR[task.status] }}
      {...tipAttrs({ id: "task-box|status", title: "Move it to another column" })}
      onClick={pickStatus}
    >
      <StatusDot status={task.status} />
      <span>{TASK_STATUS_LABEL[task.status]}</span>
      <Caret />
    </button>
  );
  const priorityPicker = (
    <button
      type="button"
      className="tbx-picker"
      data-task-priority-picker=""
      disabled={isReadOnly}
      style={{ ["--pick" as string]: TASK_PRIORITY_COLOR[priority] }}
      {...tipAttrs({ id: "task-box|priority", title: "How pressing it is" })}
      onClick={pickPriority}
    >
      <PriorityIcon priority={priority} />
      <span>{TASK_PRIORITY_LABEL[priority]}</span>
      <Caret />
    </button>
  );
  const peopleField = (
    <div className="tbx-people">
      {wide ? (
        assignees.map((id) => (
          <div key={id} className="tbx-person">
            <TaskFace id={id} name={id === me.id ? me.username : nameOf(id)} />
            <span>{id === me.id || id === "local" ? "You" : (nameOf(id) ?? "Someone")}</span>
          </div>
        ))
      ) : assignees.length > 0 ? (
        <div className="tbx-face-row">
          {assignees.map((id) => (
            <TaskFace key={id} id={id} name={id === me.id ? me.username : nameOf(id)} />
          ))}
        </div>
      ) : null}
      {!user ? (
        <>
          {assignees.length === 0 ? <p className="tbx-faint">No one yet.</p> : null}
          <button
            type="button"
            className="tbx-sign-in"
            {...tipAttrs({ id: "task-box|sign-in", title: "Sign in to your account" })}
            onClick={() => document.querySelector<HTMLElement>('[data-mb="account"]')?.click()}
          >
            Sign in to assign
          </button>
        </>
      ) : isReadOnly ? null : (
        <button
          type="button"
          className="tb-key tbx-assign"
          {...tipAttrs({
            id: "task-box|assign",
            title: shared ? "Choose who is on it" : "Put yourself on it or take yourself off",
          })}
          onClick={assign}
        >
          {shared ? "Assign" : assignees.includes(me.id) ? "Unassign me" : "Assign me"}
        </button>
      )}
    </div>
  );
  const waitingOn = (
    <div className="tbx-links" data-task-waiting-on="">
      {waits.map((other) => (
        <TaskLinkRow
          key={other.id}
          task={other}
          tip="This task waits on it"
          onOpen={() => onOpen(other.id)}
          onRemove={
            isReadOnly
              ? undefined
              : () => editTasks((plan) => removeBlocker(plan, task.id, other.id))
          }
        />
      ))}
      {isReadOnly ? null : (
        <button
          type="button"
          className="tb-key tbx-add-blocker"
          {...tipAttrs({ id: "task-box|add-blocker", title: "Add a task it waits on" })}
          onClick={pickBlocker}
        >
          <PixelIcon name="plus" style={{ color: "#22d3ee" }} />
          Add
        </button>
      )}
      {refused ? (
        <p className="tbx-refused" role="status" data-task-refused="">
          {refused}
        </p>
      ) : null}
    </div>
  );
  const unblocksField = (
    <div className="tbx-links" data-task-unblocks="">
      {unblocks.length === 0 ? <p className="tbx-faint">Nothing waits on it.</p> : null}
      {unblocks.map((other) => (
        <TaskLinkRow
          key={other.id}
          task={other}
          tip="It waits on this task"
          onOpen={() => onOpen(other.id)}
        />
      ))}
    </div>
  );
  const made = madeText(task, me.id, nameOf);

  if (wide) {
    return (
      <div className="tbx-side" data-task-side="">
        <Item name="Status">{statusPicker}</Item>
        <Item name="Priority">{priorityPicker}</Item>
        <Item name="People">{peopleField}</Item>
        <hr />
        <Item name="Waiting on">{waitingOn}</Item>
        <Item name="Unblocks">{unblocksField}</Item>
        <hr />
        <Fact name="Board" value={boardName} />
        <Fact name="Made" value={made} />
        <Fact name="Time" value={inColumnShort(task)} />
      </div>
    );
  }
  return (
    <div className="tbx-side" data-task-side="" data-narrow="">
      <div className="tbx-halves">
        <div>
          <Item name="Status">{statusPicker}</Item>
          <Item name="Priority">{priorityPicker}</Item>
        </div>
        <div>
          <Item name="People">{peopleField}</Item>
        </div>
      </div>
      <hr />
      <div className="tbx-halves">
        <div>
          <Item name="Waiting on">{waitingOn}</Item>
        </div>
        <div>
          <Item name="Unblocks">{unblocksField}</Item>
        </div>
      </div>
      <hr />
      <div className="tbx-narrow-foot">
        <span className="tbx-parts">
          <span>{boardName}</span>
          <span>{made === "Not known" ? inColumnShort(task) : `made by ${made}`}</span>
          {made === "Not known" ? null : <span>{inColumnShort(task)}</span>}
        </span>
        {isReadOnly ? null : (
          <button
            type="button"
            className="tb-key"
            data-tone="red"
            {...tipAttrs({
              id: "task-box|delete",
              title: "Delete this task with its things and comments",
            })}
            onClick={(event) => onDelete(chromeAnchorOf(event.currentTarget))}
          >
            Delete task
          </button>
        )}
      </div>
    </div>
  );
}

/** "You, 3d ago", "ann, 5m ago": who made it and when; done tasks say when. */
function madeText(task: PlanTask, me: string, nameOf: (id: string) => string | undefined): string {
  const when = agoText(task.createdAt);
  const by =
    task.createdBy === me || task.createdBy === "local"
      ? "You"
      : task.createdBy
        ? nameOf(task.createdBy)
        : undefined;
  let text = by ?? "";
  if (when) text = text ? `${text}, ${when}` : when;
  if (task.status === "done" && task.doneAt) text += `. Done ${agoText(task.doneAt)}`;
  return text || "Not known";
}

function Item({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="tbx-item">
      <div className="tbx-item-label">{name.toUpperCase()}</div>
      {children}
    </div>
  );
}

function Fact({ name, value }: { name: string; value: string }) {
  return (
    <div className="tbx-fact">
      <span>{name}</span>
      <span>{value}</span>
    </div>
  );
}

function Caret() {
  return (
    <svg
      className="tbx-caret"
      width="5"
      height="3"
      viewBox="0 0 5 3"
      shapeRendering="crispEdges"
      aria-hidden
      fill="currentColor"
    >
      <path d="M0 0h5v1h-1v1h-1v1h-1v-1h-1v-1h-1z" />
    </svg>
  );
}

/** A task in a list of the side column: its status dot and title on one line; a click opens it, its x takes it off. */
function TaskLinkRow({
  task,
  tip,
  onOpen,
  onRemove,
}: {
  task: PlanTask;
  tip: string;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className="tbx-link"
      role="button"
      tabIndex={0}
      data-task-link-row={task.title}
      data-done={task.status === "done" ? "" : undefined}
      {...tipAttrs({
        id: `task-box|link|${task.id}|${tip}`,
        title: task.title,
        sub: `${TASK_STATUS_LABEL[task.status]}. ${tip}`,
        actions: [{ input: "left", label: "Open it" }],
      })}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <StatusDot status={task.status} size={5} />
      <span>{task.title}</span>
      {onRemove ? (
        <button
          type="button"
          className="tbx-off"
          aria-label={`It waits on ${task.title} no more`}
          {...tipAttrs({ id: `task-box|unblock|${task.id}`, title: "It waits on this no more" })}
          onClick={onRemove}
        >
          <Cross />
        </button>
      ) : null}
    </div>
  );
}
