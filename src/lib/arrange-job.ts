/**
 * The arrange JOB: what an arrange is when it leaves the main thread, and
 * how it runs. Pure and worker-safe, and in its own file because it is
 * everything `arrange.worker.ts` needs: it must not import
 * `arrange-solve.ts`, which SPAWNS the worker (a worker bundle that reaches
 * back into its spawner references itself and hangs Turbopack's production
 * build - see grid-route-job.ts).
 *
 * The host cannot hand a worker its judge function, so it hands the
 * judge's INPUTS - the board's route requests, obstacles and tuning - and
 * the job builds the judge here (`makeRouteJudge`).
 */

import {
  arrangeBoard,
  arrangeColumnStage,
  arrangeFreeStage,
  arrangePolishStage,
  type ArrangeCandidates,
  type ArrangeInput,
  type ArrangeResult,
} from "./board-arrange";
import { makeRouteJudge } from "./route-judge";
import type { GridObstacle, GridRouteRequest } from "@/components/flow/grid-edge-router";
import type { RouterTuning } from "@/components/flow/router-tuning";

export interface ArrangeJudgeInput {
  obstacles: GridObstacle[];
  requests: GridRouteRequest[];
  tuning: RouterTuning;
  /** Obstacles that move with an arranged card (route-judge.ts): the cards inside a kept group. */
  riders?: Array<[string, string]>;
}

export interface ArrangeJob {
  /** Monotonic; a result for an older job than the last asked is dropped. */
  seq: number;
  cards: ArrangeInput["cards"];
  wires: ArrangeInput["wires"];
  taste?: ArrangeInput["taste"];
  origin?: ArrangeInput["origin"];
  judgeInput?: ArrangeJudgeInput;
  /**
   * Which part of the arrange this job is, when the host runs the parts on
   * several threads at once: the column candidates, the free placement, or
   * one polish of the ranked candidates. Absent: the whole arrange.
   */
  stage?: "columns" | "free" | "polish";
  /** For the polish stage: the three candidates, and which of the best two to polish. */
  candidates?: ArrangeCandidates;
  which?: 0 | 1;
}

/**
 * The steps of an arrange, in order, as the loader lists them. A progress
 * message names its step; the loader fills one bar across all of them, each
 * step taking an equal share.
 */
export const ARRANGE_STEPS = [
  { key: "layout", label: "Laying the board out" },
  { key: "search", label: "Searching for a better layout" },
  { key: "route", label: "Routing the candidates" },
  { key: "polishFirst", label: "Polishing the first layout" },
  { key: "polishSecond", label: "Polishing the second layout" },
  { key: "choose", label: "Choosing the better board" },
] as const;

/** Where the arrange is, for the loader: a step, and how far along it. */
export interface ArrangeProgress {
  seq: number;
  /** Index into ARRANGE_STEPS. */
  step: number;
  stage: string;
  done: number;
  total: number;
}

export interface ArrangeJobResult {
  seq: number;
  result: ArrangeResult;
  arrangeMs: number;
  /** A stage job's own answer (the `result` above is then its main board). */
  columns?: { plain: ArrangeResult; challenger: ArrangeResult };
  polishedPoints?: number;
  polishedCrossings?: number;
}

/** Runs the job right here; the worker and the fallback both call this. */
export function runArrangeJob(
  job: ArrangeJob,
  onProgress?: (progress: ArrangeProgress) => void,
): ArrangeJobResult {
  const started = performance.now();
  const judge = job.judgeInput
    ? makeRouteJudge(job.judgeInput.obstacles, job.judgeInput.requests, job.judgeInput.tuning, job.judgeInput.riders)
    : undefined;
  const input: ArrangeInput = {
    cards: job.cards,
    wires: job.wires,
    taste: job.taste,
    origin: job.origin,
    judge,
    tuning: job.judgeInput?.tuning,
    onProgress: onProgress
      ? (progress) => onProgress({ seq: job.seq, ...progress })
      : undefined,
  };
  if (job.stage === "columns") {
    const columns = arrangeColumnStage(input);
    return { seq: job.seq, result: columns.plain, columns, arrangeMs: performance.now() - started };
  }
  if (job.stage === "free") {
    const result = arrangeFreeStage(input);
    return { seq: job.seq, result, arrangeMs: performance.now() - started };
  }
  if (job.stage === "polish" && job.candidates) {
    const polished = arrangePolishStage(input, job.candidates, job.which ?? 0);
    return {
      seq: job.seq,
      result: polished.result,
      polishedPoints: polished.points,
      polishedCrossings: polished.crossings,
      arrangeMs: performance.now() - started,
    };
  }
  const result = arrangeBoard(input);
  return { seq: job.seq, result, arrangeMs: performance.now() - started };
}
