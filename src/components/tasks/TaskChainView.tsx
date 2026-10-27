"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tipAttrs } from "@/components/flow/clean/interaction";
import type { PlanTask } from "@/lib/model/types";
import {
  inColumnText,
  shownPriority,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from "@/lib/tasks/task-board";
import { selectTask } from "@/lib/tasks/task-board-ui";
import { chainIds, chainRows, taskChains } from "@/lib/tasks/task-chain";
import { TASK_STATUS_COLOR } from "@/lib/tasks/task-links";
import { useFactoryStore } from "@/store/factory-store";
import { PriorityIcon, StatusDot, TaskFaces, useNameOf } from "./task-look";
import { TaskPlanLabel } from "./TaskPlanLabel";

/**
 * A task board's chain view, the quest book's way (the game's TaskChainView): a list of the tasks on the left, chain
 * by chain, and a map on the right that pans and zooms, each task a plain node (its column's colour down the left, its
 * title, priority and faces) with arrows from each task to the tasks it unblocks, in layers left to right
 * (task-chain.ts). Done tasks are dimmed; the tasks with no link sit in a row of their own at the end. A click on a
 * node opens its task; a row in the list selects its task and brings the map to it. Below 560 GUI pixels the list
 * folds to a strip.
 */

const NODE_W = 112;
const NODE_H = 40;
const COL_GAP = 30;
const ROW_GAP = 10;
const CHAIN_GAP = 24;
const MARGIN = 16;
const HEAD_H = 16;
const LIST_W = 132;
const LIST_SHUT = 14;
const ZOOMS = [0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
const DRAG_SLOP = 6;
const ARROW = "#5a5d66";
const ARROW_DONE = "#3d7a57";
const CYAN = "#22d3ee";

interface Layout {
  nodes: Map<string, { x: number; y: number }>;
  layers: Map<string, number>;
  width: number;
  height: number;
  looseY: number;
}

export function TaskChainView() {
  const project = useFactoryStore((state) => state.project);
  const tasks = project.tasks;
  const nameOf = useNameOf();
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [listOpen, setListOpen] = useState<boolean>();
  const [selected, setSelected] = useState<string>();
  const [hover, setHover] = useState<string>();
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 3, glide: false });
  const [panning, setPanning] = useState(false);
  const cameraSet = useRef(false);
  const suppressClick = useRef(false);

  const layout = useMemo(() => taskChains(project), [project]);
  const byId = useMemo(() => new Map((tasks ?? []).map((task) => [task.id, task])), [tasks]);
  const placed = useMemo<Layout>(() => {
    const nodes = new Map<string, { x: number; y: number }>();
    const layers = new Map<string, number>();
    let y = MARGIN;
    let right = 0;
    for (const chain of layout.chains) {
      const rows = chainRows(chain);
      chain.layers.forEach((layer, at) => {
        const x = MARGIN + at * (NODE_W + COL_GAP);
        // A short layer sits in the middle of the chain's band.
        let ny = y + ((rows - layer.length) * (NODE_H + ROW_GAP)) / 2;
        for (const id of layer) {
          nodes.set(id, { x, y: Math.round(ny) });
          layers.set(id, at);
          ny += NODE_H + ROW_GAP;
        }
        right = Math.max(right, x + NODE_W);
      });
      y += rows * (NODE_H + ROW_GAP) - ROW_GAP + CHAIN_GAP;
    }
    let looseY = -1;
    if (layout.loose.length > 0) {
      looseY = y;
      y += HEAD_H;
      let x = MARGIN;
      for (const id of layout.loose) {
        nodes.set(id, { x, y });
        x += NODE_W + ROW_GAP;
      }
      right = Math.max(right, x - ROW_GAP);
      y += NODE_H + CHAIN_GAP;
    }
    return { nodes, layers, width: right + MARGIN, height: y - CHAIN_GAP + MARGIN, looseY };
  }, [layout]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setSize({ w: root.offsetWidth, h: root.offsetHeight });
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const listShown = listOpen ?? size.w >= 560;
  const listW = listShown ? Math.min(LIST_W, Math.floor(size.w / 2)) : LIST_SHUT;
  const mapW = Math.max(0, size.w - listW);
  const scale = ZOOMS[camera.zoom]!;

  // First shown (or resized): from its top left, zoomed out (to half at most) so its chains show end to end.
  useEffect(() => {
    if (size.w === 0) return;
    cameraSet.current = true;
    let zoom = 3;
    while (zoom > 0 && placed.width * ZOOMS[zoom]! > mapW) zoom -= 1;
    setCamera({ x: 0, y: 0, zoom, glide: false });
    // The camera starts again when the view is resized, as the game's does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const centreOn = (id: string) => {
    const at = placed.nodes.get(id);
    if (!at) return;
    setCamera((now) => {
      const s = ZOOMS[now.zoom]!;
      return {
        ...now,
        x: at.x + NODE_W / 2 - mapW / s / 2,
        y: at.y + NODE_H / 2 - size.h / s / 2,
        glide: true,
      };
    });
  };

  const fit = () => {
    let zoom = 3;
    while (
      zoom > 0 &&
      (placed.width * ZOOMS[zoom]! > mapW || placed.height * ZOOMS[zoom]! > size.h)
    )
      zoom -= 1;
    const s = ZOOMS[zoom]!;
    setCamera({
      x: (placed.width - mapW / s) / 2,
      y: (placed.height - size.h / s) / 2,
      zoom,
      glide: true,
    });
  };

  /** The pointer in GUI pixels of the map. */
  const local = (clientX: number, clientY: number) => {
    const map = mapRef.current;
    if (!map || map.offsetWidth === 0) return { x: 0, y: 0, k: 2 };
    const box = map.getBoundingClientRect();
    const k = box.width / map.offsetWidth;
    return { x: (clientX - box.left) / k, y: (clientY - box.top) / k, k };
  };

  const onWheel = (event: React.WheelEvent) => {
    const at = local(event.clientX, event.clientY);
    setCamera((now) => {
      const zoom = Math.max(0, Math.min(ZOOMS.length - 1, now.zoom + (event.deltaY < 0 ? 1 : -1)));
      if (zoom === now.zoom) return now;
      const before = ZOOMS[now.zoom]!;
      const after = ZOOMS[zoom]!;
      // Zoom about the mouse: the map point under it stays under it.
      const mx = now.x + at.x / before;
      const my = now.y + at.y / before;
      return { x: mx - at.x / after, y: my - at.y / after, zoom, glide: false };
    });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const start = local(event.clientX, event.clientY);
    const from = camera;
    let moving = false;
    const move = (moved: PointerEvent) => {
      const at = local(moved.clientX, moved.clientY);
      if (!moving && Math.hypot(at.x - start.x, at.y - start.y) < DRAG_SLOP) return;
      if (!moving) {
        moving = true;
        setPanning(true);
      }
      const s = ZOOMS[from.zoom]!;
      // Some of the map stays in view however far it is dragged.
      const x = Math.max(
        -mapW / s + 40 / s,
        Math.min(placed.width - 40 / s, from.x - (at.x - start.x) / s),
      );
      const y = Math.max(
        -size.h / s + 40 / s,
        Math.min(placed.height - 40 / s, from.y - (at.y - start.y) / s),
      );
      setCamera({ x, y, zoom: from.zoom, glide: false });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (moving) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
      }
      setPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const lit = hover ?? selected;
  const arrows: Array<{ d: string; head: string; color: string; on: boolean }> = [];
  for (const task of tasks ?? []) {
    const to = placed.nodes.get(task.id);
    if (!to) continue;
    for (const blocker of new Set(task.blockedBy ?? [])) {
      const from = placed.nodes.get(blocker);
      const before = byId.get(blocker);
      if (!from || !before || blocker === task.id) continue;
      const x0 = from.x + NODE_W;
      const y0 = from.y + NODE_H / 2;
      const x1 = to.x;
      const y1 = to.y + NODE_H / 2;
      const mid = x1 > x0 ? x1 - COL_GAP / 2 : x0 + COL_GAP / 2;
      const on = task.id === lit || blocker === lit;
      arrows.push({
        d: `M${x0} ${y0}H${mid}V${y1}H${x1 - 4}`,
        head: `M${x1 - 5} ${y1 - 3.5}L${x1 - 5} ${y1 + 3.5}L${x1} ${y1}Z`,
        color: on ? CYAN : before.status === "done" ? ARROW_DONE : ARROW,
        on,
      });
    }
  }
  arrows.sort((a, b) => Number(a.on) - Number(b.on));
  const stroke = Math.max(1, 1 / scale);
  const count = tasks?.length ?? 0;

  return (
    <div className="tc" ref={rootRef} data-task-chain="">
      <div
        className="tc-list"
        data-folded={listShown ? undefined : ""}
        style={{ width: listW }}
        onClick={listShown ? undefined : () => setListOpen(true)}
        {...(listShown
          ? {}
          : tipAttrs({ id: "task-chain|unfold", title: "Show the list of tasks" }))}
      >
        {listShown ? (
          <>
            <div className="tc-list-head">
              {count === 1 ? "1 task" : `${count} tasks`}
              <button
                type="button"
                className="tc-fold"
                aria-label="Fold the list away"
                {...tipAttrs({ id: "task-chain|fold", title: "Fold the list away" })}
                onClick={() => setListOpen(false)}
              >
                <Caret right={false} />
              </button>
            </div>
            <div className="tc-list-body">
              {layout.chains.map((chain, at) => {
                const ids = chainIds(chain);
                return (
                  <div key={at} className="tc-chain" data-chain={at + 1}>
                    <div className="tc-heading">
                      Chain {at + 1}
                      <i>{ids.length}</i>
                    </div>
                    {ids.map((id) => (
                      <ListRow
                        key={id}
                        task={byId.get(id)}
                        layer={placed.layers.get(id) ?? 0}
                        on={id === selected}
                        onClick={() => {
                          setSelected(id);
                          centreOn(id);
                        }}
                      />
                    ))}
                  </div>
                );
              })}
              {layout.loose.length > 0 ? (
                <div className="tc-loose">
                  <div className="tc-heading">
                    Not linked
                    <i>{layout.loose.length}</i>
                  </div>
                  {layout.loose.map((id) => (
                    <ListRow
                      key={id}
                      task={byId.get(id)}
                      layer={0}
                      on={id === selected}
                      onClick={() => {
                        setSelected(id);
                        centreOn(id);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <button type="button" className="tc-fold" aria-label="Show the list of tasks">
            <Caret right />
          </button>
        )}
      </div>
      <div
        className="tc-map"
        ref={mapRef}
        data-panning={panning ? "" : undefined}
        style={{ width: mapW }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
      >
        {count === 0 ? (
          <div className="tc-empty">
            <p>No tasks yet.</p>
            <p>Press New task to add one.</p>
          </div>
        ) : (
          <div
            className="tc-world"
            data-zoom={scale}
            style={{
              width: placed.width,
              height: placed.height,
              transform: `translate(${Math.round(-camera.x * scale)}px, ${Math.round(-camera.y * scale)}px) scale(${scale})`,
              transition: camera.glide ? "transform 180ms ease-out" : undefined,
            }}
          >
            <svg className="tc-arrows" width={placed.width} height={placed.height} aria-hidden>
              {arrows.map((arrow, at) => (
                <g key={at} fill={arrow.color} stroke={arrow.color}>
                  <path d={arrow.d} fill="none" strokeWidth={stroke} shapeRendering="crispEdges" />
                  <path d={arrow.head} stroke="none" />
                </g>
              ))}
            </svg>
            {placed.looseY >= 0 ? (
              <div className="tc-loose-head" style={{ left: MARGIN, top: placed.looseY + 3 }}>
                {layout.chains.length === 0 ? "No task waits on another yet" : "Not linked"}
              </div>
            ) : null}
            {[...placed.nodes].map(([id, at]) => {
              const task = byId.get(id);
              if (!task) return null;
              const priority = shownPriority(task);
              return (
                <div
                  key={id}
                  className="tc-node"
                  role="button"
                  tabIndex={0}
                  data-task-node={task.title}
                  data-on={id === selected ? "" : undefined}
                  data-done={task.status === "done" ? "" : undefined}
                  style={{
                    left: at.x,
                    top: at.y,
                    ["--tb-stripe" as string]: TASK_STATUS_COLOR[task.status],
                  }}
                  {...tipAttrs({
                    id: `task-node|${id}`,
                    title: task.title,
                    sub: `${TASK_STATUS_LABEL[task.status]}. ${inColumnText(task)}`,
                    rows: [{ label: "Priority", value: TASK_PRIORITY_LABEL[priority] }],
                    actions: [{ input: "left", label: "Open it" }],
                  })}
                  onPointerEnter={() => setHover(id)}
                  onPointerLeave={() => setHover((now) => (now === id ? undefined : now))}
                  onClick={() => {
                    if (suppressClick.current) return;
                    setSelected(id);
                    selectTask(id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") selectTask(id);
                  }}
                >
                    <div className="tc-node-title"><TaskPlanLabel task={task} compact />{task.title}</div>
                  <PriorityIcon priority={priority} />
                  <TaskFaces ids={task.assignees ?? []} nameOf={nameOf} />
                </div>
              );
            })}
          </div>
        )}
        {count > 0 && layout.chains.length === 0 ? (
          <p className="tc-hint">Open a task and add what it waits on to link it.</p>
        ) : null}
        {count > 0 ? (
          <button
            type="button"
            className="tb-key tc-fit"
            {...tipAttrs({ id: "task-chain|fit", title: "Show every task" })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={fit}
          >
            Fit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ListRow({
  task,
  layer,
  on,
  onClick,
}: {
  task: PlanTask | undefined;
  layer: number;
  on: boolean;
  onClick: () => void;
}) {
  if (!task) return null;
  return (
    <div
      className="tc-row"
      role="button"
      tabIndex={0}
      data-task-row={task.title}
      data-on={on ? "" : undefined}
      data-done={task.status === "done" ? "" : undefined}
      style={{ paddingLeft: 6 + Math.min(layer, 4) * 5 }}
      {...tipAttrs({
        id: `task-row|${task.id}`,
        title: task.title,
        sub: TASK_STATUS_LABEL[task.status],
        actions: [{ input: "left", label: "Show it on the map" }],
      })}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter") onClick();
      }}
    >
      <StatusDot status={task.status} size={5} />
        <span><TaskPlanLabel task={task} compact />{task.title}</span>
    </div>
  );
}

/** A small caret: pointing right (open the list) or left (fold it). */
function Caret({ right }: { right: boolean }) {
  const d = right
    ? "M0 0h1v7h-1zM1 1h1v5h-1zM2 2h1v3h-1zM3 3h1v1h-1z"
    : "M3 0h1v7h-1zM2 1h1v5h-1zM1 2h1v3h-1zM0 3h1v1h-1z";
  return (
    <svg
      width="4"
      height="7"
      viewBox="0 0 4 7"
      shapeRendering="crispEdges"
      aria-hidden
      fill="currentColor"
    >
      <path d={d} />
    </svg>
  );
}
