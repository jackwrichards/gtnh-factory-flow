"use client";

import type {
  CommunityPlanListRequest,
  CommunityPlanListResponse,
  CommunityPlanSummary,
  CommunityUploadRequest,
  CommunityUploadResponse,
  CommunityUser,
  CommunityVoteResponse,
} from "./types";

const DEVICE_ID_STORAGE_KEY = "gtnh-factory-flow.device-id.v1";

/** Stable anonymous id for this browser; pairs with the IP hash server-side. */
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  let deviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  }

  return deviceId;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return body;
}

export async function listCommunityPlans(
  params: CommunityPlanListRequest,
): Promise<CommunityPlanListResponse> {
  const search = new URLSearchParams();
  if (params.sort) search.set("sort", params.sort);
  if (params.search) search.set("search", params.search);
  if (params.maxTier) search.set("maxTierIndex", params.maxTier);
  if (params.mine) search.set("mine", "1");
  if (params.gameVersion) search.set("gameVersion", params.gameVersion);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  search.set("deviceId", getDeviceId());

  const response = await fetch(`/api/community/plans?${search.toString()}`);
  return parseJsonOrThrow<CommunityPlanListResponse>(response);
}

export async function getCommunityPlan(planId: string): Promise<CommunityPlanSummary> {
  const response = await fetch(
    `/api/community/plans/${encodeURIComponent(planId)}?deviceId=${encodeURIComponent(getDeviceId())}`,
  );
  const body = await parseJsonOrThrow<{ plan: CommunityPlanSummary }>(response);
  return body.plan;
}

export async function downloadCommunityPlan(
  planId: string,
): Promise<{ name: string; plan: unknown }> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}/download`, {
    method: "POST",
  });
  return parseJsonOrThrow<{ name: string; plan: unknown }>(response);
}

export async function voteCommunityPlan(
  planId: string,
  value: 1 | -1,
): Promise<CommunityVoteResponse> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), value }),
  });
  return parseJsonOrThrow<CommunityVoteResponse>(response);
}

export async function uploadCommunityPlan(
  upload: Omit<CommunityUploadRequest, "deviceId">,
): Promise<CommunityUploadResponse> {
  const response = await fetch("/api/community/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...upload, deviceId: getDeviceId() }),
  });
  return parseJsonOrThrow<CommunityUploadResponse>(response);
}

export async function updateCommunityPlan(
  planId: string,
  upload: Omit<CommunityUploadRequest, "deviceId">,
): Promise<{ id: string }> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(upload),
  });
  return parseJsonOrThrow<{ id: string }>(response);
}

export async function deleteCommunityPlan(planId: string): Promise<void> {
  const response = await fetch(`/api/community/plans/${encodeURIComponent(planId)}`, {
    method: "DELETE",
  });
  await parseJsonOrThrow<{ ok: boolean }>(response);
}

// ---------------------------------------------------------------------------
// Accounts: username + password, session lives in an httpOnly cookie.
// ---------------------------------------------------------------------------

export async function fetchCurrentUser(): Promise<CommunityUser | undefined> {
  const response = await fetch("/api/community/auth/me");
  const body = (await response.json().catch(() => undefined)) as
    | { user: CommunityUser | null }
    | undefined;
  return body?.user ?? undefined;
}

export async function registerCommunityUser(
  username: string,
  password: string,
): Promise<CommunityUser> {
  const response = await fetch("/api/community/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow<CommunityUser>(response);
}

export async function loginCommunityUser(
  username: string,
  password: string,
): Promise<CommunityUser> {
  const response = await fetch("/api/community/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow<CommunityUser>(response);
}

export async function logoutCommunityUser(): Promise<void> {
  await fetch("/api/community/auth/logout", { method: "POST" });
}

/**
 * Hand-off used by "Open in editor": the community page stashes the plan and
 * the editor imports it on next load.
 */
export const PENDING_IMPORT_STORAGE_KEY = "gtnh-factory-flow.pending-community-import.v1";

/**
 * Stamps a downloaded plan with the community post it came from, so the
 * editor's Share and link actions can target that exact post later.
 */
export function tagPlanWithCommunityId(plan: unknown, planId: string): unknown {
  if (typeof plan !== "object" || plan === null) {
    return plan;
  }

  const record = plan as { metadata?: Record<string, unknown> };
  return { ...record, metadata: { ...record.metadata, communityPlanId: planId } };
}

export function stashPlanForEditor(plan: unknown): void {
  window.localStorage.setItem(PENDING_IMPORT_STORAGE_KEY, JSON.stringify(plan));
}

export function takePendingEditorImport(): unknown | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const raw = window.localStorage.getItem(PENDING_IMPORT_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }

  window.localStorage.removeItem(PENDING_IMPORT_STORAGE_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
