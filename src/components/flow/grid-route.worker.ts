import {
  boardRouterSnapshot,
  decodeRouteSolveJob,
  hasBoardRouter,
  restoreBoardRouter,
  runRouteSolveJob,
  type EncodedRouteSolveJob,
} from "./grid-route-job";
import { loadRoutes, saveRoutes } from "./route-memory";

/**
 * The grid router, off the main thread. One job in, one result out; the
 * router remembers the last board it routed per plan, so each job routes
 * again only what changed (`runRouteSolveJob`). A plan this worker has not
 * routed yet starts from the routes this browser stored for it
 * (`route-memory.ts`), and each plan's routes are stored again a moment after
 * a thorough solve. The scheduling (coalescing drag beats, dropping
 * superseded jobs, deciding whether an answer is still current) lives in
 * `grid-route-solve.ts` and `FactoryFlow.tsx`.
 */

/** Jobs run one after another, the stored routes read in between. */
let queue: Promise<void> = Promise.resolve();
/** Plans whose stored routes were already asked for this session. */
const asked = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** After a thorough solve, how long to wait for quiet before storing the routes. */
const SAVE_DELAY_MS = 1500;

async function handle(encoded: EncodedRouteSolveJob) {
  try {
    const job = decodeRouteSolveJob(encoded);
    const key = job.boardKey;
    if (key && !hasBoardRouter(key) && !asked.has(key)) {
      asked.add(key);
      const stored = await loadRoutes(key);
      if (stored) restoreBoardRouter(key, stored);
    }
    self.postMessage(runRouteSolveJob(job));
    if (key && job.thorough) {
      clearTimeout(saveTimers.get(key));
      saveTimers.set(
        key,
        setTimeout(() => {
          saveTimers.delete(key);
          const snapshot = boardRouterSnapshot(key);
          if (snapshot) void saveRoutes(key, snapshot);
        }, SAVE_DELAY_MS),
      );
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<EncodedRouteSolveJob>) => {
  queue = queue.then(() => handle(event.data));
};
