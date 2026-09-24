import { getFilledCellFluidEquivalent } from "@/lib/model/resources";
import { getCommunityDb, isCommunityConfigured } from "@/lib/server/community";

/**
 * What the community actually builds: a per-resource popularity score
 * aggregated over every public shared setup.
 *
 * The formula, per plan (each plan votes once per resource, so one giant
 * board cannot stuff the ballot):
 *   +2  the plan MAKES it (it is an output of a recipe some card runs),
 *   else +1 if it only USES it (an input of such a recipe, or a drawer);
 *       the stronger role wins, they do not stack
 *   +min(1, log10(1 + rate)) the plan SHIPS it (the row's denormalized
 *       boundary outputs carry real items/s / L/s). Capped at +1 so a plan's
 *       whole vote is bounded: fifty setups trickling water must always
 *       outrank one setup gushing a billion lava - popularity is how many
 *       people build it, never how much of it there is.
 * Every plan weighs the same. Weighting by votes or views would just make
 * the front page vote twice.
 *
 * Three shaping rules on top (Jack, 2026-08-31):
 * - Programmed circuits score nothing. Every other card holds one; ranking
 *   them says nothing about what people build.
 * - A filled cell IS its fluid: the cell's votes land on the fluid's key
 *   (name-tolerant, the same equivalence the recipe search uses), so only
 *   the fluid climbs the list and the two forms never split their score.
 * - Items weigh a little more than fluids: one crafted item usually stands
 *   for more work than one of the litres flanking it.
 *
 * Keys are `${kind}:${id}`, the same shape the dataset catalog uses, so the
 * resources route can look straight up. With Supabase unconfigured (local
 * dev) the map is empty and the sort degrades to best match's order.
 *
 * THE ITEM LIST NEVER WAITS FOR IT (2026-09-24). "Most popular" is the
 * items column's default sort, and the sweep reads every public plan's
 * jsonb from Supabase: when Supabase stalled, every item list request sat
 * behind the stalled sweep for ~90 s and the whole site read as broken.
 * `getResourcePopularity` answers at once with the last good map (empty
 * before the first sweep lands) and starts a sweep in the background when
 * one is due. The prewarm endpoint starts the first one at boot.
 *
 * The sweep is the heaviest read the app makes (every public plan, often
 * megabytes each), so it runs every six hours, and a failed one waits half
 * an hour before trying again rather than piling onto a struggling database.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Small pages, ordered by the primary key: a plan jsonb can run to megabytes,
// and 40 of them in one statement tripped Postgres's statement timeout.
const PAGE_SIZE = 10;
const MAX_PLANS = 1000;
const FAILURE_RETRY_MS = 30 * 60 * 1000;

let cache: { at: number; map: Map<string, number> } | undefined;
let inFlight: Promise<Map<string, number>> | undefined;
const EMPTY = new Map<string, number>();

/** The last good popularity map, never waiting: starts a sweep when one is due. */
export function getResourcePopularity(): Map<string, number> {
  if (!cache || Date.now() - cache.at >= CACHE_TTL_MS) {
    void refreshResourcePopularity();
  }
  return cache?.map ?? EMPTY;
}

/** Runs a sweep unless one is already running; resolves with the map it lands. */
export function refreshResourcePopularity(): Promise<Map<string, number>> {
  if (!inFlight) {
    inFlight = buildPopularityMap()
      .then((map) => {
        cache = { at: Date.now(), map };
        return map;
      })
      .catch((error) => {
        console.error("resource popularity aggregation failed", error);
        const stale = cache?.map ?? EMPTY;
        cache = { at: Date.now() - CACHE_TTL_MS + FAILURE_RETRY_MS, map: stale };
        return stale;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }
  return inFlight;
}

/** Tests only: forget every sweep. */
export function resetResourcePopularityForTests(): void {
  cache = undefined;
  inFlight = undefined;
}

async function buildPopularityMap(): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!isCommunityConfigured()) {
    return totals;
  }
  const db = getCommunityDb();

  for (let offset = 0; offset < MAX_PLANS; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from("community_plans")
      .select("plan, outputs")
      .or("is_public.eq.true,is_public.is.null")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      const votes = scoreOnePlan(row.plan, row.outputs);
      for (const [key, score] of votes) {
        const weight = key.startsWith("item:") ? ITEM_WEIGHT : 1;
        totals.set(key, (totals.get(key) ?? 0) + score * weight);
      }
    }
    if (!data || data.length < PAGE_SIZE) {
      break;
    }
  }
  return totals;
}

/** The stored jsonb is untrusted history; read it defensively, field by field. */
function scoreOnePlan(plan: unknown, outputs: unknown): Map<string, number> {
  const votes = new Map<string, number>();
  const vote = (key: string | undefined, score: number) => {
    if (key) {
      votes.set(key, Math.max(votes.get(key) ?? 0, score));
    }
  };

  if (plan && typeof plan === "object") {
    const project = plan as {
      recipes?: unknown;
      nodes?: unknown;
      storages?: unknown;
    };
    // Only recipes a card actually runs count; the plan's recipe store can
    // carry leftovers nothing references.
    const usedRecipeIds = new Set<string>();
    if (Array.isArray(project.nodes)) {
      for (const node of project.nodes) {
        const recipeId = (node as { recipeId?: unknown })?.recipeId;
        if (typeof recipeId === "string") {
          usedRecipeIds.add(recipeId);
        }
      }
    }
    if (Array.isArray(project.recipes)) {
      for (const recipe of project.recipes) {
        const entry = recipe as { id?: unknown; inputs?: unknown; outputs?: unknown };
        if (typeof entry.id !== "string" || !usedRecipeIds.has(entry.id)) {
          continue;
        }
        if (Array.isArray(entry.outputs)) {
          for (const output of entry.outputs) {
            vote(resourceKey(output), MADE_SCORE);
          }
        }
        if (Array.isArray(entry.inputs)) {
          for (const input of entry.inputs) {
            vote(resourceKey(input), USED_SCORE);
          }
        }
      }
    }
    if (Array.isArray(project.storages)) {
      for (const storage of project.storages) {
        const entry = storage as {
          kind?: unknown;
          resourceId?: unknown;
          displayName?: unknown;
        };
        if (typeof entry.kind === "string" && typeof entry.resourceId === "string") {
          vote(
            canonicalKey(entry.kind, entry.resourceId, entry.displayName),
            USED_SCORE,
          );
        }
      }
    }
  }

  // Boundary output rates ride on top of the appearance vote.
  if (Array.isArray(outputs)) {
    for (const stat of outputs) {
      const entry = stat as {
        kind?: unknown;
        resourceId?: unknown;
        displayName?: unknown;
        ratePerSecond?: unknown;
      };
      if (
        typeof entry.kind === "string" &&
        typeof entry.resourceId === "string" &&
        typeof entry.ratePerSecond === "number" &&
        entry.ratePerSecond > 0
      ) {
        const key = canonicalKey(entry.kind, entry.resourceId, entry.displayName);
        if (key) {
          const shipBonus = Math.min(1, Math.log10(1 + entry.ratePerSecond));
          votes.set(key, (votes.get(key) ?? 0) + shipBonus);
        }
      }
    }
  }
  return votes;
}

const MADE_SCORE = 2;
const USED_SCORE = 1;
/**
 * Items weigh well over fluids in the final tally: every chain is flanked by
 * the same dozen process gases, and at parity they buried every crafted thing
 * (1.5 was tried and the top of the list was still all fluids).
 */
const ITEM_WEIGHT = 3;

function resourceKey(resource: unknown): string | undefined {
  const entry = resource as { kind?: unknown; id?: unknown; displayName?: unknown };
  return typeof entry?.kind === "string" && typeof entry?.id === "string"
    ? canonicalKey(entry.kind, entry.id, entry.displayName)
    : undefined;
}

/**
 * The key a vote actually lands on: circuits land nowhere, and a filled
 * cell's vote lands on its fluid so only the fluid shows in the ranking.
 * The fluid id is derived from the cell's name; a rare miss ("Molten Cast
 * Iron" is `molten.castiron`) scores a key no dataset resource wears, which
 * only means that cell's votes go unspent.
 */
function canonicalKey(kind: string, id: string, displayName: unknown): string | undefined {
  // Plumbing, not products: every card holds a programmed circuit and every
  // cell chain holds empties, so ranking them says nothing about what people
  // build.
  if (
    kind === "item" &&
    (id.startsWith("gregtech:gt.integrated_circuit") || id === "ic2:itemcellempty")
  ) {
    return undefined;
  }
  if (kind === "item") {
    const fluid = getFilledCellFluidEquivalent({
      kind: "item",
      id,
      displayName: typeof displayName === "string" ? displayName : undefined,
    });
    if (fluid) {
      return `fluid:${fluid.id}`;
    }
  }
  return `${kind}:${id}`;
}
