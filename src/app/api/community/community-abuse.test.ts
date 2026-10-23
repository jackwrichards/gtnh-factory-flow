import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openLocalDatabase, type LocalDatabase } from "@/lib/server/local-db/database";
import { useInProcessLocalDb } from "@/lib/server/local-db/client";
import {
  accountKey,
  addressKey,
  checkRateLimits,
  forgetSessionUsers,
  getCommunityDb,
  makeSessionToken,
  SITE_KEY,
} from "@/lib/server/community";
import * as vote from "./plans/[planId]/vote/route";
import * as register from "./auth/register/route";

/**
 * The community's abuse limits, against the local database: votes need an
 * account and count once per account whatever device id is sent, the
 * database refuses a second vote row for an account, and the rate limits key
 * on account, address and site, never on the client's device id.
 */

let local: LocalDatabase;
let userId: string;
let cookie: string;
let planId: string;

beforeAll(async () => {
  vi.stubEnv("LOCAL_DB", "1");
  vi.stubEnv("COMMUNITY_HASH_SALT", "community-abuse-test-salt");
  local = await openLocalDatabase();
  useInProcessLocalDb(local.handle);
  const db = getCommunityDb();
  const { data: user } = await db
    .from("community_users")
    .insert({ username: "voter", password_hash: "x:y" })
    .select("id")
    .single();
  userId = (user as { id: string }).id;
  cookie = `gtnh_session=${makeSessionToken(userId)}`;
  const { data: plan } = await db
    .from("community_plans")
    .insert({ name: "plan", plan: {}, uploader_key: "k" })
    .select("id")
    .single();
  planId = (plan as { id: string }).id;
});

afterAll(async () => {
  useInProcessLocalDb(undefined);
  await local?.close();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  forgetSessionUsers();
  await getCommunityDb().from("community_events").delete().neq("action", "");
});

function castVote(value: 1 | -1, deviceId: string, signedIn: boolean, ip = "203.0.113.1") {
  return vote.POST(
    new Request(`http://localhost/api/community/plans/${planId}/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-ip": ip,
        ...(signedIn ? { cookie } : {}),
      },
      body: JSON.stringify({ deviceId, value }),
    }),
    { params: Promise.resolve({ planId }) },
  );
}

async function planVotes() {
  const { data } = await getCommunityDb()
    .from("community_plans")
    .select("upvotes,downvotes")
    .eq("id", planId)
    .single();
  return data as { upvotes: number; downvotes: number };
}

describe("community votes", () => {
  it("refuses a vote without an account, whatever device id is sent", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await castVote(1, `device-${index}`, false);
      expect(response.status).toBe(401);
    }
    expect(await planVotes()).toEqual({ upvotes: 0, downvotes: 0 });
  });

  it("counts one vote per account across fresh device ids", async () => {
    expect((await castVote(1, "device-a", true)).status).toBe(200);
    // A second device id is the same account: switching, not a second vote.
    const switched = await castVote(-1, "device-b", true);
    expect(await switched.json()).toMatchObject({ upvotes: 0, downvotes: 1, myVote: -1 });
    const { count } = await getCommunityDb()
      .from("community_votes")
      .select("plan_id", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(count).toBe(1);
    // Re-sending the same value retracts it.
    await castVote(-1, "device-c", true);
    expect(await planVotes()).toEqual({ upvotes: 0, downvotes: 0 });
  });

  it("has the database refuse a second vote row for one account on one plan", async () => {
    const db = getCommunityDb();
    const first = await db
      .from("community_votes")
      .insert({ plan_id: planId, voter_key: "key-1", user_id: userId, value: 1 });
    expect(first.error).toBeNull();
    const second = await db
      .from("community_votes")
      .insert({ plan_id: planId, voter_key: "key-2", user_id: userId, value: 1 });
    expect(second.error).not.toBeNull();
    await db.from("community_votes").delete().eq("plan_id", planId);
  });
});

describe("community rate limits", () => {
  it("refuses every limit together once any one is full", async () => {
    const limits = (user: string) => [
      { actorKey: accountKey(user), action: "upload", max: 10, windowSeconds: 3600 },
      { actorKey: SITE_KEY, action: "upload", max: 3, windowSeconds: 3600 },
    ];
    // Three accounts, one upload each, fill the site cap.
    expect(await checkRateLimits(limits("a"))).toBe(true);
    expect(await checkRateLimits(limits("b"))).toBe(true);
    expect(await checkRateLimits(limits("c"))).toBe(true);
    expect(await checkRateLimits(limits("d"))).toBe(false);
    // The refused call spent nothing on its own account.
    const { count } = await getCommunityDb()
      .from("community_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_key", accountKey("d"));
    expect(count).toBe(0);
  });

  it("keys an address limit on the address alone", () => {
    const at = (ip: string) =>
      new Request("http://localhost/", { headers: { "x-client-ip": ip } });
    expect(addressKey(at("198.51.100.7"))).toBe(addressKey(at("198.51.100.7")));
    expect(addressKey(at("198.51.100.7"))).not.toBe(addressKey(at("198.51.100.8")));
  });

  it("limits sign-ups per address and for the whole site", async () => {
    const signUp = (username: string, ip: string) =>
      register.POST(
        new Request("http://localhost/api/community/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "x-client-ip": ip },
          body: JSON.stringify({ username, password: "secret-password", deviceId: username }),
        }),
      );
    for (let index = 0; index < 5; index += 1) {
      expect((await signUp(`same-ip-${index}`, "192.0.2.1")).status).toBe(201);
    }
    // A fresh device id does not reset the address's limit.
    expect((await signUp("same-ip-5", "192.0.2.1")).status).toBe(429);

    // Spread over many addresses, the site cap still holds.
    let refused = 0;
    for (let index = 0; index < 60; index += 1) {
      const response = await signUp(`spread-${index}`, `192.0.2.${index + 10}`);
      if (response.status === 429) refused += 1;
    }
    expect(refused).toBe(5);
  }, 60_000);
});
