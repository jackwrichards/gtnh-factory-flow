"use client";

import type {
  DesignUpsertBody,
  FolderUpsertBody,
  LibraryListResponse,
  RemoteDesignMeta,
  RemoteFolder,
} from "./sync-types";

/**
 * Identifies an unavailable account service or session. The sync engine
 * reports the failure and retries, so an operator's repair can recover
 * existing open tabs without asking players to reload their work.
 */
export class LibrarySyncUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarySyncUnavailable";
  }
}

/**
 * The account refused the request as sent: too large, not a valid plan, or
 * the library is full. Sending the same thing again fails the same way, so
 * the sync engine holds that design back until it changes. Recognised by
 * `refused`, not by class, so the sync engine's tests can mock this module.
 */
export class LibraryRequestRefused extends Error {
  readonly refused = true;

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LibraryRequestRefused";
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok || !body) {
    const message = body?.error ?? `Request failed (${response.status})`;
    if (response.status === 401 || response.status === 503 || /schema\.sql/.test(message)) {
      throw new LibrarySyncUnavailable(message);
    }
    if (response.status === 400 || response.status === 409 || response.status === 413) {
      throw new LibraryRequestRefused(message, response.status);
    }
    throw new Error(message);
  }
  return body;
}

export async function fetchRemoteLibrary(): Promise<LibraryListResponse> {
  const response = await fetch("/api/library", { cache: "no-store" });
  return parseJsonOrThrow<LibraryListResponse>(response);
}

export async function fetchRemoteDesignPlan(
  id: string,
): Promise<{ design: RemoteDesignMeta; plan: unknown }> {
  const response = await fetch(`/api/library/designs/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  return parseJsonOrThrow<{ design: RemoteDesignMeta; plan: unknown }>(response);
}

export async function pushRemoteDesign(
  id: string,
  body: DesignUpsertBody,
): Promise<{ design: RemoteDesignMeta; behind: boolean }> {
  const response = await fetch(`/api/library/designs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow<{ design: RemoteDesignMeta; behind: boolean }>(response);
}

export async function deleteRemoteDesign(id: string): Promise<void> {
  const response = await fetch(`/api/library/designs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseJsonOrThrow<{ ok: true }>(response);
}

export async function pushRemoteFolder(
  id: string,
  body: FolderUpsertBody,
): Promise<{ folder: RemoteFolder; behind: boolean }> {
  const response = await fetch(`/api/library/folders/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow<{ folder: RemoteFolder; behind: boolean }>(response);
}

export async function deleteRemoteFolder(id: string): Promise<void> {
  const response = await fetch(`/api/library/folders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseJsonOrThrow<{ ok: true }>(response);
}
