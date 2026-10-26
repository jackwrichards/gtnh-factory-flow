
/**
 * The wire solve, off the main thread.
 *
 * Routing runs inside the edge components' render, so on a big board a slow
 * solve freezes the page (no drag frame, no typed digit, no hover). The
 * board posts any solve past `ASYNC_ROUTE_EDGE_LIMIT` wires here and keeps
 * drawing the routes it has until the answer lands (`FactoryFlow.tsx`
 * installs it and re-issues the edges). The worker keeps its own router,
 * which routes each job against the last board it saw; routes never depend
 * on the viewport.
 *
 * Scheduling mirrors `solve-books.ts`: one job in flight and only the
 * NEWEST waiting job kept, since a drag publishes fresh geometry several
 * times a second. Results carry a sequence number so the board can tell a
 * late answer from a current one.
 */
import {
  encodeRouteSolveJob,
  runRouteSolveJob,
  type RouteSolveJob,
  type RouteSolveResult,
} from "./grid-route-job";

export {
  ASYNC_ROUTE_EDGE_LIMIT,
  decodeRouteSolveJob,
  encodeRouteSolveJob,
  runRouteSolveJob,
  type EncodedRouteSolveJob,
  type RouteSolveJob,
  type RouteSolveResult,
} from "./grid-route-job";

type RouteSolveSink = (result: RouteSolveResult) => void;

let worker: Worker | undefined;
let workerBroken = false;
let inFlight: RouteSolveJob | undefined;
let queued: RouteSolveJob | undefined;
let sink: RouteSolveSink | undefined;

/** Whether a solve can leave the main thread at all (no Worker in SSR/tests). */
export function routeWorkerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}

/** Where finished routes go. One board at a time, like every route cache. */
export function setRouteSolveSink(next: RouteSolveSink | undefined) {
  sink = next;
}

/**
 * Posts a job, or parks it behind the one running. A parked job replaces
 * any job parked before it: geometry that has already changed again is not
 * worth solving.
 */
export function scheduleRouteSolve(job: RouteSolveJob) {
  if (inFlight) {
    queued = job;
    return;
  }
  inFlight = job;
  try {
    const encoded = encodeRouteSolveJob(job);
    getWorker().postMessage(encoded, [encoded.endpoints.buffer]);
  } catch (error) {
    console.error("route worker failed to start; routing on the main thread", error);
    workerBroken = true;
    inFlight = undefined;
    sink?.(runRouteSolveJob(job));
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./grid-route.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<RouteSolveResult | { error: string }>) => {
      inFlight = undefined;
      if ("routes" in event.data) {
        sink?.(event.data);
      } else {
        console.error("route worker error:", event.data.error);
      }
      if (queued) {
        const next = queued;
        queued = undefined;
        scheduleRouteSolve(next);
      }
    };
    worker.onerror = (event) => {
      // A worker that cannot run its script would leave every wire on its
      // old route forever; finish the outstanding job here instead.
      console.error("route worker broke; routing on the main thread", event.message);
      workerBroken = true;
      const retry = queued ?? inFlight;
      inFlight = undefined;
      queued = undefined;
      if (retry) {
        sink?.(runRouteSolveJob(retry));
      }
    };
  }
  return worker;
}
