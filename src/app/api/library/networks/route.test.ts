import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openLocalDatabase, type LocalDatabase } from "@/lib/server/local-db/database";
import { useInProcessLocalDb } from "@/lib/server/local-db/client";
import { getCommunityDb, makeSessionToken } from "@/lib/server/community";
import { GET, PUT } from "./route";

let local: LocalDatabase;
const cookies: string[] = [];
const catalogue = [
  {
    id: "main",
    name: "Factory",
    included: true,
    members: [{ designId: "line", name: "Oxygen", included: true }],
    sharing: {},
  },
];
const request = (method: string, who?: number, body?: unknown) =>
  new Request("http://localhost/api/library/networks", {
    method,
    headers: {
      ...(who !== undefined ? { cookie: cookies[who] } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  vi.stubEnv("LOCAL_DB", "1");
  vi.stubEnv("COMMUNITY_HASH_SALT", "networks-test-salt");
  local = await openLocalDatabase();
  useInProcessLocalDb(local.handle);
  for (const username of ["network-owner", "other-owner"]) {
    const { data, error } = await getCommunityDb()
      .from("community_users")
      .insert({ username, password_hash: "x:y" })
      .select("id")
      .single();
    expect(error).toBeNull();
    cookies.push(`gtnh_session=${makeSessionToken((data as { id: string }).id)}`);
  }
}, 30_000);
afterAll(async () => {
  useInProcessLocalDb(undefined);
  await local?.close();
  vi.unstubAllEnvs();
});

describe("account network catalogue", () => {
  it("requires authentication and isolates accounts", async () => {
    expect((await GET(request("GET"))).status).toBe(401);
    expect(await (await GET(request("GET", 0))).json()).toEqual({ revision: 0, networks: [] });
    expect((await PUT(request("PUT", 0, { revision: 0, networks: catalogue }))).status).toBe(200);
    expect(await (await GET(request("GET", 1))).json()).toEqual({ revision: 0, networks: [] });
  });
  it("rejects stale initial and update writes without losing saved membership", async () => {
    expect((await PUT(request("PUT", 0, { revision: 0, networks: [] }))).status).toBe(409);
    const saved = await PUT(
      request("PUT", 0, { revision: 1, networks: [{ ...catalogue[0], name: "Renamed" }] }),
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).revision).toBe(2);
    expect((await PUT(request("PUT", 0, { revision: 1, networks: [] }))).status).toBe(409);
    expect((await (await GET(request("GET", 0))).json()).networks[0].members).toEqual(
      catalogue[0].members,
    );
  });
  it("validates the entire hierarchy before accepting it", async () => {
    const invalid = [catalogue[0], { ...catalogue[0], id: "duplicate-membership" }];
    expect((await PUT(request("PUT", 0, { revision: 2, networks: invalid }))).status).toBe(400);
    expect(
      (
        await PUT(
          request("PUT", 0, { revision: 2, networks: [{ ...catalogue[0], parentId: "main" }] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PUT(
          request("PUT", 0, {
            revision: 2,
            networks: [{ ...catalogue[0], name: "x".repeat(1_000_000) }],
          }),
        )
      ).status,
    ).toBe(413);
  });
  it("persists deletion as a new empty revision so older devices cannot resurrect it", async () => {
    expect((await PUT(request("PUT", 0, { revision: 2, networks: [] }))).status).toBe(200);
    expect((await PUT(request("PUT", 0, { revision: 2, networks: catalogue }))).status).toBe(409);
    expect(await (await GET(request("GET", 0))).json()).toEqual({ revision: 3, networks: [] });
  });
  it("names the network migration when its table is missing", async () => {
    await local.db.exec("alter table library_networks rename to library_networks_unavailable");
    try {
      for (const response of [
        await GET(request("GET", 0)),
        await PUT(request("PUT", 0, { revision: 3, networks: [] })),
      ]) {
        expect(response.status).toBe(500);
        expect((await response.json()).error).toBe(
          "Network sync is not set up: run supabase/migrations/2026-10-19-plan-networks.sql in the Supabase SQL editor.",
        );
      }
    } finally {
      await local.db.exec("alter table library_networks_unavailable rename to library_networks");
    }
  });
});
