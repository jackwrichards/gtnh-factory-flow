"use client";

import { Check, ImageOff, Link2, LoaderCircle, Pencil, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  listCommunityPlans,
  updateCommunityPlan,
  uploadCommunityPlan,
} from "@/lib/community/client";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { randomUUID } from "@/lib/random-id";
import { formatRate } from "@/lib/model";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
} from "@/lib/import-export/plan-image";
import { serializeFactoryProject } from "@/lib/import-export";
import { useFactoryStore } from "@/store/factory-store";
import { AuthForm, useCommunityUser } from "./auth";

type ThumbnailState =
  | { status: "capturing" }
  | { status: "ready"; dataUrl: string }
  | { status: "failed" };

export function SharePlanDialog({ onClose }: { onClose: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const setProjectCommunityLink = useFactoryStore((state) => state.setProjectCommunityLink);
  const { user, isLoading: isUserLoading, setUser } = useCommunityUser();

  const [name, setName] = useState(project.name || "My factory");
  const [description, setDescription] = useState("");
  const [myPostsFor, setMyPostsFor] = useState<{
    username: string;
    posts: CommunityPlanSummary[];
  }>();
  const [postAsNew, setPostAsNew] = useState(false);
  const myPosts = user && myPostsFor?.username === user.username ? myPostsFor.posts : [];
  // The design remembers which post it was shared as / imported from; Share
  // only ever targets that one post (or creates a new one).
  const linkedPost = myPosts.find((post) => post.id === project.metadata?.communityPlanId);
  const updateTargetId = linkedPost && !postAsNew ? linkedPost.id : "";
  const [thumbnail, setThumbnail] = useState<ThumbnailState>({ status: "capturing" });
  const [isUploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [shared, setShared] = useState<{ kind: "created" | "updated"; planId: string }>();
  const [copiedLink, setCopiedLink] = useState<"view" | "edit">();

  const stats = useMemo(() => computeCommunityPlanStats(project, result), [project, result]);
  const datasetVersion = manifest?.versions.find(
    (version) => version.id === selectedDatasetVersionId,
  );

  // Once signed in, load the user's existing posts so they can update one.
  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    void listCommunityPlans({ mine: true, pageSize: 48 }).then(
      (response) => {
        if (!cancelled) {
          setMyPostsFor({ username: user.username, posts: response.plans });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Ask the canvas for a thumbnail capture as soon as the dialog opens; if
  // nothing comes back we fall back to a no-image share instead of hanging.
  useEffect(() => {
    const requestId = randomUUID();
    const timeout = window.setTimeout(() => {
      setThumbnail((current) => (current.status === "capturing" ? { status: "failed" } : current));
    }, 10_000);

    const handleComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { requestId?: unknown; dataUrl?: unknown }
        | undefined;
      if (detail?.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      setThumbnail(
        typeof detail.dataUrl === "string" && detail.dataUrl.startsWith("data:image/")
          ? { status: "ready", dataUrl: detail.dataUrl }
          : { status: "failed" },
      );
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
    window.dispatchEvent(
      new CustomEvent(FLOW_IMAGE_EXPORT_EVENT, {
        detail: {
          format: "png",
          requestId,
          fileName: "thumbnail",
          projectJson: "",
          capture: true,
        },
      }),
    );
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
    };
  }, []);

  const share = async () => {
    setUploading(true);
    setError(undefined);
    try {
      const payload = {
        name,
        description,
        gameVersion: datasetVersion?.gtnhVersion ?? "",
        datasetVersionId: selectedDatasetVersionId ?? "",
        plan: JSON.parse(serializeFactoryProject(project)) as unknown,
        thumbnailDataUrl: thumbnail.status === "ready" ? thumbnail.dataUrl : undefined,
      };

      if (updateTargetId) {
        await updateCommunityPlan(updateTargetId, payload);
        setShared({ kind: "updated", planId: updateTargetId });
        setProjectCommunityLink(updateTargetId);
      } else {
        const { id } = await uploadCommunityPlan(payload);
        setShared({ kind: "created", planId: id });
        setProjectCommunityLink(id);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Sharing failed.");
    } finally {
      setUploading(false);
    }
  };

  const copyShareLink = async (kind: "view" | "edit") => {
    if (!shared) {
      return;
    }

    const url =
      kind === "edit"
        ? `${window.location.origin}/?plan=${shared.planId}`
        : `${window.location.origin}/community?plan=${shared.planId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
      return;
    }

    setCopiedLink(kind);
    window.setTimeout(
      () => setCopiedLink((current) => (current === kind ? undefined : current)),
      1500,
    );
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4">
      <div className="w-full max-w-lg rounded border border-line-strong bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Share2 className="h-4 w-4" /> Share to community
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {shared ? (
          <div className="space-y-3">
            <p className="text-sm">
              {shared.kind === "updated"
                ? "Your post has been updated."
                : "Your plan is live. Thanks for sharing!"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyShareLink("view")}
                className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                {copiedLink === "view" ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Copy link
              </button>
              <button
                type="button"
                onClick={() => void copyShareLink("edit")}
                title="A link that opens this plan directly in a friend's editor"
                className="inline-flex items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                {copiedLink === "edit" ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Pencil className="h-4 w-4" />
                )}
                Copy edit link
              </button>
            </div>
            <Link
              href="/community"
              className="inline-flex rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              View it in the community hub
            </Link>
          </div>
        ) : isUserLoading ? (
          <div className="grid place-items-center py-8 text-fg-muted">
            <LoaderCircle className="h-5 w-5 animate-spin" />
          </div>
        ) : !user ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-subtle">
              Sharing needs an account so your posts stay yours â€” just a username and password.
            </p>
            <AuthForm onSignedIn={setUser} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">
              Posting as <span className="font-semibold text-fg">{user.username}</span>
            </p>

            {linkedPost ? (
              <div className="flex gap-3 rounded border border-line bg-surface-raised p-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="share-target"
                    checked={!postAsNew}
                    onChange={() => setPostAsNew(false)}
                  />
                  Update â€œ{linkedPost.name}â€
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="share-target"
                    checked={postAsNew}
                    onChange={() => setPostAsNew(true)}
                  />
                  Post as new
                </label>
              </div>
            ) : null}

            <div className="flex gap-3">
              <div className="h-24 w-36 shrink-0 overflow-hidden rounded border border-line bg-surface-sunken">
                {thumbnail.status === "ready" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnail.dataUrl}
                    alt="Plan preview"
                    className="h-full w-full object-cover"
                  />
                ) : thumbnail.status === "failed" ? (
                  <div className="grid h-full w-full place-items-center text-fg-muted">
                    <span className="flex flex-col items-center gap-1 text-[11px]">
                      <ImageOff className="h-4 w-4" /> No preview image
                    </span>
                  </div>
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs text-fg-muted">
                    Capturingâ€¦
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-xs text-fg-subtle">
                <p>
                  {stats.nodeCount} nodes Â· {stats.machineCount} machines
                  {stats.highestTier ? ` Â· up to ${stats.highestTier}` : ""}
                </p>
                <p>{formatRate(Math.abs(stats.totalEuT), 3)} EU/t</p>
                <p className="truncate">
                  {datasetVersion?.gtnhVersion
                    ? `GTNH ${datasetVersion.gtnhVersion}`
                    : (selectedDatasetVersionId ?? "no dataset")}
                </p>
                <p className="mt-1 text-fg-muted">
                  Needs {stats.needs.length} resources, produces {stats.outputs.length}.
                </p>
              </div>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                className="w-full rounded border border-line-strong bg-surface-sunken px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Description (optional)</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="What does it make? Any setup notes?"
                className="w-full resize-y rounded border border-line-strong bg-surface-sunken px-2 py-1.5"
              />
            </label>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void share()}
                disabled={
                  isUploading ||
                  !name.trim() ||
                  project.nodes.length === 0 ||
                  thumbnail.status === "capturing"
                }
                className="inline-flex items-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {updateTargetId ? "Update post" : "Share plan"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
