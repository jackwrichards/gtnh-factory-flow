import { NextResponse } from "next/server";
import { z } from "zod";
import { solveDatasetGap } from "@/lib/server/gap-solve";
import { resourceIconAtlasRefSchema, resourceKindSchema } from "@/lib/model/schemas";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const plannerResourceSchema = z.object({
  kind: resourceKindSchema,
  id: z.string().min(1),
  displayName: z.string().optional(),
  iconPath: z.string().optional(),
  iconAtlas: resourceIconAtlasRefSchema.optional(),
  dominantColor: z.string().optional(),
  stockpileId: z.string().optional(),
});

const solveRequestSchema = z.object({
  target: plannerResourceSchema.extend({
    amountPerSecond: z.number().positive().finite(),
  }),
  supply: z.array(plannerResourceSchema).max(2000),
  existingOutputs: z
    .array(
      plannerResourceSchema.extend({
        nodeId: z.string().min(1),
        availablePerSecond: z.number().min(0).finite(),
      }),
    )
    .max(1000)
    .optional(),
  maxTier: z.string().optional(),
  options: z
    .object({
      planCount: z.number().int().min(1).max(5).optional(),
      beamWidth: z.number().int().min(1).max(8).optional(),
      maxDepth: z.number().int().min(1).max(16).optional(),
      maxSteps: z.number().int().min(1).max(60).optional(),
      allowedRecipeMaps: z.array(z.string().min(1)).max(800).optional(),
    })
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const parsed = solveRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid solve request.", issues: parsed.error.issues.slice(0, 5) },
        { status: 400 },
      );
    }

    // A solve can take a while on a cold index, so the response is a stream of
    // newline-delimited JSON: progress heartbeats while it runs, then one
    // final `result` (or `error`) line. The client narrates the heartbeats.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // The client hung up; the solve just finishes into the void.
          }
        };

        try {
          const result = await solveDatasetGap(
            versionId,
            {
              target: parsed.data.target,
              supply: parsed.data.supply,
              existingOutputs: parsed.data.existingOutputs,
              maxTier: parseTierFilter(parsed.data.maxTier),
              options: parsed.data.options,
            },
            (progress) => send({ type: "progress", progress }),
          );
          send({ type: "result", ...result });
        } catch (error) {
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Gap solve failed.",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by a client disconnect.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gap solve failed." },
      { status: 500 },
    );
  }
}

function parseTierFilter(value: string | undefined): "all" | Exclude<MachineTier, "DEMO"> {
  if (!value || value === "all") {
    return "all";
  }

  return GT_VOLTAGE_TIERS.some((entry) => entry.tier === value)
    ? (value as Exclude<MachineTier, "DEMO">)
    : "all";
}
