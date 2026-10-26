/**
 * The arrange, off the main thread.
 *
 * A judged arrange is dozens of route solves, easily tens of seconds on a
 * busy board, so the job runs in workers (`arrange.worker.ts`) that
 * report progress. One arrange at a time; the caller ignores a second click
 * while one runs. Without a Worker (SSR, tests, a worker that cannot
 * start) the same pure function runs here.
 *
 * With a judge and two threads the arrange runs the way the mod's does: the
 * column candidates and the free placement at once, then the two polishes
 * at once. The stages are the same functions the single-thread arrange
 * calls in order, so the answer is the same board, sooner.
 */
import { PICK_CROSSING_EXTRA } from "./board-arrange";
import {
  runArrangeJob,
  type ArrangeJob,
  type ArrangeJobResult,
  type ArrangeProgress,
} from "./arrange-job";

export type { ArrangeJob, ArrangeJobResult, ArrangeProgress } from "./arrange-job";
export { ARRANGE_STEPS } from "./arrange-job";

const workers: Array<Worker | undefined> = [];
let workerBroken = false;
let seq = 0;
/** The job in flight, so a cancel can end it. */
let pending: { seq: number; cancel: () => void } | undefined;

/** Thrown out of arrangeInWorker when the player cancels. */
export class ArrangeCancelled extends Error {
  constructor() {
    super("Arrange cancelled");
    this.name = "ArrangeCancelled";
  }
}

/**
 * Ends the arrange in flight. A worker runs its job synchronously and
 * cannot hear a message mid-job, so cancelling TERMINATES them; the next
 * arrange starts fresh ones. On the main-thread fallback the job cannot
 * be stopped, so its result is dropped when it lands.
 */
export function cancelArrange(): void {
  pending?.cancel();
}

/** Whether an arrange can leave the main thread at all. */
export function arrangeWorkerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}

function getWorker(slot: number): Worker {
  let worker = workers[slot];
  if (!worker) {
    worker = new Worker(new URL("./arrange.worker.ts", import.meta.url));
    workers[slot] = worker;
  }
  return worker;
}

function endWorkers(): void {
  for (let slot = 0; slot < workers.length; slot += 1) {
    workers[slot]?.terminate();
    workers[slot] = undefined;
  }
}

/** One job on one worker. Rejects with the worker's error; never falls back. */
function runOnWorker(
  slot: number,
  job: ArrangeJob,
  onProgress?: (progress: ArrangeProgress) => void,
): Promise<ArrangeJobResult> {
  return new Promise((resolve, reject) => {
    const target = getWorker(slot);
    const off = () => {
      target.removeEventListener("message", onMessage);
      target.removeEventListener("error", onError);
    };
    const onMessage = (
      event: MessageEvent<{ progress?: ArrangeProgress; done?: ArrangeJobResult; error?: string }>,
    ) => {
      const data = event.data;
      if (data.progress) {
        if (data.progress.seq === job.seq) onProgress?.(data.progress);
        return;
      }
      off();
      if (data.done && data.done.seq === job.seq) {
        resolve(data.done);
      } else {
        reject(new Error(data.error ?? "unknown"));
      }
    };
    const onError = (event: ErrorEvent) => {
      off();
      reject(new Error(event.message));
    };
    target.addEventListener("message", onMessage);
    target.addEventListener("error", onError);
    target.postMessage(job);
  });
}

/** Whether the machine has a second thread worth spending on one arrange. */
function threadsToSpare(): boolean {
  return typeof navigator === "undefined" || (navigator.hardwareConcurrency ?? 2) >= 2;
}

/**
 * The staged arrange on two workers. Progress is folded into the loader's
 * six steps: the search bar is the mean of both searches, the polish bar
 * follows the first polish and then the second.
 */
async function arrangeStaged(
  full: ArrangeJob,
  onProgress?: (progress: ArrangeProgress) => void,
): Promise<ArrangeJobResult> {
  const started = performance.now();
  const say = (step: number, stage: string, done: number, total: number) =>
    onProgress?.({ seq: full.seq, step, stage, done, total });
  const fraction = (progress: ArrangeProgress) =>
    Math.min(progress.done, progress.total) / Math.max(progress.total, 1);
  let columnsDone = 0;
  let freeDone = 0;
  const reportSearch = () =>
    say(1, "Searching for a better layout", Math.round((columnsDone + freeDone) * 500), 1000);
  say(0, "Laying the board out", 0, 1);
  const [columns, free] = await Promise.all([
    runOnWorker(0, { ...full, stage: "columns" }, (progress) => {
      if (progress.step === 1) {
        columnsDone = fraction(progress);
        reportSearch();
      }
    }),
    runOnWorker(1, { ...full, stage: "free" }, (progress) => {
      if (progress.step === 1) {
        freeDone = fraction(progress);
        reportSearch();
      }
    }),
  ]);
  say(2, "Routing the candidates", 0, 1);
  const candidates = {
    plain: columns.columns!.plain,
    challenger: columns.columns!.challenger,
    free: free.result,
  };
  let firstDone = 0;
  let secondDone = 0;
  let firstFinished = false;
  const reportPolish = () =>
    firstFinished
      ? say(4, "Polishing the second layout", Math.round(secondDone * 1000), 1000)
      : say(3, "Polishing the first layout", Math.round(firstDone * 1000), 1000);
  const [first, second] = await Promise.all([
    runOnWorker(0, { ...full, stage: "polish", candidates, which: 0 }, (progress) => {
      if (progress.step === 3) {
        firstDone = fraction(progress);
        reportPolish();
      }
    }).then((result) => {
      firstFinished = true;
      reportPolish();
      return result;
    }),
    runOnWorker(1, { ...full, stage: "polish", candidates, which: 1 }, (progress) => {
      if (progress.step === 4) {
        secondDone = fraction(progress);
        if (firstFinished) reportPolish();
      }
    }),
  ]);
  say(5, "Choosing the better board", 1, 1);
  // The same choice as arrangeBoard's (fewerCrossings): a crossing counts extra.
  const judged = (job: typeof first) =>
    (job.polishedPoints ?? Infinity) + PICK_CROSSING_EXTRA * (job.polishedCrossings ?? Infinity);
  const winner = judged(second) < judged(first) ? second : first;
  return { seq: full.seq, result: winner.result, arrangeMs: performance.now() - started };
}

/**
 * Runs the job in the workers (or here, when there are none) and resolves
 * with its result. Progress arrives on `onProgress` as it happens.
 */
export function arrangeInWorker(
  job: Omit<ArrangeJob, "seq">,
  onProgress?: (progress: ArrangeProgress) => void,
): Promise<ArrangeJobResult> {
  seq += 1;
  const full: ArrangeJob = { ...job, seq };
  if (!arrangeWorkerAvailable()) {
    let cancelled = false;
    pending = { seq: full.seq, cancel: () => { cancelled = true; } };
    const result = runArrangeJob(full, onProgress);
    pending = undefined;
    return cancelled ? Promise.reject(new ArrangeCancelled()) : Promise.resolve(result);
  }
  return new Promise((resolve, reject) => {
    let cancelled = false;
    pending = {
      seq: full.seq,
      cancel: () => {
        cancelled = true;
        endWorkers();
        pending = undefined;
        reject(new ArrangeCancelled());
      },
    };
    const finish = (result: ArrangeJobResult) => {
      if (cancelled) return;
      pending = undefined;
      resolve(result);
    };
    // The whole arrange on one worker; the way out of any staged failure.
    const whole = () => {
      runOnWorker(0, full, onProgress).then(finish, (error) => {
        if (cancelled) return;
        console.error("arrange worker failed; arranging on the main thread", error);
        workerBroken = true;
        endWorkers();
        finish(runArrangeJob(full, onProgress));
      });
    };
    try {
      if (!(full.judgeInput && full.cards.length >= 2 && threadsToSpare())) {
        whole();
        return;
      }
      arrangeStaged(full, onProgress).then(finish, (error) => {
        if (cancelled) return;
        console.error("staged arrange failed; arranging on one worker", error);
        endWorkers();
        whole();
      });
    } catch (error) {
      console.error("arrange worker failed to start; arranging on the main thread", error);
      workerBroken = true;
      finish(runArrangeJob(full, onProgress));
    }
  });
}
