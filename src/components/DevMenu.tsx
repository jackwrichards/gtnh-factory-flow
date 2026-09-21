"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BOARD_TIMELAPSE_SPEEDS,
  getBoardTimelapseCameraMode,
  getBoardTimelapseCameraPace,
  getBoardTimelapseCineZoom,
  getBoardTimelapseHoldEnding,
  getBoardTimelapsePopMs,
  getBoardTimelapseSpeed,
  getBoardTimelapseVolume,
  getBoardTimelapseWireDrawMs,
  getBoardTimelapseZoomRange,
  setBoardTimelapseCameraMode,
  setBoardTimelapseCameraPace,
  setBoardTimelapseCineZoom,
  setBoardTimelapseHoldEnding,
  setBoardTimelapsePopMs,
  setBoardTimelapseSpeed,
  setBoardTimelapseVolume,
  setBoardTimelapseWireDrawMs,
  setBoardTimelapseZoomRange,
  startBoardTimelapse,
  TIMELAPSE_CAMERA_PACE_MAX,
  TIMELAPSE_CAMERA_PACE_MIN,
  TIMELAPSE_CINE_ZOOM_MAX,
  TIMELAPSE_CINE_ZOOM_MIN,
  TIMELAPSE_POP_MAX_MS,
  TIMELAPSE_POP_MIN_MS,
  TIMELAPSE_WIRE_DRAW_MAX_MS,
  TIMELAPSE_WIRE_DRAW_MIN_MS,
  TIMELAPSE_ZOOM_CEILING,
  TIMELAPSE_ZOOM_FLOOR,
} from "./flow/board-timelapse";
import {
  BOARD_TILT_MAX_ANGLE,
  getBoardTiltSnapshot,
  writeBoardTilt,
  type BoardTilt,
} from "./flow/board-tilt";
import { isNodeDetailGlanceForced, setNodeDetailGlanceForced } from "./flow/node-detail";
import { isPerfHudEnabled, setPerfHudEnabled } from "./flow/PerfHud";
import {
  canRedoRouterTuning,
  canUndoRouterTuning,
  DEFAULT_ROUTER_TUNING,
  getRouterTuning,
  isDefaultRouterTuning,
  redoRouterTuning,
  requestWireReroute,
  resetArrangeTuning,
  isDefaultArrangeTuning,
  resetRouterTuning,
  ROUTER_TUNING_FIELDS,
  type RouterTuningField,
  setRouterTuning,
  undoRouterTuning,
  type RouterTuning,
} from "./flow/router-tuning";
import { useFactoryStore } from "@/store/factory-store";
import { readBoardGeometry, readBoardScore, type BoardScore } from "./flow/board-score";
import { decodeLayout, encodeLayout } from "@/lib/board-layout-string";
import { getUiScale } from "@/lib/ui-scale";

/** What a dial is and what its ends do, as the hover tooltip. */
function dialTooltip(field: RouterTuningField): string {
  return `${field.hint}\nLow: ${field.low}\nHigh: ${field.high}`;
}

/**
 * The dev menu, behind a shift-click on the version chip.
 *
 * One home for the dev tools, so new ones do not each claim a secret click
 * of their own. Deliberately undocumented in the UI - it is a workbench, not
 * a feature.
 *
 * A floating PALETTE, not a modal: no backdrop, no dim, no blur, dragged
 * around by its header. The tools in here act on the board live - the tilt
 * sliders especially - so the board has to stay visible and the panel has
 * to get out of the way of whatever it is adjusting.
 */
export function DevMenu({ onClose }: { onClose: () => void }) {
  const [perfHud, setPerfHud] = useState<boolean>(() => isPerfHudEnabled());
  // Two cards is the least board that reads as a sequence at all.
  const canPlayTimelapse = useFactoryStore(
    (state) => state.project.nodes.length + (state.project.storages?.length ?? 0) >= 2,
  );
  // The timelapse is CONFIGURED here, before it starts; during the run the
  // chip on the board only stops it. Both settings persist on this device.
  const [timelapseSpeed, setTimelapseSpeed] = useState<number>(() => getBoardTimelapseSpeed());
  const [cameraMode, setCameraMode] = useState(() => getBoardTimelapseCameraMode());
  const [cineZoom, setCineZoom] = useState(() => getBoardTimelapseCineZoom());
  // Every dial shows its number: a setting you can read is a setting you
  // can refer to, write down, and set back.
  const [volume, setVolume] = useState(() => getBoardTimelapseVolume());
  const [cameraPace, setCameraPace] = useState(() => getBoardTimelapseCameraPace());
  const [wireDrawMs, setWireDrawMs] = useState(() => getBoardTimelapseWireDrawMs());
  const [popMs, setPopMs] = useState(() => getBoardTimelapsePopMs());
  // The demo-card tilt: edits apply to the board live (a running timelapse
  // included - this menu opens over it without cancelling).
  const [tilt, setTilt] = useState<BoardTilt>(() => getBoardTiltSnapshot());
  const patchTilt = (patch: Partial<BoardTilt>) => {
    writeBoardTilt(patch);
    setTilt(getBoardTiltSnapshot());
  };
  const [zoomRange, setZoomRange] = useState(() => getBoardTimelapseZoomRange());
  const patchZoomRange = (patch: { min?: number; max?: number }) => {
    setBoardTimelapseZoomRange(patch);
    setZoomRange(getBoardTimelapseZoomRange());
  };
  const [forceGlance, setForceGlance] = useState(() => isNodeDetailGlanceForced());
  const [holdEnding, setHoldEnding] = useState(() => getBoardTimelapseHoldEnding());
  // The board's score, read off the displayed wires every half second
  // while the menu is open: crossings first, wire length second.
  const [score, setScore] = useState<BoardScore | undefined>(() => readBoardScore());
  useEffect(() => {
    const tick = () => setScore(readBoardScore());
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, []);
  const [layoutNote, setLayoutNote] = useState<string | undefined>(undefined);
  const copyLayout = async () => {
    const project = useFactoryStore.getState().project;
    const geometry = readBoardGeometry();
    const current = readBoardScore();
    const text = encodeLayout({
      planId: project.id,
      cards:
        geometry?.cards ??
        [...project.nodes, ...(project.storages ?? [])].map((card) => ({
          id: card.id,
          x: card.position.x,
          y: card.position.y,
        })),
      wires: geometry?.wires,
      score: current
        ? { crossings: current.crossings, length: current.length, points: current.points }
        : undefined,
    });
    try {
      await navigator.clipboard.writeText(text);
      setLayoutNote(`Layout copied: ${text.length} characters.`);
    } catch {
      window.prompt("Copy this layout string:", text);
      setLayoutNote(undefined);
    }
  };
  const pasteLayout = async () => {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = window.prompt("Paste a layout string:");
    }
    if (!text) return;
    const state = useFactoryStore.getState();
    try {
      const decoded = decodeLayout(text.trim(), state.project);
      if (decoded.moves.length === 0) {
        setLayoutNote("No card on this plan matched that layout.");
        return;
      }
      state.applyBoardArrangement({
        moves: decoded.moves,
        resetEdgeIds: state.project.edges.map((edge) => edge.id),
      });
      useFactoryStore.getState().frameBoardNodes();
      setLayoutNote(
        `Placed ${decoded.moves.length} cards${decoded.unknown.length ? `, ${decoded.unknown.length} unknown keys skipped` : ""}${decoded.missing.length ? `, ${decoded.missing.length} cards not in the layout` : ""}${decoded.otherPlan ? " (layout was made for another plan)" : ""}.`,
      );
    } catch (error) {
      setLayoutNote(error instanceof Error ? error.message : String(error));
    }
  };
  // The wire router's dials. Every change re-solves the board live.
  const [tuning, setTuning] = useState<RouterTuning>(() => getRouterTuning());
  const patchTuning = (patch: Partial<RouterTuning>) => {
    setRouterTuning(patch);
    setTuning(getRouterTuning());
  };

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) step the wire dials while the menu
  // has focus - a slider keeps focus after a drag, and the palette itself
  // takes focus on any click inside it. Elsewhere the keys stay the board's.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const focusInside =
        dialogRef.current !== null && dialogRef.current.contains(document.activeElement);
      if (!focusInside || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        if (undoRouterTuning()) {
          setTuning(getRouterTuning());
        }
        event.preventDefault();
        event.stopPropagation();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        if (redoRouterTuning()) {
          setTuning(getRouterTuning());
        }
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Dragged by the header, plain pointer capture. Clamped so the header can
  // never leave reach - a palette dragged offscreen is a palette lost.
  const [position, setPosition] = useState({ x: 16, y: 56 });
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number }>(undefined);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Dev menu"
      tabIndex={-1}
      className="fixed z-[120] flex max-h-[calc(85*var(--ui-vh))] w-96 max-w-[calc(100*var(--ui-vw)-16px)] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl outline-none"
      style={{ left: position.x, top: position.y }}
      onPointerDownCapture={(event) => {
        // Any click inside takes focus, so Ctrl+Z reaches the dials.
        if (!(event.target as Element).closest("input, button, select, textarea")) {
          event.currentTarget.focus();
        }
      }}
    >
      <div
        className="relative shrink-0 cursor-move touch-none select-none border-b border-line bg-gradient-to-br from-surface-raised to-surface px-5 py-4 compact:px-4"
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button")) {
            return;
          }
          // Inside the zoomed shell: the position is shell pixels, the
          // pointer real pixels, so the pointer is divided by the scale.
          const scale = getUiScale();
          dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX / scale - position.x,
            offsetY: event.clientY / scale - position.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }
          const scale = getUiScale();
          setPosition({
            x: Math.min(
              window.innerWidth / scale - 72,
              Math.max(72 - 384, event.clientX / scale - drag.offsetX),
            ),
            y: Math.min(
              window.innerHeight / scale - 48,
              Math.max(0, event.clientY / scale - drag.offsetY),
            ),
          });
        }}
        onPointerUp={() => {
          dragRef.current = undefined;
        }}
        onPointerCancel={() => {
          dragRef.current = undefined;
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded p-1.5 text-fg-subtle hover:bg-surface-raised hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-xl font-black leading-none tracking-tight">Dev menu</h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          Tools for working on the planner. Saved on this device. Drag me aside.
        </p>
      </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 compact:p-3">
          <button
            type="button"
            onClick={() => {
              const next = !perfHud;
              setPerfHudEnabled(next);
              setPerfHud(next);
            }}
            aria-pressed={perfHud}
            className={[
              "flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
              perfHud
                ? "border-cyan-600 bg-cyan-500/10"
                : "border-line hover:border-line-strong hover:bg-surface-raised",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">Performance readout</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Frame times, stutter counts and what is mounted, in the bottom left corner of the
                board.
              </span>
            </span>
            <Check
              aria-hidden
              className={["h-4 w-4 shrink-0", perfHud ? "text-cyan-400" : "invisible"].join(" ")}
            />
          </button>

          <div className="mt-2 rounded border border-line px-3 py-2.5">
            <span className="block text-base leading-tight text-fg">Build timelapse</span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              Replays this board being built: each machine lands, wires and drawers follow.
              Esc or a click stops it. Needs at least two cards.
            </span>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Speed</span>
              {BOARD_TIMELAPSE_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => {
                    setBoardTimelapseSpeed(speed);
                    setTimelapseSpeed(speed);
                  }}
                  className={[
                    "rounded border px-2 py-1 tabular-nums",
                    timelapseSpeed === speed
                      ? "border-cyan-600 bg-cyan-500/10 text-cyan-400"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  ].join(" ")}
                >
                  {speed}x
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Volume</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(event) => {
                  setBoardTimelapseVolume(Number(event.target.value) / 100);
                  setVolume(getBoardTimelapseVolume());
                }}
                aria-label="Timelapse sound volume"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Style</span>
              {(["follow", "cinematic"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setBoardTimelapseCameraMode(mode);
                    setCameraMode(mode);
                  }}
                  className={[
                    "rounded border px-2 py-1 capitalize",
                    cameraMode === mode
                      ? "border-cyan-600 bg-cyan-500/10 text-cyan-400"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  ].join(" ")}
                >
                  {mode}
                </button>
              ))}
            </div>
            {cameraMode === "cinematic" ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                <span className="w-14 shrink-0 text-fg-subtle">Offset</span>
                <input
                  type="range"
                  min={TIMELAPSE_CINE_ZOOM_MIN}
                  max={TIMELAPSE_CINE_ZOOM_MAX}
                  step={0.05}
                  value={cineZoom}
                  onChange={(event) => {
                    setBoardTimelapseCineZoom(Number(event.target.value));
                    setCineZoom(getBoardTimelapseCineZoom());
                  }}
                  aria-label="A constant nudge on the crane's own framing: 1 is the island-exact fit"
                  title="A constant nudge on whatever the crane decides: 1.00x frames the island exactly, higher sits closer, lower hangs back"
                  className="h-1 w-full accent-cyan-500"
                />
                <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                  {cineZoom.toFixed(2)}x
                </span>
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Camera</span>
              <input
                type="range"
                min={TIMELAPSE_CAMERA_PACE_MIN}
                max={TIMELAPSE_CAMERA_PACE_MAX}
                step={0.05}
                value={cameraPace}
                onChange={(event) => {
                  setBoardTimelapseCameraPace(Number(event.target.value));
                  setCameraPace(getBoardTimelapseCameraPace());
                }}
                aria-label="How briskly the camera travels between shots"
                title="How briskly the camera travels between shots"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {cameraPace.toFixed(2)}x
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Wire draw</span>
              <input
                type="range"
                min={TIMELAPSE_WIRE_DRAW_MIN_MS}
                max={TIMELAPSE_WIRE_DRAW_MAX_MS}
                step={20}
                value={wireDrawMs}
                onChange={(event) => {
                  setBoardTimelapseWireDrawMs(Number(event.target.value));
                  setWireDrawMs(getBoardTimelapseWireDrawMs());
                }}
                aria-label="How long a wire takes to draw itself in"
                title="How long a wire takes to draw itself in"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {wireDrawMs}ms
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Pop</span>
              <input
                type="range"
                min={TIMELAPSE_POP_MIN_MS}
                max={TIMELAPSE_POP_MAX_MS}
                step={20}
                value={popMs}
                onChange={(event) => {
                  setBoardTimelapsePopMs(Number(event.target.value));
                  setPopMs(getBoardTimelapsePopMs());
                }}
                aria-label="How long a card takes to fade and grow in"
                title="How long a card takes to fade and grow in"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-fg-muted">
                {popMs}ms
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Closest</span>
              <input
                type="range"
                min={TIMELAPSE_ZOOM_FLOOR}
                max={TIMELAPSE_ZOOM_CEILING}
                step={0.01}
                value={zoomRange.max}
                onChange={(event) => patchZoomRange({ max: Number(event.target.value) })}
                aria-label="The closest the camera may get"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {zoomRange.max.toFixed(2)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Widest</span>
              <input
                type="range"
                min={TIMELAPSE_ZOOM_FLOOR}
                max={TIMELAPSE_ZOOM_CEILING}
                step={0.01}
                value={zoomRange.min}
                onChange={(event) => patchZoomRange({ min: Number(event.target.value) })}
                aria-label="The widest the camera may go before the finale"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {zoomRange.min.toFixed(2)}
              </span>
            </div>
            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={holdEnding}
                onChange={(event) => {
                  setBoardTimelapseHoldEnding(event.target.checked);
                  setHoldEnding(getBoardTimelapseHoldEnding());
                }}
                className="accent-cyan-500"
              />
              Hold the final shot: when the last thing lands, the camera stays put
            </label>
            <button
              type="button"
              disabled={!canPlayTimelapse}
              onClick={() => {
                onClose();
                // Let the menu's backdrop leave before the board empties for
                // the first beat - the run starts on a clean canvas.
                requestAnimationFrame(() => startBoardTimelapse());
              }}
              className="mt-2.5 w-full rounded border border-cyan-700 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-fg-subtle"
            >
              Play
            </button>
          </div>



          <div className="mt-2 rounded border border-line px-3 py-2.5">
            <span className="block text-base leading-tight text-fg">Score</span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              The board as drawn: crossings first, wire second. Versus mode: copy your layout
              to send it, paste one to see it here.
            </span>
            <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-line px-2 py-1.5">
                <div className="text-2xl font-black tabular-nums leading-none text-fg">
                  {score ? score.crossings : "-"}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-fg-subtle">crossings</div>
              </div>
              <div className="rounded border border-line px-2 py-1.5">
                <div className="text-2xl font-black tabular-nums leading-none text-fg">
                  {score ? Math.round(score.points).toLocaleString() : "-"}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-fg-subtle">points</div>
              </div>
              <div className="rounded border border-line px-2 py-1.5">
                <div className="text-2xl font-black tabular-nums leading-none text-fg">
                  {score ? score.wires : "-"}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-wide text-fg-subtle">
                  {score && !score.settled ? "wires, routing" : "wires"}
                </div>
              </div>
            </div>
            {score ? (
              <p className="mt-2 text-xs tabular-nums text-fg-subtle">
                {Math.round(score.length).toLocaleString()} px of wire, {score.bends45} bends of 45°,{" "}
                {score.bends90} of 90°, priced at the Wires dials below. Lower is better.
              </p>
            ) : null}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => void copyLayout()}
                className="flex-1 rounded border border-cyan-700 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/20"
              >
                Copy layout
              </button>
              <button
                type="button"
                onClick={() => void pasteLayout()}
                className="flex-1 rounded border border-line px-3 py-1.5 text-sm text-fg-muted hover:border-line-strong hover:text-fg"
              >
                Paste layout
              </button>
            </div>
            {layoutNote ? <p className="mt-2 text-xs text-fg-muted">{layoutNote}</p> : null}
          </div>

          <div className="mt-2 rounded border border-line px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-base leading-tight text-fg">Wires</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  Every dial the wire router has. Costs are pixels of travel: a corner at 80
                  means a wire goes 80px out of its way to avoid one. Edits re-route the board
                  live.
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={!canUndoRouterTuning()}
                  title="Undo (Ctrl+Z)"
                  onClick={() => {
                    undoRouterTuning();
                    setTuning(getRouterTuning());
                  }}
                  className="rounded border border-line px-2 py-1 text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={!canRedoRouterTuning()}
                  title="Redo (Ctrl+Shift+Z)"
                  onClick={() => {
                    redoRouterTuning();
                    setTuning(getRouterTuning());
                  }}
                  className="rounded border border-line px-2 py-1 text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Redo
                </button>
                <button
                  type="button"
                  disabled={isDefaultRouterTuning()}
                  onClick={() => {
                    resetRouterTuning();
                    setTuning(getRouterTuning());
                  }}
                  className="rounded border border-line px-2 py-1 text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reset
                </button>
              </span>
            </div>
            <button
              type="button"
              onClick={() => requestWireReroute()}
              className="mt-2.5 w-full rounded border border-cyan-700 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/20"
            >
              Re-route all wires
            </button>
            {(["Turns", "Crossings", "Negotiation", "Docks", "Costs", "Search", "Arrange"] as const).map(
              (group) => (
                <div key={group} className="mt-3">
                  {group === "Turns" ? (
                    <span className="mb-1 block border-b border-line pb-1 text-xs font-semibold text-fg">
                      Wire routing. Every dial below changes how wires are drawn, and re-routes the board when moved.
                    </span>
                  ) : null}
                  {group === "Arrange" ? (
                    <span className="mb-1 mt-3 flex items-start justify-between gap-3 border-b border-line pb-1 text-xs font-semibold text-fg">
                      <span>
                        Auto arrange. These shape the Arrange button only; they never move a wire by themselves.
                      </span>
                      {/* Its own reset: the one at the top puts EVERY dial back,
                          and tuning the arranger should not cost the routing. */}
                      <button
                        type="button"
                        disabled={isDefaultArrangeTuning()}
                        onClick={() => {
                          resetArrangeTuning();
                          setTuning(getRouterTuning());
                        }}
                        className="shrink-0 rounded border border-line px-2 py-1 text-xs font-normal text-fg-muted hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Reset
                      </button>
                    </span>
                  ) : null}
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {group}
                  </span>
                  {ROUTER_TUNING_FIELDS.filter((field) => field.group === group).map((field) => {
                    const value = tuning[field.key];
                    const changed = value !== DEFAULT_ROUTER_TUNING[field.key];
                    if (field.kind === "boolean") {
                      return (
                        <div key={field.key} className="mt-1.5">
                        <label
                          title={dialTooltip(field)}
                          className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) => patchTuning({ [field.key]: event.target.checked })}
                            className="accent-cyan-500"
                          />
                          <span className={changed ? "text-cyan-300" : undefined}>{field.label}</span>
                        </label>
                        </div>
                      );
                    }
                    const number = Number(value);
                    return (
                      <div key={field.key} className="mt-2">
                        <div title={dialTooltip(field)} className="flex items-center gap-1.5 text-xs">
                        <span
                          className={[
                            "w-24 shrink-0 truncate",
                            changed ? "text-cyan-300" : "text-fg-subtle",
                          ].join(" ")}
                        >
                          {field.label}
                        </span>
                        <input
                          type="range"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={number}
                          onChange={(event) =>
                            patchTuning({ [field.key]: Number(event.target.value) })
                          }
                          aria-label={field.label}
                          className="h-1 w-full accent-cyan-500"
                        />
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={number}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) {
                              patchTuning({ [field.key]: next });
                            }
                          }}
                          aria-label={`${field.label} value`}
                          className="w-16 shrink-0 rounded border border-line bg-surface px-1 py-0.5 text-right tabular-nums text-fg"
                        />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ),
            )}
          </div>

          <div className="mt-2 rounded border border-line px-3 py-2.5">
            <span className="block text-base leading-tight text-fg">Board tilt</span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              The demo-card lean the timelapse plays under. Edits apply live, mid-run too.
            </span>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Pitch</span>
              <input
                type="range"
                min={-BOARD_TILT_MAX_ANGLE}
                max={BOARD_TILT_MAX_ANGLE}
                step={0.5}
                value={tilt.pitch}
                onChange={(event) => patchTilt({ pitch: Number(event.target.value) })}
                aria-label="Tilt pitch"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {tilt.pitch}&deg;
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="w-14 shrink-0 text-fg-subtle">Turn</span>
              <input
                type="range"
                min={-BOARD_TILT_MAX_ANGLE}
                max={BOARD_TILT_MAX_ANGLE}
                step={0.5}
                value={tilt.yaw}
                onChange={(event) => patchTilt({ yaw: Number(event.target.value) })}
                aria-label="Tilt turn"
                className="h-1 w-full accent-cyan-500"
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-fg-muted">
                {tilt.yaw}&deg;
              </span>
            </div>
            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={tilt.drift}
                onChange={(event) => patchTilt({ drift: event.target.checked })}
                className="accent-cyan-500"
              />
              Slow sway on top of the set angles
            </label>
            <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={tilt.always}
                onChange={(event) => patchTilt({ always: event.target.checked })}
                className="accent-cyan-500"
              />
              Keep the board tilted outside the timelapse too
            </label>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !forceGlance;
              setNodeDetailGlanceForced(next);
              setForceGlance(next);
            }}
            aria-pressed={forceGlance}
            className={[
              "mt-2 flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left",
              forceGlance
                ? "border-cyan-600 bg-cyan-500/10"
                : "border-line hover:border-line-strong hover:bg-surface-raised",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-tight text-fg">
                Zoomed-out card faces everywhere
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Every card wears its glance face at every zoom, however far in you are.
              </span>
            </span>
            <Check
              aria-hidden
              className={["h-4 w-4 shrink-0", forceGlance ? "text-cyan-400" : "invisible"].join(
                " ",
              )}
            />
          </button>
        </div>
    </div>
  );
}
