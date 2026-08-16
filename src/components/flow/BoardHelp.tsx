import {
  Activity,
  Anchor,
  Box,
  Cable,
  Download,
  Ellipsis,
  Factory,
  Focus,
  Gauge,
  Grid3x3,
  Magnet,
  Paintbrush,
  Palette,
  Play,
  Presentation,
  RotateCcw,
  Search,
  Share2,
  Square,
  Tag,
  Trash,
  Trash2,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  GLANCE_CARD_CLASS,
  GLANCE_LINE,
  GLANCE_QUIET,
  GlanceRows,
  GlanceTitle,
  type GlanceRow,
} from "@/components/tour/card-parts";
import { TOUR_LESSONS } from "@/lib/tour/lessons";
import { startLesson } from "@/lib/tour/tour-state";

/**
 * The board's help corner: a "?" where the zoom buttons used to live.
 *
 * Hovering it lays a glance sheet over the whole window: every toolbar and
 * panel gets a dashed ring, a solid arrow, and a card naming what is in it,
 * using the same card the guided tour uses (see `card-parts.tsx`) so the two
 * ways of being shown around read as one thing. Beside the button sit the
 * guided tours themselves, because "what does this do" and "show me" are the
 * same question asked twice, and this corner is where people ask it.
 *
 * Pure glance layer with one exception: pointer events stay off everywhere
 * except the tours card, which you can actually press. Moving away folds the
 * whole thing up again.
 *
 * The sheet portals to <body>: the board, the browser and the inspector each
 * sit in their own stacking contexts, so a scrim rendered inside the board
 * could never dim its neighbours.
 *
 * Regions are found by their `data-help-anchor` attribute and measured once
 * per open, so the overlay follows the real layout instead of hardcoding it.
 * Several elements may share one anchor id; their rects union (the paint row
 * uses this to ring only its visible buttons, not the folded-away palette).
 */

type HelpRect = { left: number; top: number; right: number; bottom: number };

type Measured = {
  rects: Record<string, HelpRect>;
  button?: HelpRect;
  vw: number;
  vh: number;
};

/** Which side of its anchor a callout card sits on. */
type CalloutSide = "left" | "right" | "above" | "below";
type CalloutAlign = "start" | "center" | "end";

/** Card edge to ring edge: room for the arrow to read as an arrow. */
const CALLOUT_GAP = 18;
const RING_PAD = 5;
const ARROW_HEAD = 12;
/** Long enough to cross the gap from the button to the tours card. */
const HIDE_GRACE_MS = 160;

/**
 * The sheet's own accent: one soft blue-grey.
 *
 * Not the tour's cyan. The tour rings ONE thing at a time and can afford to
 * shout; this draws seven rings and eight cards over the whole window at once,
 * and in cyan that reads as an alarm going off. Cyan is kept for the single
 * card down here you can actually click.
 */
const ACCENT = GLANCE_QUIET;
const ACCENT_DIM = "rgba(147, 164, 187, 0.5)";

const CALLOUTS: Array<{
  anchor: string;
  side: CalloutSide;
  align: CalloutAlign;
  /** Extra push away from the anchor, past the standard gap. */
  offset?: number;
  /** Slide along the anchor's edge, in px, after align. */
  shift?: number;
  title: string;
  rows: GlanceRow[];
}> = [
  {
    // One card for the whole column: its three tabs, and nothing about how to
    // use them. Two cards up here fought the Designs card for the same corner.
    anchor: "browser",
    side: "right",
    align: "center",
    // Lifted off centre into the one clear band on this side: the build tools
    // card takes the top of the board and the moves-and-tours stack takes the
    // bottom, so dead centre would land on the stack.
    shift: -120,
    title: "The left column",
    rows: [
      { icon: Search, text: "*Items*: search the whole pack" },
      { chip: "✦", text: "*Pockets*: saved chunks" },
      { icon: Factory, text: "*Setups*: shared factories" },
    ],
  },
  {
    // The top-right band is three deep (header buttons, paint row, view row),
    // so this card slides right until it clears the paint ring and rides over
    // the inspector's dimmed head instead. Rows stay short to keep it narrow
    // enough for that gap.
    anchor: "plan-actions",
    side: "below",
    align: "end",
    shift: 150,
    title: "This plan",
    rows: [
      { icon: Undo2, text: "Undo and redo" },
      { icon: Trash2, text: "Clean the board" },
      { icon: Share2, text: "Share it with everyone" },
      { icon: Upload, text: "Import a plan" },
      { icon: Download, text: "Export it out" },
    ],
  },
  {
    anchor: "build",
    side: "below",
    align: "start",
    // Dropped below the designs card's band; the longer arrow reads better.
    offset: 50,
    title: "Build tools",
    // Left to right as the plates sit: history, how the numbers read, then
    // the plate that places cards.
    rows: [
      { icon: Undo2, text: "Undo and redo" },
      { chip: "/s", text: "Rates per tick, second, minute or hour" },
      { icon: Wand2, text: "*Sketch mode*: unwired slots come free" },
      { icon: Trash, text: "Place *farm*, *trash can*, *custom rate*" },
    ],
  },
  {
    anchor: "paint",
    side: "left",
    align: "start",
    // Pushed further out so the card clears the view row's ring below.
    offset: 56,
    title: "Paint and notes",
    rows: [
      { icon: Paintbrush, text: "Paint cards" },
      { icon: Square, text: "Box, zone, arrow, note, image" },
      { text: "Select a box for border and fill styles" },
      { icon: Trash2, text: "*Bin*: delete anything" },
    ],
  },
  {
    anchor: "view",
    side: "below",
    align: "end",
    title: "View options",
    rows: [
      { text: "View only, *never the plan*" },
      { icon: Grid3x3, text: "Background style and pattern" },
      { icon: Palette, text: "Shade lines by volume" },
      { icon: Cable, text: "Thicken lines by volume" },
      { icon: Ellipsis, text: "Marching dashes" },
      { icon: Tag, text: "Rate labels on the lines" },
      { icon: Anchor, text: "Free or fixed wire ends" },
      { icon: Presentation, text: "Calm colours" },
      { icon: Magnet, text: "Smooth movement" },
      { icon: Activity, text: "Numbers ease into place" },
    ],
  },
  {
    anchor: "glance",
    side: "above",
    align: "end",
    title: "Framing",
    rows: [
      { icon: Focus, text: "Fit the plan on screen" },
      { icon: Box, text: "Cards show their machine" },
      { icon: Gauge, text: "Cards show how hard they run" },
    ],
  },
  {
    anchor: "plan-card",
    side: "above",
    align: "start",
    title: "Plan card",
    rows: [
      { text: "This plan's *icon, name and blurb*" },
      { icon: Share2, text: "Sharing posts them as its face" },
      { icon: RotateCcw, text: "An opened setup can *reset to the post*" },
    ],
  },
  {
    anchor: "inspector",
    side: "left",
    align: "center",
    title: "Plan totals",
    rows: [
      { chip: "INPUTS", tone: "need", text: "Bring this in yourself" },
      { chip: "OUTPUTS", tone: "output", text: "Leaves the plan" },
      { chip: "INTERNAL", tone: "internal", text: "Made and used here" },
      { text: "Machines adds up every machine the plan needs" },
      { text: "Hover a row to light up the board" },
    ],
  },
];

/** The gestures no button reveals. Six, not ten: this is a reminder, not a manual. */
const MOVES: GlanceRow[] = [
  { mouse: "left", text: "Drag a slot to *wire it*" },
  { mouse: "left", text: "Drop on empty board for *a drawer*" },
  { mouse: "right", text: "Right click for *what uses it*" },
  { chip: "Shift", text: "Box-select, or add one" },
  { chip: "Ctrl+G", text: "Pack it into *a pocket*" },
  { chip: "Del", text: "Remove the selection" },
];

function toHelpRect(rect: DOMRect): HelpRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function measureAnchors(): Record<string, HelpRect> {
  const rects: Record<string, HelpRect> = {};
  document.querySelectorAll<HTMLElement>("[data-help-anchor]").forEach((element) => {
    const id = element.dataset.helpAnchor;
    const rect = element.getBoundingClientRect();
    if (!id || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const seen = rects[id];
    rects[id] = seen
      ? {
          left: Math.min(seen.left, rect.left),
          top: Math.min(seen.top, rect.top),
          right: Math.max(seen.right, rect.right),
          bottom: Math.max(seen.bottom, rect.bottom),
        }
      : toHelpRect(rect);
  });
  return rects;
}

function calloutStyle(
  callout: (typeof CALLOUTS)[number],
  rect: HelpRect,
  vw: number,
  vh: number,
): CSSProperties {
  const { side, align } = callout;
  const push = RING_PAD + CALLOUT_GAP + (callout.offset ?? 0);
  const style: CSSProperties = {};
  if (side === "right") {
    style.left = rect.right + push;
  } else if (side === "left") {
    style.right = vw - rect.left + push;
  } else if (side === "below") {
    style.top = rect.bottom + push;
  } else {
    style.bottom = vh - rect.top + push;
  }
  const shift = callout.shift ?? 0;
  if (side === "left" || side === "right") {
    if (align === "center") {
      style.top = (rect.top + rect.bottom) / 2 + shift;
      style.transform = "translateY(-50%)";
    } else if (align === "end") {
      style.bottom = vh - rect.bottom - shift;
    } else {
      style.top = rect.top + shift;
    }
  } else {
    if (align === "end") {
      style.right = vw - rect.right - shift;
    } else if (align === "center") {
      style.left = (rect.left + rect.right) / 2 + shift;
      style.transform = "translateX(-50%)";
    } else {
      style.left = rect.left + shift;
    }
  }
  return style;
}

/**
 * A solid arrow growing out of the card's facing edge: stem from the card,
 * chunky head touching the target's ring. Sized to span the exact gap.
 */
function CalloutArrow({
  side,
  align,
  length,
}: {
  side: CalloutSide;
  align: CalloutAlign;
  length: number;
}) {
  const vertical = side === "below" || side === "above";
  const wrapper: CSSProperties = vertical
    ? { height: length, width: 16 }
    : { width: length, height: 16 };
  if (side === "below") {
    wrapper.bottom = "100%";
  } else if (side === "above") {
    wrapper.top = "100%";
  } else if (side === "right") {
    wrapper.right = "100%";
  } else {
    wrapper.left = "100%";
  }
  if (vertical) {
    if (align === "center") {
      wrapper.left = "50%";
      wrapper.transform = "translateX(-50%)";
    } else if (align === "end") {
      wrapper.right = 20;
    } else {
      wrapper.left = 20;
    }
  } else {
    if (align === "center") {
      wrapper.top = "50%";
      wrapper.transform = "translateY(-50%)";
    } else if (align === "end") {
      wrapper.bottom = 12;
    } else {
      wrapper.top = 12;
    }
  }
  // The head aims at the anchor, so it leads on the anchor-facing end.
  const head: CSSProperties =
    side === "below"
      ? {
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: `${ARROW_HEAD}px solid ${ACCENT}`,
        }
      : side === "above"
        ? {
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: `${ARROW_HEAD}px solid ${ACCENT}`,
          }
        : side === "right"
          ? {
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderRight: `${ARROW_HEAD}px solid ${ACCENT}`,
            }
          : {
              borderTop: "8px solid transparent",
              borderBottom: "8px solid transparent",
              borderLeft: `${ARROW_HEAD}px solid ${ACCENT}`,
            };
  const headFirst = side === "below" || side === "right";
  const stem: CSSProperties = vertical
    ? { width: 3, backgroundColor: ACCENT }
    : { height: 3, backgroundColor: ACCENT };
  return (
    <span
      className={["absolute flex items-center", vertical ? "flex-col" : "flex-row"].join(" ")}
      style={wrapper}
    >
      {headFirst ? <span className="h-0 w-0" style={head} /> : null}
      <span className="flex-1" style={stem} />
      {headFirst ? null : <span className="h-0 w-0" style={head} />}
    </span>
  );
}

/** One of the sheet's cards: a headline, then its rows. */
function GlanceCard({
  title,
  rows,
  className,
  style,
}: {
  title: string;
  rows: GlanceRow[];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={[GLANCE_CARD_CLASS, "px-3 py-2.5", className].filter(Boolean).join(" ")}
      style={{ border: `2px solid ${GLANCE_LINE}`, ...style }}
    >
      <GlanceTitle dense>{title}</GlanceTitle>
      <div className="mt-2">
        <GlanceRows rows={rows} accent={ACCENT} dense />
      </div>
    </div>
  );
}

/**
 * The one thing down here you can press: the guided tours, offered where people
 * already come looking for help. Cyan, because everything else on this sheet is
 * only there to be read.
 */
function ToursCard({ onStart }: { onStart: (lessonId: string) => void }) {
  return (
    <div
      className={`${GLANCE_CARD_CLASS} pointer-events-auto px-3 py-2.5`}
      style={{ border: "2px solid #1c4a56" }}
    >
      <GlanceTitle dense>Guided tours</GlanceTitle>
      <div className="mt-2 flex flex-col gap-1">
        {TOUR_LESSONS.map((lesson) => (
          <button
            key={lesson.id}
            type="button"
            onClick={() => onStart(lesson.id)}
            className="flex items-center gap-2 border border-transparent px-1.5 py-1 text-left text-[12px] leading-tight text-[#a5f3fc] hover:border-cyan-800 hover:bg-cyan-500/10"
          >
            <Play className="h-3 w-3 shrink-0" aria-hidden />
            <span className="flex-1">{lesson.title}</span>
            <span className="shrink-0 text-[10px] text-[#5e7183]">{lesson.steps.length}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 px-1.5 text-[10px] leading-snug text-[#5e7183]">
        Press Esc to leave a tour at any point.
      </p>
    </div>
  );
}

const HELP_BUTTON_CLASS =
  "pointer-events-auto flex h-9 w-9 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)] hover:brightness-110";

/**
 * The same help, as one scrolling sheet.
 *
 * The glance layer is built out of rings and arrows pointing at the toolbars it
 * describes; on a phone those toolbars are folded into single buttons, its cards
 * are wider than the screen, and there is no hover to open it with. So compact
 * windows get the content and drop the pointing: every card in a column, over a
 * full-screen sheet with one way out.
 */
function HelpSheet({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (lessonId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#101419] font-mono text-[#dbe3ec]">
      <div
        className="flex h-11 shrink-0 items-center justify-between px-3"
        style={{ borderBottom: `1px solid ${GLANCE_LINE}` }}
      >
        <span className="text-[12px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
          What everything does
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="flex h-9 w-9 items-center justify-center border text-[16px] text-[#aebccd]"
          style={{ borderColor: GLANCE_LINE }}
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <ToursCard onStart={onStart} />
        {CALLOUTS.map((callout) => (
          <GlanceCard key={callout.anchor} title={callout.title} rows={callout.rows} />
        ))}
        <GlanceCard title="Mouse and keys" rows={MOVES} />
      </div>
    </div>
  );
}

function HelpGlanceSheet({
  measured,
  onEnter,
  onLeave,
  onStart,
}: {
  measured: Measured;
  onEnter: () => void;
  onLeave: () => void;
  onStart: (lessonId: string) => void;
}) {
  const { rects, button, vw, vh } = measured;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120] font-mono"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="absolute inset-0 bg-black/60" />
      {CALLOUTS.map((callout) => {
        const rect = rects[callout.anchor];
        if (!rect) {
          return null;
        }
        return (
          <Fragment key={callout.anchor}>
            <div
              className="absolute border border-dashed"
              style={{
                borderColor: ACCENT_DIM,
                left: rect.left - RING_PAD,
                top: rect.top - RING_PAD,
                width: rect.right - rect.left + RING_PAD * 2,
                height: rect.bottom - rect.top + RING_PAD * 2,
              }}
            />
            <div className="absolute" style={calloutStyle(callout, rect, vw, vh)}>
              <div className="relative">
                <CalloutArrow
                  side={callout.side}
                  align={callout.align}
                  length={CALLOUT_GAP + (callout.offset ?? 0)}
                />
                <GlanceCard title={callout.title} rows={callout.rows} />
              </div>
            </div>
          </Fragment>
        );
      })}
      {button ? (
        <Fragment>
          {/* A lit stand-in over the real (now dimmed) button, so the corner
              the sheet grew from stays readable. Hover still lands on the
              real button underneath. */}
          <div
            className="absolute flex items-center justify-center border-2 bg-[var(--mc-49)] font-mono text-[16px] font-black text-white shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-25)]"
            style={{
              borderColor: ACCENT,
              left: button.left,
              top: button.top,
              width: button.right - button.left,
              height: button.bottom - button.top,
            }}
          >
            ?
          </div>
          {/* Stacked over the button: the moves you cannot see, then the tours
              you can press, nearest to the hand that opened this. */}
          <div
            className="absolute flex w-[360px] flex-col gap-2"
            style={{ left: button.left, bottom: vh - button.top + 10 }}
          >
            <GlanceCard title="Mouse and keys" rows={MOVES} />
            <ToursCard onStart={onStart} />
          </div>
        </Fragment>
      ) : null}
    </div>
  );
}

export const BoardHelp = memo(function BoardHelp({ compact }: { compact: boolean }) {
  const [measured, setMeasured] = useState<Measured | undefined>(undefined);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    const buttonRect = buttonRef.current?.getBoundingClientRect();
    setMeasured({
      rects: measureAnchors(),
      button: buttonRect ? toHelpRect(buttonRect) : undefined,
      vw: window.innerWidth,
      vh: window.innerHeight,
    });
  }, []);
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setMeasured(undefined), HIDE_GRACE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  // Starting a tour takes the sheet down with it: the tour is about to dim the
  // same screen and ring things on it, and two glance layers at once is one too
  // many. It also cannot be hovered away, since the tour blocks the pointer.
  const startTour = useCallback((lessonId: string) => {
    window.clearTimeout(hideTimerRef.current);
    setMeasured(undefined);
    setSheetOpen(false);
    startLesson(lessonId);
  }, []);

  if (compact) {
    return (
      <div className="absolute bottom-3 left-3 z-30">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          data-tour-anchor="help"
          className={HELP_BUTTON_CLASS}
          title="Board help"
          aria-label="Show board help"
        >
          ?
        </button>
        {isSheetOpen && typeof document !== "undefined"
          ? createPortal(
              <HelpSheet onClose={() => setSheetOpen(false)} onStart={startTour} />,
              document.body,
            )
          : null}
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-3 left-3 z-30"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      <button
        ref={buttonRef}
        type="button"
        onFocus={show}
        onBlur={scheduleHide}
        data-tour-anchor="help"
        className={HELP_BUTTON_CLASS}
        title="Board help"
        aria-label="Show board help"
      >
        ?
      </button>
      {measured
        ? createPortal(
            <HelpGlanceSheet
              measured={measured}
              onEnter={show}
              onLeave={scheduleHide}
              onStart={startTour}
            />,
            document.body,
          )
        : null}
    </div>
  );
});
