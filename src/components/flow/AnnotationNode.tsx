"use client";

import {
  NodeResizer,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Ban, ImageOff, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type {
  FactoryAnnotation,
  FactoryAnnotationBorderStyle,
  FactoryAnnotationMarks,
  FactoryAnnotationStyle,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS, GT_NODE_COLOR_PALETTE, inkFor } from "./node-colors";
import { CameraNodeToolbar } from "./scroll-camera";
import {
  CANVAS_THEMES,
  getCanvasTheme,
  GRAIN_DARK_URI,
  GRAIN_LIGHT_URI,
  GRAIN_TILE,
  type CanvasTheme,
} from "./canvas-themes";
import {
  ANNOTATION_MIN_ARROW,
  ANNOTATION_MIN_BOX,
  ANNOTATION_MIN_TEXT,
  BOARD_GRID,
} from "@/lib/board-grid";

export interface AnnotationNodeData extends Record<string, unknown> {
  annotation: FactoryAnnotation;
}

export type AnnotationFlowNode = Node<AnnotationNodeData, "annotationNode">;

const DEFAULT_ANNOTATION_COLOR = "yellow" as const;

/**
 * Box and arrow annotations set `pointerEvents: none` on their node wrapper so
 * the empty interior stays click-through (a box drawn around machines must not
 * swallow their clicks). Only elements carrying this class stay interactive,
 * and the same selector doubles as the React Flow `dragHandle`.
 */
export const ANNOTATION_DRAG_HANDLE_CLASS = "annotation-drag-handle";

/** Text notes: 14px matches the old fixed `text-sm`, so existing notes look identical. */
const DEFAULT_ANNOTATION_FONT_SIZE = 14;
const MIN_ANNOTATION_FONT_SIZE = 8;
const MAX_ANNOTATION_FONT_SIZE = 96;
const ANNOTATION_FONT_STEP = 2;

function clampFontSize(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN_ANNOTATION_FONT_SIZE), MAX_ANNOTATION_FONT_SIZE);
}

const ANNOTATION_STEP_BUTTON_CLASS =
  "flex h-5 w-5 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)] disabled:cursor-not-allowed disabled:opacity-40";

type AnnotationSurface = "tint" | "solid" | "none";

/**
 * The resolved dressing of a box/zone/image, in three independent choices:
 * how strong the surface is (tint/solid/none), what colours it (a dye swatch
 * or a textured canvas paper), and which marks ride over it (dots, grids,
 * rules, hatch). Legacy single-field styles collapse here: a mark spelled in
 * `fill` means a tinted surface wearing that mark, `paper` means solid.
 */
interface AnnotationLook {
  border: FactoryAnnotationBorderStyle;
  borderSwatch: string;
  surface: AnnotationSurface;
  fillSwatch: string;
  /** Set = the surface is this textured paper rather than the dye. */
  fillTheme?: CanvasTheme;
  marks: FactoryAnnotationMarks;
  /** What the marks are inked in: the paper's own ink, or the dye. */
  markInk: string;
}

const LEGACY_MARK_FILLS = new Set<FactoryAnnotationMarks>([
  "dots",
  "grid",
  "graph",
  "ruled",
  "hatch",
]);

function annotationLook(annotation: FactoryAnnotation): AnnotationLook {
  const style = annotation.style;
  const baseTag = annotation.colorTag ?? DEFAULT_ANNOTATION_COLOR;
  const rawFill = style?.fill;
  const surface: AnnotationSurface =
    rawFill === "none" || rawFill === "solid" ? rawFill : rawFill === "paper" ? "solid" : "tint";
  const marks: FactoryAnnotationMarks =
    style?.marks ??
    (rawFill && LEGACY_MARK_FILLS.has(rawFill as FactoryAnnotationMarks)
      ? (rawFill as FactoryAnnotationMarks)
      : "none");
  const fillTheme = style?.fillTheme ? getCanvasTheme(style.fillTheme) : undefined;
  const fillSwatch = GT_NODE_COLORS[style?.fillColor ?? baseTag].swatch;
  return {
    border: style?.border ?? "solid",
    borderSwatch: GT_NODE_COLORS[style?.borderColor ?? baseTag].swatch,
    surface,
    fillSwatch,
    fillTheme,
    marks,
    markInk: fillTheme ? fillTheme.patternColor : fillSwatch,
  };
}

/** The grain a paper surface wears: dark ink on a light base, light on dark. */
function grainFor(base: string): string {
  return inkFor(base).ink === "#f2f3f7" ? GRAIN_LIGHT_URI : GRAIN_DARK_URI;
}

/**
 * The surface layer's CSS: the dye at the chosen strength, or the textured
 * paper (tinted papers use element opacity, since their texture layers carry
 * their own baked alphas). Ordinary CSS pixels inside the zoomed viewport, so
 * the surface rides the board exactly as the shape does.
 */
function surfaceStyle(look: AnnotationLook): {
  backgroundColor?: string;
  backgroundImage?: string;
  opacity?: number;
} {
  if (look.surface === "none") {
    return {};
  }
  if (look.fillTheme) {
    return {
      backgroundColor: look.fillTheme.base,
      backgroundImage: look.fillTheme.texture,
      opacity: look.surface === "tint" ? 0.55 : 1,
    };
  }
  return {
    backgroundColor: look.surface === "tint" ? `${look.fillSwatch}14` : look.fillSwatch,
  };
}

/**
 * The marks layer's CSS, inked in `ink`. `unit` is the mark period: the board
 * cell for real shapes, a few px for the panel's little preview chips.
 */
function marksStyle(
  marks: FactoryAnnotationMarks,
  ink: string,
  unit: number = BOARD_GRID,
): { backgroundImage?: string; backgroundSize?: string } {
  switch (marks) {
    case "dots":
      return {
        backgroundImage: `radial-gradient(${ink}59 ${Math.max(1, unit * 0.08)}px, transparent ${Math.max(1, unit * 0.08)}px)`,
        backgroundSize: `${unit}px ${unit}px`,
      };
    case "hatch":
      return {
        backgroundImage: `repeating-linear-gradient(45deg, ${ink}38 0 ${unit * 0.3}px, transparent ${unit * 0.3}px ${unit * 0.9}px)`,
      };
    case "grid":
      return {
        backgroundImage: `repeating-linear-gradient(0deg, ${ink}2e 0 1px, transparent 1px ${unit}px), repeating-linear-gradient(90deg, ${ink}2e 0 1px, transparent 1px ${unit}px)`,
      };
    case "graph":
      return {
        backgroundImage: [
          `repeating-linear-gradient(0deg, ${ink}59 0 1px, transparent 1px ${unit * 5}px)`,
          `repeating-linear-gradient(90deg, ${ink}59 0 1px, transparent 1px ${unit * 5}px)`,
          `repeating-linear-gradient(0deg, ${ink}24 0 1px, transparent 1px ${unit}px)`,
          `repeating-linear-gradient(90deg, ${ink}24 0 1px, transparent 1px ${unit}px)`,
        ].join(", "),
      };
    case "ruled":
      return {
        backgroundImage: `repeating-linear-gradient(180deg, transparent 0 ${unit * 2 - 1}px, ${ink}45 ${unit * 2 - 1}px ${unit * 2}px)`,
      };
    default:
      return {};
  }
}

function AnnotationNodeComponent({ data, selected, width, height }: NodeProps<AnnotationFlowNode>) {
  const { annotation } = data;
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const color = GT_NODE_COLORS[annotation.colorTag ?? DEFAULT_ANNOTATION_COLOR];
  const nodeWidth = width ?? annotation.size.width;
  const nodeHeight = height ?? annotation.size.height;

  const resizer = (
    <NodeResizer
      isVisible={selected}
      minWidth={annotation.kind === "text" ? ANNOTATION_MIN_TEXT.width : ANNOTATION_MIN_BOX}
      minHeight={annotation.kind === "text" ? ANNOTATION_MIN_TEXT.height : ANNOTATION_MIN_ARROW}
      // A picture keeps its proportions under a corner drag; boxes are free.
      keepAspectRatio={annotation.kind === "image"}
      // A box's edges belong to its MOVE strips (which are fat and overlap the
      // resize lines); giving both a claim to the same pixels made each a
      // coin-toss. Corners resize, edges move. A note has no strips, so its
      // edges keep resizing.
      lineStyle={{
        pointerEvents: annotation.kind === "box" ? "none" : "all",
        borderColor: "#22d3ee",
      }}
      handleStyle={{
        pointerEvents: "all",
        width: 16,
        height: 16,
        borderRadius: 0,
        backgroundColor: "#22d3ee",
        border: "1px solid #0e7490",
        // Above the shape and its move strips: the corner grabbers sat half
        // hidden behind the box frame, which read as "less important" when
        // they are the whole resize story.
        zIndex: 10,
      }}
      // The store rounds both the corner and the size to whole cells, so a
      // freehand resize still lands on the grid the moment you let go.
      onResizeEnd={(_, params) =>
        updateAnnotation(annotation.id, {
          position: { x: params.x, y: params.y },
          size: { width: params.width, height: params.height },
        })
      }
    />
  );

  if (annotation.kind === "arrow") {
    // No resize box: an arrow is two ends and a line, so editing it is
    // dragging an end, not working out which side of a rectangle to pull.
    return (
      <ArrowAnnotation
        annotation={annotation}
        width={nodeWidth}
        height={nodeHeight}
        swatch={color.swatch}
        selected={selected ?? false}
      />
    );
  }

  if (annotation.kind === "zone") {
    // Like the arrow: the outline's own corners are the editor, no resize box.
    return (
      <>
        <ZoneAnnotation
          annotation={annotation}
          width={nodeWidth}
          height={nodeHeight}
          look={annotationLook(annotation)}
          selected={selected ?? false}
        />
        <AnnotationStylePanel annotation={annotation} selected={selected ?? false} />
      </>
    );
  }

  if (annotation.kind === "text") {
    return (
      <>
        {resizer}
        <TextShape annotation={annotation} color={color} />
      </>
    );
  }

  if (annotation.kind === "image") {
    return (
      <>
        {resizer}
        <ImageShape annotation={annotation} look={annotationLook(annotation)} />
        <AnnotationStylePanel annotation={annotation} selected={selected ?? false} />
      </>
    );
  }

  return (
    <>
      {resizer}
      <BoxShape look={annotationLook(annotation)} />
      <AnnotationStylePanel annotation={annotation} selected={selected ?? false} />
    </>
  );
}

function BoxShape({ look }: { look: AnnotationLook }) {
  // The visible frame is inert; four invisible strips along the edges are what
  // take clicks and drags, so the interior stays fully click-through. 24px
  // deep (12 out, 12 in): grabbing "roughly the frame" has to count.
  const stripBase = `${ANNOTATION_DRAG_HANDLE_CLASS} absolute`;
  const hasBorder = look.border !== "none";
  return (
    <div className="h-full w-full" style={{ pointerEvents: "none" }}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          ...(hasBorder ? { border: `4px ${look.border} ${look.borderSwatch}` } : undefined),
          ...(hasBorder
            ? { boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.35)` }
            : undefined),
        }}
      >
        {/* The surface, then the marks over it: two layers because a tinted
            PAPER dims through element opacity (its texture carries baked
            alphas that per-layer colour can't scale), and marks must not
            dim with it. */}
        {look.surface !== "none" ? (
          <div className="absolute inset-0" style={surfaceStyle(look)} />
        ) : null}
        {look.marks !== "none" ? (
          <div className="absolute inset-0" style={marksStyle(look.marks, look.markInk)} />
        ) : null}
      </div>
      {/* Inset from the ends: the corners belong to the resize grabbers. */}
      <div className={`${stripBase} -top-3 left-4 right-4 h-6 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -bottom-3 left-4 right-4 h-6 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -left-3 bottom-4 top-4 w-6 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -right-3 bottom-4 top-4 w-6 cursor-grab`} style={{ pointerEvents: "all" }} />
    </div>
  );
}

/**
 * A picture on the board. The whole face is the drag handle - an image is
 * content, not a frame around other things, so grabbing anywhere moves it -
 * and the style panel offers the same border dressing a box has.
 */
function ImageShape({ annotation, look }: { annotation: FactoryAnnotation; look: AnnotationLook }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="h-full w-full" style={{ pointerEvents: "none" }}>
      <div
        className={`${ANNOTATION_DRAG_HANDLE_CLASS} absolute inset-0 cursor-grab overflow-hidden`}
        style={{
          pointerEvents: "all",
          ...(look.border !== "none"
            ? { border: `4px ${look.border} ${look.borderSwatch}` }
            : undefined),
        }}
      >
        {annotation.imageUrl && !failed ? (
          // crossOrigin so the PNG/SVG exporter is allowed to read the pixels
          // back off the canvas; the image bucket serves open CORS.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={annotation.imageUrl}
            alt={annotation.text ?? "Board image"}
            crossOrigin="anonymous"
            draggable={false}
            className="h-full w-full select-none"
            style={{ objectFit: "fill" }}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center gap-2 bg-[var(--mc-49)] text-[var(--mc-ink)]">
            <ImageOff className="h-5 w-5 opacity-60" />
            <span className="text-xs opacity-60">image unavailable</span>
          </div>
        )}
      </div>
    </div>
  );
}

type ArrowPoint = { x: number; y: number };

/** Click-to-cycle orders for the two style chips. */
const BORDER_OPTIONS: FactoryAnnotationBorderStyle[] = ["solid", "dashed", "none"];
const SURFACE_OPTIONS: AnnotationSurface[] = ["tint", "solid", "none"];
const SURFACE_WORD: Record<AnnotationSurface, string> = {
  tint: "tinted",
  solid: "solid",
  none: "off",
};
const MARKS_OPTIONS: FactoryAnnotationMarks[] = [
  "none",
  "dots",
  "grid",
  "graph",
  "ruled",
  "hatch",
];
const MARKS_WORD: Record<FactoryAnnotationMarks, string> = {
  none: "off",
  dots: "dots",
  grid: "grid",
  graph: "graph paper",
  ruled: "ruled lines",
  hatch: "hatch",
};

const STYLE_CHIP_CLASS =
  "flex h-7 w-7 items-center justify-center border-2 border-[var(--mc-15)] bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]";

/** An option row's button: same chip, ringed when it is the current value. */
function optionChipClass(active: boolean): string {
  return [
    "flex h-7 w-7 items-center justify-center border-2 bg-[var(--mc-49)] text-white shadow-[inset_1px_1px_0_var(--mc-85),inset_-1px_-1px_0_var(--mc-25)] hover:bg-[var(--mc-61)]",
    active ? "border-white ring-2 ring-cyan-300" : "border-[var(--mc-15)]",
  ].join(" ");
}

/**
 * The little settings cluster a selected box/zone/image wears at its top
 * left. Three independent choices for the interior - how STRONG the surface
 * is (tint/solid/off), what COLOURS it (any dye, or one of the board's
 * textured papers, both in the fill colour menu), and which MARKS ride over
 * it (dots, grids, rules, hatch) - plus the border pair. Every chip PREVIEWS
 * its current setting and opens a menu of ALL its options underneath, each
 * option previewed the same way; nothing cycles blind. Rendered through
 * NodeToolbar so it sits in screen space and never scales with the zoom.
 */
type StylePanelMenu = "border" | "borderColor" | "surface" | "fillColor" | "marks";

function AnnotationStylePanel({
  annotation,
  selected,
}: {
  annotation: FactoryAnnotation;
  selected: boolean;
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const deleteAnnotation = useFactoryStore((state) => state.deleteAnnotation);
  const [openMenu, setOpenMenu] = useState<StylePanelMenu | undefined>(undefined);
  useEffect(() => {
    if (!selected) {
      setOpenMenu(undefined);
    }
  }, [selected]);
  const toggleMenu = (menu: StylePanelMenu) =>
    setOpenMenu((current) => (current === menu ? undefined : menu));

  const look = annotationLook(annotation);
  // A picture is opaque: it has a border to dress and nothing for a fill to do.
  const hasFill = annotation.kind !== "image";
  const commitStyle = (patch: Partial<FactoryAnnotationStyle>) => {
    updateAnnotation(annotation.id, {
      style: {
        ...annotation.style,
        // Canonical spellings for the split dimensions, so a legacy
        // single-field style cannot lose its implied mark or strength when
        // one dimension changes.
        fill: look.surface,
        marks: look.marks,
        ...patch,
      },
    });
  };
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <CameraNodeToolbar
      isVisible={selected}
      position={Position.Top}
      align="start"
      // INSIDE the shape's top left, not above it: a panel above the box sat
      // on the top edge's move strip and resize knobs. Position Top pins the
      // toolbar's BOTTOM edge, so the negative offset reaches 48px into the
      // shape and the chip row's place never changes - the menus below are
      // an absolute overlay that grows DOWNWARD without moving a single
      // button you are about to click.
      offset={-48}
      // The toolbar portal carries no z of its own, and this node sits at -5
      // (a backdrop), so without a lift the PANE hit-tests above the panel
      // and eats every click. 30: over the board and its z-20 toolbars,
      // under the z-40 palettes.
      style={{ zIndex: 30 }}
    >
      <div
        // ui-zoom: the toolbar portal lives inside .react-flow, which is unzoomed.
        className="ui-zoom nodrag nopan nowheel relative ml-2 border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]"
        onPointerDown={stop}
        onDoubleClick={stop}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleMenu("border")}
            className={[
              STYLE_CHIP_CLASS,
              openMenu === "border" ? "bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100)]" : "",
            ].join(" ")}
            title={`Border style: ${look.border}`}
            aria-label={`Border style: ${look.border}`}
            aria-expanded={openMenu === "border"}
          >
            {look.border === "none" ? (
              <Ban className="h-3.5 w-3.5 opacity-60" />
            ) : (
              <span
                aria-hidden
                className="h-4 w-4"
                style={{ border: `2px ${look.border} ${look.borderSwatch}` }}
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleMenu("borderColor")}
            className={[
              STYLE_CHIP_CLASS,
              openMenu === "borderColor"
                ? "bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                : "",
            ].join(" ")}
            title="Border colour"
            aria-label="Border colour"
            aria-expanded={openMenu === "borderColor"}
          >
            <span
              aria-hidden
              className="h-4 w-4 border border-black/40"
              style={{ backgroundColor: look.borderSwatch }}
            />
          </button>
          {hasFill ? (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-[2px] bg-[var(--mc-33)]" />
              <button
                type="button"
                onClick={() => toggleMenu("surface")}
                className={[
                  STYLE_CHIP_CLASS,
                  openMenu === "surface"
                    ? "bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                    : "",
                ].join(" ")}
                title={`Fill: ${SURFACE_WORD[look.surface]}`}
                aria-label={`Fill: ${SURFACE_WORD[look.surface]}`}
                aria-expanded={openMenu === "surface"}
              >
                {look.surface === "none" ? (
                  <Ban className="h-3.5 w-3.5 opacity-60" />
                ) : (
                  <span
                    aria-hidden
                    className="h-4 w-4 border border-black/40"
                    style={surfaceStyle(look)}
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() => toggleMenu("fillColor")}
                className={[
                  STYLE_CHIP_CLASS,
                  openMenu === "fillColor"
                    ? "bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                    : "",
                ].join(" ")}
                title="Fill colour"
                aria-label="Fill colour"
                aria-expanded={openMenu === "fillColor"}
              >
                <span
                  aria-hidden
                  className="h-4 w-4 border border-black/40"
                  style={
                    look.fillTheme
                      ? {
                          backgroundColor: look.fillTheme.base,
                          backgroundImage: look.fillTheme.texture,
                        }
                      : { backgroundColor: look.fillSwatch }
                  }
                />
              </button>
              <button
                type="button"
                onClick={() => toggleMenu("marks")}
                className={[
                  STYLE_CHIP_CLASS,
                  openMenu === "marks"
                    ? "bg-[var(--mc-85)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                    : "",
                ].join(" ")}
                title={`Marks: ${MARKS_WORD[look.marks]}`}
                aria-label={`Marks: ${MARKS_WORD[look.marks]}`}
                aria-expanded={openMenu === "marks"}
              >
                {look.marks === "none" ? (
                  <Ban className="h-3.5 w-3.5 opacity-60" />
                ) : (
                  <span
                    aria-hidden
                    className="h-4 w-4 border border-black/40"
                    style={marksStyle(look.marks, look.markInk, 8)}
                  />
                )}
              </button>
            </>
          ) : null}
          {annotation.kind === "image" ? (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-[2px] bg-[var(--mc-33)]" />
              <button
                type="button"
                onClick={() => deleteAnnotation(annotation.id)}
                className={STYLE_CHIP_CLASS}
                title="Delete image"
                aria-label="Delete this image"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
              </button>
            </>
          ) : null}
        </div>
        {/* The open menu hangs below the chip row as an absolute overlay on
            its own plate: the row above it never moves, and the options run
            downward into the shape. */}
        {openMenu ? (
          <div
            className="absolute left-0 top-[calc(100%+4px)] w-max border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]"
          >
        {openMenu === "border" ? (
          <div className="flex gap-1">
            {BORDER_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => commitStyle({ border: value })}
                className={optionChipClass(look.border === value)}
                title={value}
                aria-label={`Use ${value === "none" ? "no" : value} border`}
              >
                {value === "none" ? (
                  <Ban className="h-3.5 w-3.5 opacity-60" />
                ) : (
                  <span
                    aria-hidden
                    className="h-4 w-4"
                    style={{ border: `2px ${value} ${look.borderSwatch}` }}
                  />
                )}
              </button>
            ))}
          </div>
        ) : null}
        {openMenu === "surface" ? (
          <div className="flex gap-1">
            {SURFACE_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => commitStyle({ fill: value })}
                className={optionChipClass(look.surface === value)}
                title={SURFACE_WORD[value]}
                aria-label={`Use ${value === "none" ? "no" : SURFACE_WORD[value]} fill`}
              >
                {value === "none" ? (
                  <Ban className="h-3.5 w-3.5 opacity-60" />
                ) : (
                  <span
                    aria-hidden
                    className="h-4 w-4 border border-black/40"
                    style={surfaceStyle({ ...look, surface: value })}
                  />
                )}
              </button>
            ))}
          </div>
        ) : null}
        {openMenu === "marks" ? (
          <div className="flex gap-1">
            {MARKS_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => commitStyle({ marks: value })}
                className={optionChipClass(look.marks === value)}
                title={MARKS_WORD[value]}
                aria-label={value === "none" ? "Use no marks" : `Use ${MARKS_WORD[value]} marks`}
              >
                {value === "none" ? (
                  <Ban className="h-3.5 w-3.5 opacity-60" />
                ) : (
                  <span
                    aria-hidden
                    className="h-4 w-4 border border-black/40"
                    style={marksStyle(value, look.markInk, 8)}
                  />
                )}
              </button>
            ))}
          </div>
        ) : null}
        {openMenu === "borderColor" || openMenu === "fillColor" ? (
          <>
            <div className="grid grid-cols-8 gap-1">
              {GT_NODE_COLOR_PALETTE.map((entry) => (
                <button
                  key={entry.tag}
                  type="button"
                  onClick={() =>
                    commitStyle(
                      openMenu === "borderColor"
                        ? { borderColor: entry.tag }
                        : // A dye replaces a paper: the two are one choice.
                          { fillColor: entry.tag, fillTheme: undefined },
                    )
                  }
                  className={[
                    "h-6 w-6 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
                    (openMenu === "borderColor"
                      ? entry.color.swatch === look.borderSwatch
                      : !look.fillTheme && entry.color.swatch === look.fillSwatch)
                      ? "border-white ring-2 ring-cyan-300"
                      : "border-[var(--mc-15)]",
                  ].join(" ")}
                  style={{ backgroundColor: entry.color.swatch }}
                  title={entry.tag}
                  aria-label={`Use ${entry.tag} for the ${openMenu === "borderColor" ? "border" : "fill"}`}
                />
              ))}
            </div>
            {openMenu === "fillColor" ? (
              // The textured papers, on the same shelf as the dyes: a fill
              // colour is either one.
              <div className="mt-1 grid grid-cols-8 gap-1">
                {CANVAS_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => commitStyle({ fillTheme: theme.id })}
                    className={[
                      "h-6 w-6 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
                      look.fillTheme?.id === theme.id
                        ? "border-white ring-2 ring-cyan-300"
                        : "border-[var(--mc-15)]",
                    ].join(" ")}
                    style={{ backgroundColor: theme.base, backgroundImage: theme.texture }}
                    title={`${theme.name} paper`}
                    aria-label={`Use ${theme.name} paper for the fill`}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
          </div>
        ) : null}
      </div>
    </CameraNodeToolbar>
  );
}

/**
 * The zone with a grab point on every corner. Same contract as the arrow:
 * selecting it offers the corners themselves, a dragged corner redraws the
 * outline live, and the new bounding box and rebased points are committed
 * once on release (the store snaps them to the grid).
 */
function ZoneAnnotation({
  annotation,
  width,
  height,
  look,
  selected,
}: {
  annotation: FactoryAnnotation;
  width: number;
  height: number;
  look: AnnotationLook;
  selected: boolean;
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const { screenToFlowPosition } = useReactFlow();
  const [draftPoints, setDraftPoints] = useState<ArrowPoint[]>();
  const points = draftPoints ?? annotation.points ?? [];

  // Rebase onto the new bounding box, which may have moved or grown, and
  // commit: shared by dragging a corner and minting one on an edge.
  const commitPoints = (next: ArrowPoint[]) => {
    const minX = Math.min(...next.map((point) => point.x));
    const minY = Math.min(...next.map((point) => point.y));
    updateAnnotation(annotation.id, {
      position: {
        x: annotation.position.x + minX,
        y: annotation.position.y + minY,
      },
      size: {
        width: Math.max(Math.max(...next.map((point) => point.x)) - minX, BOARD_GRID),
        height: Math.max(Math.max(...next.map((point) => point.y)) - minY, BOARD_GRID),
      },
      points: next.map((point) => ({ x: point.x - minX, y: point.y - minY })),
    });
  };

  /**
   * Double-clicking the outline mints a corner right there: the click
   * projects onto the nearest edge, snaps to the grid, and slots into the
   * loop between that edge's ends - already selected, already grabbable.
   */
  const addCornerAt = (event: React.MouseEvent) => {
    const settled = annotation.points ?? [];
    if (settled.length < 3 || settled.length >= 64) {
      return;
    }

    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const local = { x: flow.x - annotation.position.x, y: flow.y - annotation.position.y };
    let bestIndex = 0;
    let bestPoint = local;
    let bestDistance = Infinity;
    for (let i = 0; i < settled.length; i += 1) {
      const projected = closestPointOnSegment(local, settled[i], settled[(i + 1) % settled.length]);
      const distance = Math.hypot(projected.x - local.x, projected.y - local.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
        bestPoint = projected;
      }
    }

    const minted = {
      x: Math.round(bestPoint.x / BOARD_GRID) * BOARD_GRID,
      y: Math.round(bestPoint.y / BOARD_GRID) * BOARD_GRID,
    };
    // Landing on either end of the edge would fold two corners into one.
    const edgeStart = settled[bestIndex];
    const edgeEnd = settled[(bestIndex + 1) % settled.length];
    if (
      (minted.x === edgeStart.x && minted.y === edgeStart.y) ||
      (minted.x === edgeEnd.x && minted.y === edgeEnd.y)
    ) {
      return;
    }

    commitPoints([...settled.slice(0, bestIndex + 1), minted, ...settled.slice(bestIndex + 1)]);
  };

  const beginCornerDrag =
    (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const settled = annotation.points ?? [];
      const localPoint = (client: { clientX: number; clientY: number }): ArrowPoint => {
        const flow = screenToFlowPosition({ x: client.clientX, y: client.clientY });
        return { x: flow.x - annotation.position.x, y: flow.y - annotation.position.y };
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const moving = localPoint(moveEvent);
        setDraftPoints(settled.map((point, i) => (i === index ? moving : point)));
      };
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setDraftPoints(undefined);

        const moving = localPoint(upEvent);
        commitPoints(
          settled.map((point, i) =>
            i === index
              ? {
                  x: Math.round(moving.x / BOARD_GRID) * BOARD_GRID,
                  y: Math.round(moving.y / BOARD_GRID) * BOARD_GRID,
                }
              : point,
          ),
        );
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  return (
    <>
      <ZoneShape
        zoneId={annotation.id}
        points={points}
        width={width}
        height={height}
        look={look}
        onOutlineDoubleClick={addCornerAt}
      />
      {selected
        ? points.map((point, index) => (
            <ArrowEndpointHandle
              key={index}
              point={point}
              label={`Drag corner ${index + 1} of the zone`}
              onPointerDown={beginCornerDrag(index)}
            />
          ))
        : null}
    </>
  );
}

function closestPointOnSegment(point: ArrowPoint, a: ArrowPoint, b: ArrowPoint): ArrowPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return a;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function ZoneShape({
  zoneId,
  points,
  width,
  height,
  look,
  onOutlineDoubleClick,
}: {
  zoneId: string;
  points: ArrowPoint[];
  width: number;
  height: number;
  look: AnnotationLook;
  /** Double-clicking the outline mints a corner there. */
  onOutlineDoubleClick?: (event: React.MouseEvent) => void;
}) {
  if (points.length < 3) {
    return null;
  }

  const outline = `${points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")} Z`;

  // Patterned surfaces and marks are SVG patterns, one pair per zone (ids
  // are global to the whole board's SVG soup, so the zone id keys them).
  const surfacePatternId = `zone-surface-${zoneId}`;
  const marksPatternId = `zone-marks-${zoneId}`;
  const surfaceFill =
    look.surface === "none"
      ? undefined
      : look.fillTheme
        ? `url(#${surfacePatternId})`
        : look.surface === "tint"
          ? `${look.fillSwatch}14`
          : look.fillSwatch;
  const hasBorder = look.border !== "none";
  const dashArray = look.border === "dashed" ? "14 10" : undefined;

  // Like the box: the interior is a wash and fully click-through; only the
  // outline itself (via the fat transparent stroke) takes the pointer.
  return (
    <svg
      className="h-full w-full overflow-visible"
      style={{ pointerEvents: "none" }}
      viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
      preserveAspectRatio="none"
    >
      {look.fillTheme && look.surface !== "none" ? (
        <ZoneSurfacePattern theme={look.fillTheme} patternId={surfacePatternId} />
      ) : null}
      {look.marks !== "none" ? (
        <ZoneMarksPattern marks={look.marks} ink={look.markInk} patternId={marksPatternId} />
      ) : null}
      {surfaceFill ? (
        <path
          d={outline}
          fill={surfaceFill}
          // Papers dim as a whole when tinted, exactly like the box layer.
          fillOpacity={look.fillTheme && look.surface === "tint" ? 0.55 : 1}
          stroke="none"
        />
      ) : null}
      {look.marks !== "none" ? (
        <path d={outline} fill={`url(#${marksPatternId})`} stroke="none" />
      ) : null}
      <path
        d={outline}
        fill="none"
        stroke={hasBorder ? "rgba(0,0,0,0.45)" : "none"}
        strokeWidth={7}
        strokeDasharray={dashArray}
        strokeLinejoin="round"
      />
      {hasBorder ? (
        <path
          d={outline}
          fill="none"
          stroke={look.borderSwatch}
          strokeWidth={4}
          strokeDasharray={dashArray}
          strokeLinejoin="round"
        />
      ) : null}
      <path
        d={outline}
        className={`${ANNOTATION_DRAG_HANDLE_CLASS} cursor-grab`}
        fill="none"
        stroke="transparent"
        strokeWidth={28}
        strokeLinejoin="round"
        style={{ pointerEvents: "stroke" }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOutlineDoubleClick?.(event);
        }}
      />
    </svg>
  );
}

/**
 * A textured paper as a zone's surface: base colour under the grain. The
 * paper's broad washes (vignettes, mottling) stay with the board themes; the
 * grain is what says "textured" at any patch size.
 */
function ZoneSurfacePattern({ theme, patternId }: { theme: CanvasTheme; patternId: string }) {
  return (
    <defs>
      <pattern id={patternId} width={GRAIN_TILE} height={GRAIN_TILE} patternUnits="userSpaceOnUse">
        <rect width={GRAIN_TILE} height={GRAIN_TILE} fill={theme.base} />
        <image href={grainFor(theme.base)} width={GRAIN_TILE} height={GRAIN_TILE} />
      </pattern>
    </defs>
  );
}

/**
 * The marks the box layer paints in CSS, rebuilt as SVG patterns because a
 * zone's interior is a path. Same recipes, same ink.
 */
function ZoneMarksPattern({
  marks,
  ink,
  patternId,
}: {
  marks: FactoryAnnotationMarks;
  ink: string;
  patternId: string;
}) {
  const cell = BOARD_GRID;
  switch (marks) {
    case "hatch":
      return (
        <defs>
          <pattern
            id={patternId}
            width={18}
            height={18}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={6} height={18} fill={`${ink}38`} />
          </pattern>
        </defs>
      );
    case "grid":
      return (
        <defs>
          <pattern id={patternId} width={cell} height={cell} patternUnits="userSpaceOnUse">
            <path
              d={`M ${cell} 0 L 0 0 0 ${cell}`}
              fill="none"
              stroke={`${ink}2e`}
              strokeWidth={1}
            />
          </pattern>
        </defs>
      );
    case "dots":
      return (
        <defs>
          <pattern id={patternId} width={cell} height={cell} patternUnits="userSpaceOnUse">
            <circle cx={cell / 2} cy={cell / 2} r={1.6} fill={`${ink}59`} />
          </pattern>
        </defs>
      );
    case "ruled":
      return (
        <defs>
          <pattern id={patternId} width={cell * 2} height={cell * 2} patternUnits="userSpaceOnUse">
            <line x1={0} y1={0.5} x2={cell * 2} y2={0.5} stroke={`${ink}45`} strokeWidth={1} />
          </pattern>
        </defs>
      );
    case "graph":
      return (
        <defs>
          <pattern id={patternId} width={cell * 5} height={cell * 5} patternUnits="userSpaceOnUse">
            {[1, 2, 3, 4].map((step) => (
              <g key={step}>
                <line
                  x1={step * cell}
                  y1={0}
                  x2={step * cell}
                  y2={cell * 5}
                  stroke={`${ink}24`}
                  strokeWidth={1}
                />
                <line
                  x1={0}
                  y1={step * cell}
                  x2={cell * 5}
                  y2={step * cell}
                  stroke={`${ink}24`}
                  strokeWidth={1}
                />
              </g>
            ))}
            <line x1={0.5} y1={0} x2={0.5} y2={cell * 5} stroke={`${ink}59`} strokeWidth={1} />
            <line x1={0} y1={0.5} x2={cell * 5} y2={0.5} stroke={`${ink}59`} strokeWidth={1} />
          </pattern>
        </defs>
      );
    default:
      return null;
  }
}

/** The arrow's two ends in node-local coordinates, from its direction. */
function arrowEndpoints(
  annotation: FactoryAnnotation,
  width: number,
  height: number,
): { from: ArrowPoint; to: ArrowPoint } {
  const direction = annotation.arrowDirection ?? "down-right";
  return {
    from: {
      x: direction.endsWith("left") ? width : 0,
      y: direction.startsWith("up") ? height : 0,
    },
    to: {
      x: direction.endsWith("left") ? 0 : width,
      y: direction.startsWith("up") ? 0 : height,
    },
  };
}

/**
 * The arrow with its two grab points. Selecting it offers the ends
 * themselves; dragging one redraws the line live from the other end, and the
 * new box, size and direction are committed once on release (the store snaps
 * them to the grid, same as a box resize).
 */
function ArrowAnnotation({
  annotation,
  width,
  height,
  swatch,
  selected,
}: {
  annotation: FactoryAnnotation;
  width: number;
  height: number;
  swatch: string;
  selected: boolean;
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const { screenToFlowPosition } = useReactFlow();
  const [draft, setDraft] = useState<{ from: ArrowPoint; to: ArrowPoint }>();
  const { from, to } = draft ?? arrowEndpoints(annotation, width, height);

  const beginEndpointDrag =
    (which: "from" | "to") => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const settled = arrowEndpoints(annotation, width, height);
      const fixedLocal = which === "from" ? settled.to : settled.from;
      const localPoint = (client: { clientX: number; clientY: number }): ArrowPoint => {
        const flow = screenToFlowPosition({ x: client.clientX, y: client.clientY });
        return { x: flow.x - annotation.position.x, y: flow.y - annotation.position.y };
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const moving = localPoint(moveEvent);
        setDraft(
          which === "from" ? { from: moving, to: fixedLocal } : { from: fixedLocal, to: moving },
        );
      };
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setDraft(undefined);

        const moving = localPoint(upEvent);
        const fromLocal = which === "from" ? moving : fixedLocal;
        const toLocal = which === "to" ? moving : fixedLocal;
        const base = annotation.position;
        const fromFlow = { x: base.x + fromLocal.x, y: base.y + fromLocal.y };
        const toFlow = { x: base.x + toLocal.x, y: base.y + toLocal.y };
        updateAnnotation(annotation.id, {
          position: {
            x: Math.min(fromFlow.x, toFlow.x),
            y: Math.min(fromFlow.y, toFlow.y),
          },
          size: {
            width: Math.max(Math.abs(toFlow.x - fromFlow.x), ANNOTATION_MIN_ARROW),
            height: Math.max(Math.abs(toFlow.y - fromFlow.y), ANNOTATION_MIN_ARROW),
          },
          arrowDirection: `${toFlow.y < fromFlow.y ? "up" : "down"}-${
            toFlow.x < fromFlow.x ? "left" : "right"
          }` as FactoryAnnotation["arrowDirection"],
        });
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  return (
    <>
      <ArrowShape from={from} to={to} width={width} height={height} swatch={swatch} />
      {selected ? (
        <>
          <ArrowEndpointHandle
            point={from}
            label="Drag the arrow's tail"
            onPointerDown={beginEndpointDrag("from")}
          />
          <ArrowEndpointHandle
            point={to}
            label="Drag the arrow's head"
            onPointerDown={beginEndpointDrag("to")}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Same cyan square the resize corners wear, sitting on the end it moves. The
 * visible square rides inside a 32px invisible halo, so "grab the end" works
 * for a thumb and a rough mouse, not only a pixel-perfect one.
 */
function ArrowEndpointHandle({
  point,
  label,
  onPointerDown,
}: {
  point: ArrowPoint;
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className="nodrag absolute z-10 flex h-8 w-8 cursor-crosshair items-center justify-center"
      style={{
        left: point.x - 16,
        top: point.y - 16,
        pointerEvents: "all",
        touchAction: "none",
      }}
    >
      <div
        aria-hidden
        className="h-4 w-4"
        style={{ backgroundColor: "#22d3ee", border: "1px solid #0e7490" }}
      />
    </div>
  );
}

function ArrowShape({
  from,
  to,
  width,
  height,
  swatch,
}: {
  from: ArrowPoint;
  to: ArrowPoint;
  width: number;
  height: number;
  swatch: string;
}) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = 18;
  const headSpread = 0.5;
  const headLeft = {
    x: to.x - headLength * Math.cos(angle - headSpread),
    y: to.y - headLength * Math.sin(angle - headSpread),
  };
  const headRight = {
    x: to.x - headLength * Math.cos(angle + headSpread),
    y: to.y - headLength * Math.sin(angle + headSpread),
  };
  const linePoints = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const headPoints = `M ${headLeft.x} ${headLeft.y} L ${to.x} ${to.y} L ${headRight.x} ${headRight.y}`;

  return (
    <svg
      className="h-full w-full overflow-visible"
      style={{ pointerEvents: "none" }}
      viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
      preserveAspectRatio="none"
    >
      <path
        d={linePoints}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={headPoints}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d={linePoints} stroke={swatch} strokeWidth={5} strokeLinecap="round" fill="none" />
      <path
        d={headPoints}
        stroke={swatch}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d={linePoints}
        className={`${ANNOTATION_DRAG_HANDLE_CLASS} cursor-grab`}
        stroke="transparent"
        strokeWidth={28}
        strokeLinecap="round"
        fill="none"
        style={{ pointerEvents: "stroke" }}
      />
    </svg>
  );
}

function TextShape({
  annotation,
  color,
}: {
  annotation: FactoryAnnotation;
  color: (typeof GT_NODE_COLORS)[keyof typeof GT_NODE_COLORS];
}) {
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const [isEditing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(annotation.text ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [isEditing]);

  const commit = () => {
    setEditing(false);
    if (draftText !== (annotation.text ?? "")) {
      updateAnnotation(annotation.id, { text: draftText });
    }
  };

  const fontSize = clampFontSize(annotation.fontSize ?? DEFAULT_ANNOTATION_FONT_SIZE);
  const stepFontSize = (delta: number) => {
    const next = clampFontSize(fontSize + delta);
    if (next !== fontSize) {
      updateAnnotation(annotation.id, { fontSize: next });
    }
  };

  return (
    <div
      // No outer offset shadow of its own any more: every node casts the
      // board-wide drop shadow now (globals.css), and a second one here read
      // as a double edge.
      className="group/text relative h-full w-full border-2 font-mono shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33)]"
      style={{
        // The paint reaches the face, not just the frame: a 20% wash of the
        // border's colour over the slab. Capped low so the ink stays readable
        // against every swatch - even pure white at 20% leaves the face dark
        // enough for light text.
        backgroundColor: "var(--mc-78)",
        backgroundImage: `linear-gradient(${color.swatch}33, ${color.swatch}33)`,
        borderColor: color.swatch,
        color: "var(--mc-ink)",
        fontSize,
        // Notes are set at any size from a caption to a section heading, so a
        // fixed line-height would either crush the big ones or air out the
        // small ones.
        lineHeight: 1.25,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setDraftText(annotation.text ?? "");
        setEditing(true);
      }}
      title={isEditing ? undefined : "Double-click to edit"}
    >
      {/* Size controls, top right, on hover only: a note is something you read,
          and two buttons parked on every note permanently would be furniture in
          the way of the text. They sit above the text layer so they stay
          clickable over long content. */}
      <div className="nodrag absolute -top-3 right-0 z-10 hidden gap-0.5 group-hover/text:flex">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepFontSize(-ANNOTATION_FONT_STEP);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={fontSize <= MIN_ANNOTATION_FONT_SIZE}
          className={ANNOTATION_STEP_BUTTON_CLASS}
          title="Smaller text"
          aria-label="Smaller text"
        >
          <span aria-hidden className="block h-[2px] w-[8px] bg-current" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            stepFontSize(ANNOTATION_FONT_STEP);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={fontSize >= MAX_ANNOTATION_FONT_SIZE}
          className={ANNOTATION_STEP_BUTTON_CLASS}
          title="Bigger text"
          aria-label="Bigger text"
        >
          <span aria-hidden className="relative block h-[8px] w-[8px]">
            <span className="absolute left-0 top-[3px] block h-[2px] w-[8px] bg-current" />
            <span className="absolute left-[3px] top-0 block h-[8px] w-[2px] bg-current" />
          </span>
        </button>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="nodrag nopan h-full w-full resize-none bg-transparent p-2 font-mono outline-none"
          style={{ fontSize, lineHeight: 1.25 }}
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setDraftText(annotation.text ?? "");
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="h-full w-full overflow-hidden whitespace-pre-wrap p-2">
          {annotation.text?.length ? annotation.text : "Double-click to edit"}
        </div>
      )}
    </div>
  );
}

// Position props change every drag frame; this component reads only `data`,
// `selected` and its size, so comparing exactly those keeps annotation bodies
// from re-rendering while their wrapper is translated (see RecipeNode).
export const AnnotationNode = memo(
  AnnotationNodeComponent,
  (previous, next) =>
    previous.data === next.data &&
    previous.selected === next.selected &&
    previous.width === next.width &&
    previous.height === next.height,
);
