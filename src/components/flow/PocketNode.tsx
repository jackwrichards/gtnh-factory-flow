"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useState, type CSSProperties } from "react";
import { Copy, Maximize2, PackageOpen, Save } from "lucide-react";
import type { FactoryPocket } from "@/lib/model/types";
import { RECIPE_NODE_WIDTH } from "@/lib/board-grid";
import { fluidArtPixels, isSwatchFluid, ResourceIcon } from "@/components/nei/ResourceIcon";
import {
  captureBoardSelection,
  useFactoryStore,
  useRateDisplayUnits,
} from "@/store/factory-store";
import { useBlueprintStore } from "@/store/blueprint-store";

import { formatSlotRateOrNull } from "./flow-explainers";
import { isWiringConnection, wasRecentWireDrop } from "./connection-drag";
import { useBoardView } from "./board-view";
import { NodeGlanceText } from "./NodeGlance";
import { type PocketCrossing, type PocketSummary } from "./pocket-summary";
import { BOARD_EDGE, boardChrome, SELECTION_RING, type BoardChrome } from "./BoardNode";

export interface PocketNodeData extends Record<string, unknown> {
  pocket: FactoryPocket;
  summary?: PocketSummary;
}

export type PocketFlowNode = Node<PocketNodeData, "pocketNode">;

/**
 * A MINIMIZED BOARD: a summary you can look at, not a machine you can wire.
 *
 * It says what is inside (machines, cards, power) and what crosses its
 * border, and that is all it says. There are no ports on it: a wire from the
 * outside cannot be dropped on it, a drag cannot start from it, and nothing
 * on it claims to be starved or clogged. To change anything about the
 * factory in here you open the window - double-click, or the restore button.
 *
 * That is a deliberate retreat. The card used to wear input and output
 * ports built from a solve of the members with the outside world unhooked,
 * which meant a board holding its own source was told it was starving and a
 * board exporting a byproduct was told it was clogged. The numbers here now
 * come from the plan-wide solve, so they are the same numbers the board
 * itself would show with the window open.
 *
 * The wires crossing the border still land on the card - they have to go
 * somewhere - but they dock anywhere on its perimeter, like a drawer's, not
 * on a row that means something.
 */
export const POCKET_NODE_WIDTH = RECIPE_NODE_WIDTH;

/**
 * The inert anchors every crossing wire lands on. React Flow needs an
 * endpoint handle to exist for an edge to render at all; these have no size,
 * take no pointer, and mean nothing beyond "the wire ends at this card".
 */
export const POCKET_CARD_TARGET_HANDLE = "board-card-in";
export const POCKET_CARD_SOURCE_HANDLE = "board-card-out";

/*
 * Red for what the board must be brought, green for what it has to give
 * away: faint grounds with a title chip on each, the same pair the
 * right-hand panel uses. Only the BALANCE wears them. What crosses the
 * border is a plain accounting of wires - colouring it too made the card
 * two stacks of the same two colours saying different things.
 */
const IN_GROUND = "bg-red-500/18";
const IN_CHIP = "bg-red-500/30 text-red-50";
const IN_TONE = "text-red-200";
const OUT_GROUND = "bg-emerald-400/22";
const OUT_CHIP = "bg-emerald-400/30 text-emerald-50";
const OUT_TONE = "text-emerald-200";

/** A head-row control, in the board's clothes. */
function buttonStyle(chrome: BoardChrome): CSSProperties {
  return {
    borderColor: chrome.barBorder,
    backgroundColor: chrome.nameBg,
    color: chrome.ink,
    boxShadow: `inset 2px 2px 0 ${chrome.barBevelHi}, inset -2px -2px 0 ${chrome.barBevelLo}`,
  };
}

const INERT_HANDLE =
  "nodrag !pointer-events-none !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

function PocketNodeComponent({ data, selected }: NodeProps<PocketFlowNode>) {
  const { pocket, summary } = data;
  // A folded board is the SAME board: it wears the paper the window wore,
  // so you can tell which one it is at a glance instead of meeting an
  // anonymous purple card.
  const chrome = boardChrome(pocket.id, pocket.theme, pocket.colorTag);
  const expandPocket = useFactoryStore((state) => state.expandPocket);
  // The summary rows print rates, so the card follows the rate dials.
  useRateDisplayUnits();
  const dissolvePocket = useFactoryStore((state) => state.dissolvePocket);
  const renamePocket = useFactoryStore((state) => state.renamePocket);
  const deleteBoardSelection = useFactoryStore((state) => state.deleteBoardSelection);
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  // Presentation mode: the head row loses its edit chrome, exactly as a
  // machine card's does. A rename half-typed when the mode flips goes back to
  // being a plain name bar rather than stranding an input on a calm board.
  const { calmMode } = useBoardView();
  const isRenaming = draftName !== undefined && !calmMode;

  const needs = summary?.needs ?? [];
  const offers = summary?.offers ?? [];
  const incoming = summary?.incoming ?? [];
  const outgoing = summary?.outgoing ?? [];
  const hasNeeds = needs.length > 0 || offers.length > 0;
  const hasCrossings = incoming.length > 0 || outgoing.length > 0;

  // Pointing at a resource in the right-hand panel lights every card that
  // touches it. A minimized board touches one whenever it crosses the
  // border, so it lights on the same terms as a machine card.
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const litResourceKey = hoveredFlowResourceKey ?? selectedFlowResourceKey;
  const isResourceHighlighted =
    litResourceKey !== undefined &&
    [...incoming, ...outgoing].some((crossing) => crossing.key === litResourceKey);

  const commitRename = () => {
    if (draftName !== undefined) {
      renamePocket(pocket.id, draftName);
    }
    setDraftName(undefined);
  };

  // Clone the whole board — the frame, every member, every internal
  // wire — through the same capture/paste path Ctrl+C/Ctrl+V uses, so the
  // copy lands beside the original, selected and ready to drag.
  const duplicatePocket = () => {
    const state = useFactoryStore.getState();
    const payload = captureBoardSelection(state.project, [pocket.id]);
    if (!payload) {
      return;
    }
    const pastedIds = state.pasteBoardItems(payload, { x: POCKET_NODE_WIDTH + 40, y: 0 });
    if (pastedIds.length > 0) {
      state.setPendingBoardSelection(pastedIds);
    }
  };

  // Shelve the whole board: the save dialog opens
  // prefilled with the board's name and stat card, plus an icon to pick.
  const saveAsBlueprint = () => {
    const payload = captureBoardSelection(useFactoryStore.getState().project, [pocket.id]);
    if (payload) {
      useBlueprintStore.getState().setSaveRequest({ payload, name: pocket.name });
    }
  };

  return (
    <div
      className={[
        "group relative font-mono text-white",

        // On the shell, exactly where a machine card wears it, so the outline
        // frames the whole board rather than its inner window.
        isResourceHighlighted ? "resource-glow" : "",
      ].join(" ")}
      style={{
        width: POCKET_NODE_WIDTH,
        outline: selected ? `2px solid ${SELECTION_RING}` : undefined,
        outlineOffset: selected ? 1 : undefined,
      }}
      onDoubleClick={(event) => {
        // The name field manages its own double-click, the buttons are their
        // own controls, and the mouseup that lands a wire must never read as
        // "open the window".
        if (isWiringConnection() || wasRecentWireDrop()) {
          return;
        }
        const target = event.target as HTMLElement;
        if (!target.closest("input, button")) {
          expandPocket(pocket.id);
        }
      }}
    >
      {/* Where the crossing wires end. Inert on purpose: a minimized board
          is not a wiring surface. */}
      <Handle
        id={POCKET_CARD_TARGET_HANDLE}
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={INERT_HANDLE}
      />
      <Handle
        id={POCKET_CARD_SOURCE_HANDLE}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={INERT_HANDLE}
      />
      {/* The folded window. The rim is the board's own frame line at the
          board's own weight, drawn as an inset shadow on all four sides (a
          real border would push the rows off the grid) with a dark seat
          just inside it. It used to be a bevel - light top-left, dark
          bottom-right - which on dark paper read as an edge that simply
          stopped halfway round the card. */}
      <div
        data-node-glance-root=""
        className="relative"
        style={{
          backgroundColor: chrome.floorColor,
          backgroundImage: chrome.floorTexture,
          boxShadow: [
            `inset 0 0 0 ${BOARD_EDGE}px ${chrome.frameLine}`,
            `inset 0 0 0 ${BOARD_EDGE + 2}px ${chrome.barBevelLo}`,
          ].join(", "),
          color: chrome.ink,
        }}
      >
        {/* Zoomed out, the card is a star on purple — a board, not a machine.
            Hovering opens the same reveal a machine card gives. */}
        <NodeGlanceText text="✦" accent={chrome.inkMuted} />
        <PocketGlanceReveal
          name={pocket.name}
          chrome={chrome}
          needs={needs}
          offers={offers}
        />
        {/* The title bar, cut from the same paper as the window's: the
            folded board has to read as the same object. Exactly two cells
            tall either way, so everything below keeps its grid lines. */}
        <div
          className="px-2"
          style={{
            backgroundColor: chrome.barBg,
            boxShadow: `inset 0 -2px 0 ${chrome.barBevelLo}`,
          }}
        >
          {/* Delete/clone on the left like every card's edit chrome, the
              name in the middle, shelve, dump and restore on the right —
              restore rightmost, where a window keeps it. Calm mode drops all
              five and gives the whole row to the name. */}
          <div
            className={[
              "grid h-[40px] min-w-0 items-center gap-1",
              calmMode
                ? "grid-cols-[minmax(0,1fr)]"
                : "grid-cols-[24px_24px_minmax(0,1fr)_24px_24px_24px]",
            ].join(" ")}
          >
            {!calmMode ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteBoardSelection({ nodeIds: [pocket.id] });
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 hover:bg-red-700"
                  style={buttonStyle(chrome)}
                  title="Delete board"
                  aria-label={`Delete board ${pocket.name}`}
                >
                  {/* Drawn rather than a "-" glyph: at this size Monocraft's
                      metrics baseline-align the hyphen low instead of centring. */}
                  <span aria-hidden className="block h-[2px] w-[8px] bg-white" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    duplicatePocket();
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 hover:brightness-125"
                  style={buttonStyle(chrome)}
                  title="Clone board"
                  aria-label={`Clone board ${pocket.name}`}
                >
                  <Copy aria-hidden className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
            {!isRenaming ? (
              <div
                className="minecraft-title flex h-6 min-w-0 items-center border-2 px-2 text-[13px] leading-[18px]"
                style={buttonStyle(chrome)}
                title={
                  calmMode
                    ? `${pocket.name} (double-click the card to open the window)`
                    : `${pocket.name} (double-click the name to rename, double-click the card to open the window)`
                }
                onDoubleClick={
                  // Renaming is editing, so calm mode lets the double-click
                  // fall through to the card and just open the window.
                  calmMode
                    ? undefined
                    : (event) => {
                        event.stopPropagation();
                        setDraftName(pocket.name);
                      }
                }
              >
                <span className="mx-auto min-w-0 truncate">✦ {pocket.name}</span>
              </div>
            ) : (
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    setDraftName(undefined);
                  }
                  event.stopPropagation();
                }}
                className="nodrag h-6 min-w-0 border-2 px-1 text-[13px] leading-none outline-none"
                style={{
                  borderColor: chrome.grip,
                  backgroundColor: chrome.barBevelLo,
                  color: chrome.ink,
                }}
              />
            )}
            {!calmMode ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveAsBlueprint();
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 hover:brightness-125"
                  style={buttonStyle(chrome)}
                  title={`Save "${pocket.name}" to my shelf (sign in required)`}
                  aria-label={`Save board ${pocket.name} to my shelf`}
                >
                  <Save aria-hidden className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dissolvePocket(pocket.id);
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 hover:brightness-125"
                  style={buttonStyle(chrome)}
                  title="Dump board"
                  aria-label={`Dump board ${pocket.name}`}
                >
                  <PackageOpen aria-hidden className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    expandPocket(pocket.id);
                  }}
                  className="nodrag flex h-6 w-6 items-center justify-center border-2 hover:brightness-125"
                  style={buttonStyle(chrome)}
                  title="Open board"
                  aria-label={`Open board ${pocket.name}`}
                >
                  <Maximize2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="px-2">
          {/* Two readings, stacked. First what this board IS as a factory:
              what its contents need brought in, and what they make that
              nothing inside drinks — red in, green out, the same pair the
              right-hand panel uses for the whole plan. Then what actually
              crosses the border on wires. Reading only: no ports, nothing to
              grab, nothing to drop a wire on. */}
          {!hasNeeds && !hasCrossings ? (
            <div
              className="flex h-[80px] items-center justify-center text-center text-[11px] leading-4"
              style={{ color: chrome.inkMuted }}
            >
              Nothing goes in or out.
              <br />
              Open the window to work on it.
            </div>
          ) : (
            <>
              <CardSection
                leftLabel="NEEDS"
                rightLabel="MAKES"
                left={needs}
                right={offers}
                painted
                chrome={chrome}
              />
              {hasNeeds && hasCrossings ? (
                <div className="flex h-[20px] items-center">
                  <span
                    aria-hidden
                    className="h-px w-full"
                    style={{ backgroundColor: chrome.frameLine }}
                  />
                </div>
              ) : null}
              <CardSection
                leftLabel="COMING IN"
                rightLabel="GOING OUT"
                left={incoming}
                right={outgoing}
                chrome={chrome}
              />
            </>
          )}

          {/* What is inside, in one line. */}
          <div
            className="flex h-[40px] min-w-0 items-center justify-center gap-2 border-t text-[11px] leading-4"
            style={{ borderColor: chrome.frameLine, color: chrome.inkMuted }}
          >
            <span className="truncate">
              {summary
                ? [
                    `${summary.machineCount}× ${summary.machineCount === 1 ? "machine" : "machines"}`,
                    `${summary.memberCount} ${summary.memberCount === 1 ? "card" : "cards"}`,
                    summary.euPerTick > 0
                      ? `${Math.round(summary.euPerTick).toLocaleString()} EU/t`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "minimized board"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One two-column block: what comes in on the left, what goes out on the
 * right, each half on its own faint ground - red in, green out, the pair
 * the right-hand panel has always used. A 20px label line carries a chip
 * over each column so the two halves read as two lists rather than one
 * wide table. An empty section draws nothing at all, which is what keeps
 * `pocketCardHeight` and the DOM agreeing on the card's height.
 */
function CardSection({
  leftLabel,
  rightLabel,
  left,
  right,
  painted,
  chrome,
}: {
  leftLabel: string;
  rightLabel: string;
  left: PocketCrossing[];
  right: PocketCrossing[];
  /** The balance wears red and green; the wire crossings do not. */
  painted?: boolean;
  chrome: BoardChrome;
}) {
  if (left.length === 0 && right.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-2 items-start gap-1">
      <SectionColumn
        label={leftLabel}
        lines={left}
        side="in"
        chrome={chrome}
        ground={painted ? IN_GROUND : undefined}
        chip={painted ? IN_CHIP : undefined}
        tone={painted ? IN_TONE : undefined}
      />
      <SectionColumn
        label={rightLabel}
        lines={right}
        side="out"
        chrome={chrome}
        ground={painted ? OUT_GROUND : undefined}
        chip={painted ? OUT_CHIP : undefined}
        tone={painted ? OUT_TONE : undefined}
      />
    </div>
  );
}

/**
 * One half of a section: a centred title chip over its own list. Painted
 * halves get a faint ground, which ends with the last line - a ground that
 * ran to the bottom of the taller column would draw a coloured box around
 * nothing.
 */
function SectionColumn({
  label,
  lines,
  side,
  chrome,
  ground,
  chip,
  tone,
}: {
  label: string;
  lines: PocketCrossing[];
  side: "in" | "out";
  chrome: BoardChrome;
  ground?: string;
  chip?: string;
  tone?: string;
}) {
  if (lines.length === 0) {
    return <div />;
  }
  return (
    <div className={`flex min-w-0 flex-col ${ground ?? ""}`}>
      <div className="flex h-[20px] items-center justify-center">
        <span
          className={`px-1.5 text-[10px] font-bold leading-[14px] tracking-wide ${chip ?? ""}`}
          style={chip ? undefined : { backgroundColor: chrome.nameBg, color: chrome.ink }}
        >
          {label}
        </span>
      </div>
      {lines.map((line) => (
        <CrossingRow
          key={line.key}
          crossing={line}
          side={side}
          tone={tone}
          chrome={chrome}
        />
      ))}
    </div>
  );
}

/**
 * One resource line: its icon, its name, and what is really moving. Two
 * cells tall, like a machine card's port row, so the card stays on the grid
 * — but it is a line of text, not a port.
 */
function CrossingRow({
  crossing,
  side,
  tone,
  chrome,
}: {
  crossing: PocketCrossing;
  side: "in" | "out";
  tone?: string;
  chrome: BoardChrome;
}) {
  const rate = formatSlotRateOrNull(crossing.ratePerSecond, crossing.kind);
  const icon = (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden">
      <ResourceIcon
        resource={{ ...crossing, id: crossing.resourceId, amount: 1 }}
        bare
        tooltip={false}
        showAmount={false}
        iconPixelSize={
          crossing.kind === "fluid"
            ? isSwatchFluid(crossing)
              ? 32
              : fluidArtPixels(24)
            : undefined
        }
        className={crossing.kind === "fluid" ? "!h-6 !w-6" : "!h-6 !w-6 origin-center scale-150"}
      />
    </span>
  );
  const text = (
    <span className={`flex min-w-0 flex-1 flex-col ${side === "out" ? "text-right" : ""}`}>
      <span
        className="truncate text-[11px] font-bold leading-[14px]"
        style={{ color: chrome.ink }}
      >
        {crossing.displayName ?? crossing.resourceId}
      </span>
      <span
        className={`truncate text-[10px] leading-[12px] tabular-nums ${tone ?? ""}`}
        style={tone ? undefined : { color: chrome.inkMuted }}
      >
        {rate ?? "0/s"}
        {crossing.wireCount > 1 ? ` · ${crossing.wireCount} wires` : ""}
      </span>
    </span>
  );
  return (
    <span
      className="flex h-[40px] min-w-0 items-center gap-1"
      title={`${crossing.displayName ?? crossing.resourceId}: ${rate ?? "nothing moving"}`}
    >
      {side === "in" ? (
        <>
          {icon}
          {text}
        </>
      ) : (
        <>
          {text}
          {icon}
        </>
      )}
    </span>
  );
}


// Position props change every drag frame; the component only reads `data` and
// `selected`, so comparing exactly those keeps the card from re-rendering while
// its wrapper is translated (see RecipeNode for the long version).
export const PocketNode = memo(
  PocketNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/**
 * The zoomed-out hover reveal: the same summary at screen size. Pure CSS
 * shows it (globals.css `.glance-io`) only at the glance detail level on
 * hover — the panel is in the DOM from the start, so hovering never rebuilds
 * the board. `absolute inset-0` like every glance layer: no say in the
 * card's size, invisible to the router.
 */
function PocketGlanceReveal({
  name,
  chrome,
  needs,
  offers,
}: {
  name: string;
  chrome: BoardChrome;
  needs: PocketCrossing[];
  offers: PocketCrossing[];
}) {
  return (
    <div
      data-node-detail="glance"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <span
        className="glance-io absolute left-1/2 top-full z-30 w-[560px] origin-top flex-col gap-2 border-2 p-3 font-mono shadow-[8px_8px_0_rgba(0,0,0,0.55)]"
        style={{
          borderColor: chrome.barBorder,
          backgroundColor: chrome.floorColor,
          backgroundImage: chrome.floorTexture,
          color: chrome.ink,
        }}
      >
        <span
          className="minecraft-title flex h-8 min-w-0 items-center border-2 px-2 text-[16px] leading-[22px]"
          style={buttonStyle(chrome)}
        >
          <span className="mx-auto min-w-0 truncate">✦ {name}</span>
        </span>
        {needs.length > 0 || offers.length > 0 ? (
          <span className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-x-1">
            <span className="flex min-w-0 flex-col gap-1">
              {needs.map((line) => (
                <PocketGlanceIoRow
                  key={line.key}
                  crossing={line}
                  tone={IN_TONE}
                  chrome={chrome}
                />
              ))}
            </span>
            <span
              className="flex items-start justify-center pt-2 text-[20px] font-black leading-6"
              style={{ color: chrome.inkMuted }}
            >
              →
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              {offers.map((line) => (
                <PocketGlanceIoRow
                  key={line.key}
                  crossing={line}
                  tone={OUT_TONE}
                  chrome={chrome}
                />
              ))}
            </span>
          </span>
        ) : (
          <span className="text-center text-[13px]" style={{ color: chrome.inkMuted }}>
            Nothing goes in or out.
          </span>
        )}
      </span>
    </div>
  );
}

/** One line of the reveal, in the board's own clothes. */
function PocketGlanceIoRow({
  crossing,
  tone,
  chrome,
}: {
  crossing: PocketCrossing;
  tone: string;
  chrome: BoardChrome;
}) {
  const rate = formatSlotRateOrNull(crossing.ratePerSecond, crossing.kind);
  return (
    <span
      className="flex items-center gap-1.5 border-2 px-1 py-0.5"
      style={{
        backgroundColor: chrome.nameBg,
        borderColor: chrome.barBorder,
        boxShadow: `inset 1px 1px 0 ${chrome.barBevelHi}, inset -1px -1px 0 ${chrome.barBevelLo}`,
      }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
        <ResourceIcon
          resource={{ ...crossing, id: crossing.resourceId, amount: 1 }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={
            crossing.kind === "fluid"
              ? isSwatchFluid(crossing)
                ? 50
                : fluidArtPixels(36)
              : undefined
          }
          className={crossing.kind === "fluid" ? "!h-9 !w-9" : "!h-9 !w-9 origin-center scale-150"}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-bold leading-[17px]">
          {crossing.displayName ?? crossing.resourceId}
        </span>
        {rate ? (
          <span className={`truncate text-[13px] leading-4 tabular-nums ${tone}`}>{rate}</span>
        ) : null}
      </span>
    </span>
  );
}
