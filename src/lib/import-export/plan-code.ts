import { normalizeProjectFuelProfiles } from "../model/fuels";
import { factoryProjectSchema } from "../model/schemas";
import type { FactoryProject } from "../model/types";
import { isPowerRecipe } from "../power/power-recipe";
import { FactoryJsonError, parseFactoryProjectJson } from "./factory-json";

/**
 * A PLAN CODE: the whole plan as one line of text, for sharing without an
 * account (Jack, 2026-09-23). The player never sees the word "code" (it read
 * as programming): the plan bar says "Copy plan" and puts a LINK on the
 * clipboard with the code inside, and the plan menu says "Paste a copied
 * plan". Clicked, the link opens the plan; pasted, so does the text. The
 * code rides in the address after `#p=`.
 *
 * The same trick ShadowTheAge's calculator uses for its share links: the
 * plan's JSON, deflated, in URL-safe base64. Nothing goes to a server; the
 * fragment after `#` never leaves the browser.
 *
 * Slimmer than the JSON download. A GregTech recipe carries its whole
 * overclock table (`runtimeCalculation`), about half of a typical code once
 * compressed, and every plan that lands on the board is refreshed from the
 * dataset anyway (FactoryPlannerApp), which puts the tables back. Power
 * recipes stay whole (they are made here, not by the dataset), and so do
 * the small bee and crop tables.
 *
 * Still long - thousands of characters for a small plan, tens of thousands
 * for a big one - so it suits a paste, a DM or a forum post, not a Discord
 * message, which stops at 2,000.
 */

/** The code's first characters: what it is, and which way it was packed. */
const CODE_PREFIX = "gtnh1.";

/**
 * Where a code sits in a link: `https://gtnhplanner.com/#p=<code>`. Not
 * "plan": `?plan=` is already a community post's link.
 */
export const PLAN_CODE_HASH_KEY = "p";

export async function encodePlanCode(project: FactoryProject): Promise<string> {
  const plan = factoryProjectSchema.parse(normalizeProjectFuelProfiles(project));
  // A code is a copy, never the post: whoever opens it gets a plan of their
  // own, not a link to the sender's community setup.
  const { communityPlanId, ...metadata } = plan.metadata ?? {};
  void communityPlanId;
  const slim = {
    ...plan,
    metadata,
    recipes: plan.recipes.map((recipe) => {
      if (
        isPowerRecipe(recipe) ||
        !recipe.runtimeCalculation?.sourceKind.startsWith("gregtech-")
      ) {
        return recipe;
      }
      const { runtimeCalculation, ...rest } = recipe;
      void runtimeCalculation;
      return rest;
    }),
  };
  const packed = await pipeThrough(
    new TextEncoder().encode(JSON.stringify(slim)),
    new CompressionStream("deflate-raw"),
  );
  return `${CODE_PREFIX}${toBase64Url(packed)}`;
}

/** The link that opens a code: this site, with the code after `#p=`. */
export function planCodeLink(code: string, origin: string): string {
  return `${origin}/#${PLAN_CODE_HASH_KEY}=${code}`;
}

/** The code in an address fragment (`#p=...`), if there is one. */
export function readPlanCodeFromHash(hash: string): string | undefined {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const key = `${PLAN_CODE_HASH_KEY}=`;
  return fragment.startsWith(key) ? fragment.slice(key.length) : undefined;
}

/**
 * The plan in a code, a link carrying one, or either with stray whitespace
 * or line breaks from a chat window. Anything else is refused in words a
 * player can act on.
 */
export async function decodePlanCode(text: string): Promise<FactoryProject> {
  const compact = text.replace(/\s+/g, "");
  const hashAt = compact.indexOf("#");
  const code = (hashAt >= 0 ? readPlanCodeFromHash(compact.slice(hashAt)) : undefined) ?? compact;
  if (!code.startsWith(CODE_PREFIX)) {
    throw new FactoryJsonError(
      "That is not a copied plan. Use Copy plan on the plan bar to make one.",
    );
  }
  let json: string;
  try {
    const bytes = fromBase64Url(code.slice(CODE_PREFIX.length));
    const unpacked = await pipeThrough(bytes, new DecompressionStream("deflate-raw"));
    json = new TextDecoder().decode(unpacked);
  } catch {
    throw new FactoryJsonError(
      "That copied plan is cut short or damaged. Copy it again, all of it.",
    );
  }
  return parseFactoryProjectJson(json);
}

async function pipeThrough(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  // In chunks: spreading a big array into fromCharCode overflows the stack.
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new Error("not base64url");
  }
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
