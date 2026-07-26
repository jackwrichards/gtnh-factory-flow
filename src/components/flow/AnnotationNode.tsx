"use client";

import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import type { FactoryAnnotation } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS } from "./node-colors";

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

function AnnotationNodeComponent({ data, selected, width, height }: NodeProps<AnnotationFlowNode>) {
  const { annotation } = data;
  const updateAnnotation = useFactoryStore((state) => state.updateAnnotation);
  const color = GT_NODE_COLORS[annotation.colorTag ?? DEFAULT_ANNOTATION_COLOR];
  const nodeWidth = width ?? annotation.size.width;
  const nodeHeight = height ?? annotation.size.height;

  const resizer = (
    <NodeResizer
      isVisible={selected}
      minWidth={annotation.kind === "text" ? 96 : 32}
      minHeight={annotation.kind === "text" ? 40 : 24}
      lineStyle={{ pointerEvents: "all", borderColor: "#22d3ee" }}
      handleStyle={{
        pointerEvents: "all",
        width: 10,
        height: 10,
        borderRadius: 0,
        backgroundColor: "#22d3ee",
        border: "1px solid #0e7490",
      }}
      onResizeEnd={(_, params) =>
        updateAnnotation(annotation.id, {
          position: { x: params.x, y: params.y },
          size: { width: params.width, height: params.height },
        })
      }
    />
  );

  if (annotation.kind === "arrow") {
    return (
      <>
        {resizer}
        <ArrowShape
          annotation={annotation}
          width={nodeWidth}
          height={nodeHeight}
          swatch={color.swatch}
        />
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

  return (
    <>
      {resizer}
      <BoxShape swatch={color.swatch} />
    </>
  );
}

function BoxShape({ swatch }: { swatch: string }) {
  // The visible frame is inert; four invisible strips along the edges are what
  // take clicks and drags, so the interior stays fully click-through.
  const stripBase = `${ANNOTATION_DRAG_HANDLE_CLASS} absolute`;
  return (
    <div className="h-full w-full" style={{ pointerEvents: "none" }}>
      <div
        className="pointer-events-none absolute inset-0 border-4"
        style={{
          borderColor: swatch,
          backgroundColor: `${swatch}14`,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.35)`,
        }}
      />
      <div className={`${stripBase} -top-2 left-0 right-0 h-4 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -bottom-2 left-0 right-0 h-4 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -left-2 bottom-0 top-0 w-4 cursor-grab`} style={{ pointerEvents: "all" }} />
      <div className={`${stripBase} -right-2 bottom-0 top-0 w-4 cursor-grab`} style={{ pointerEvents: "all" }} />
    </div>
  );
}

function ArrowShape({
  annotation,
  width,
  height,
  swatch,
}: {
  annotation: FactoryAnnotation;
  width: number;
  height: number;
  swatch: string;
}) {
  const direction = annotation.arrowDirection ?? "down-right";
  const from = {
    x: direction.endsWith("left") ? width : 0,
    y: direction.startsWith("up") ? height : 0,
  };
  const to = {
    x: direction.endsWith("left") ? 0 : width,
    y: direction.startsWith("up") ? 0 : height,
  };
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
        strokeWidth={18}
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

  return (
    <div
      className="h-full w-full border-2 font-mono text-sm shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),3px_3px_0_rgba(0,0,0,0.25)]"
      style={{
        backgroundColor: "var(--mc-78)",
        borderColor: color.swatch,
        color: "var(--mc-ink)",
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setDraftText(annotation.text ?? "");
        setEditing(true);
      }}
      title={isEditing ? undefined : "Double-click to edit"}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="nodrag nopan h-full w-full resize-none bg-transparent p-2 font-mono text-sm outline-none"
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

export const AnnotationNode = memo(AnnotationNodeComponent);
