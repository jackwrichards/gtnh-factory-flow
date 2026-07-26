"use client";

import { ImageOff, LoaderCircle, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getMyPostForDesign,
  rememberMyPost,
  updateCommunityPlan,
  uploadCommunityPlan,
} from "@/lib/community/client";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import { formatRate } from "@/lib/model";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
} from "@/lib/import-export/plan-image";
import { serializeFactoryProject } from "@/lib/import-export";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";

type ThumbnailState = { status: "capturing" } | { status: "ready"; dataUrl: string } | { status: "failed" };

export function SharePlanDialog({ onClose }: { onClose: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
  const existingPost = useMemo(() => getMyPostForDesign(activeDesignId), [activeDesignId]);

  const [name, setName] = useState(existingPost?.name ?? project.name ?? "My factory");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"update" | "new">(existingPost ? "update" : "new");
  const [thumbnail, setThumbnail] = useState<ThumbnailState>({ status: "capturing" });
  const [isUploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [shared, setShared] = useState<"created" | "updated">();

  const stats = useMemo(() => computeCommunityPlanStats(project, result), [project, result]);
  const datasetVersion = manifest?.versions.find(
    (version) => version.id === selectedDatasetVersionId,
  );

  // Ask the canvas for a thumbnail capture as soon as the dialog opens; if
  // nothing comes back we fall back to a no-image share instead of hanging.
  useEffect(() => {
    const requestId = crypto.randomUUID();
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

      if (mode === "update" && existingPost) {
        await updateCommunityPlan(existingPost.planId, existingPost.manageToken, payload);
        rememberMyPost({ ...existingPost, name, sharedAt: new Date().toISOString() });
        setShared("updated");
      } else {
        const { id, manageToken } = await uploadCommunityPlan(payload);
        rememberMyPost({
          planId: id,
          manageToken,
          designId: activeDesignId,
          name,
          sharedAt: new Date().toISOString(),
        });
        setShared("created");
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Sharing failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4">
      <div className="w-full max-w-lg rounded border border-line-strong bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Share2 className="h-4 w-4" />
            {existingPost ? "Share update" : "Share to community"}
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
              {shared === "updated"
                ? "Your post has been updated."
                : "Your plan is live. Thanks for sharing!"}
            </p>
            <Link
              href="/community"
              className="inline-flex rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              View it in the community hub
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {existingPost ? (
              <div className="flex gap-2 rounded border border-line bg-surface-raised p-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="share-mode"
                    checked={mode === "update"}
                    onChange={() => setMode("update")}
                  />
                  Update &quot;{existingPost.name}&quot;
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="share-mode"
                    checked={mode === "new"}
                    onChange={() => setMode("new")}
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
                    Capturing…
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-xs text-fg-subtle">
                <p>
                  {stats.nodeCount} nodes · {stats.machineCount} machines
                  {stats.highestTier ? ` · up to ${stats.highestTier}` : ""}
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
                {mode === "update" && existingPost ? "Update post" : "Share plan"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
