"use client";

import { Globe, LoaderCircle, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { computeBlueprintIo } from "@/lib/blueprints/io-stats";
import { normalizeBlueprintTags } from "@/lib/blueprints/types";
import { getNodeMachineBuildCount } from "@/lib/model/passive-production";
import type { EntryIcon } from "@/lib/community/types";
import { useBlueprintStore, type BlueprintSaveRequest } from "@/store/blueprint-store";
import { renderIoStats, TierBadge } from "./shelf-cards";
import { EntryIconSlot, IconPicker, iconSuggestionsFromStats } from "./IconPicker";

/**
 * The one confirmation every pocket-to-shelf path lands in: the pocket
 * card's save button, the shelf's share-a-pocket flow, and overwriting an
 * owned row. Mostly filled out already — the pocket's name, its needs and
 * makes, the machine count — plus the face it wears (icon), its tags, and
 * whether it goes public the moment it exists.
 */
export function BlueprintSaveDialog() {
  const request = useBlueprintStore((state) => state.saveRequest);
  if (!request) {
    return null;
  }

  // Keyed so switching targets never leaks a half-edited name across.
  return <SaveDialogBody key={request.blueprintId ?? "create"} request={request} />;
}

function SaveDialogBody({ request }: { request: BlueprintSaveRequest }) {
  const setSaveRequest = useBlueprintStore((state) => state.setSaveRequest);
  const save = useBlueprintStore((state) => state.save);
  const update = useBlueprintStore((state) => state.update);
  const publish = useBlueprintStore((state) => state.publish);
  const [name, setName] = useState(request.name);
  const [icon, setIcon] = useState<EntryIcon | undefined>(request.icon);
  const [tags, setTags] = useState<string[]>(request.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [makePublic, setMakePublic] = useState(request.isPublic ?? false);
  const [isPickingIcon, setPickingIcon] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const io = useMemo(() => computeBlueprintIo(request.payload), [request.payload]);
  const cardCount = request.payload.nodes.length + request.payload.storages.length;
  // Crop cards count the harvesters their crops fill, not seeds.
  const machineCount = useMemo(() => {
    const recipesById = new Map(request.payload.recipes.map((recipe) => [recipe.id, recipe]));
    return request.payload.nodes.reduce(
      (sum, node) => sum + getNodeMachineBuildCount(recipesById.get(node.recipeId), node),
      0,
    );
  }, [request.payload]);
  const isOverwrite = Boolean(request.blueprintId);

  const close = () => setSaveRequest(undefined);

  const addTagFromInput = () => {
    const next = normalizeBlueprintTags([...tags, tagInput]);
    setTags(next);
    setTagInput("");
    return next;
  };

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    setSaving(true);
    setError(undefined);
    // Whatever is still sitting in the tag input counts as one last tag.
    const finalTags = tagInput.trim() ? addTagFromInput() : tags;

    if (request.blueprintId) {
      const ok = await update(request.blueprintId, {
        name: trimmed,
        payload: request.payload,
        icon: icon ?? null,
        tags: finalTags,
      });
      if (ok && makePublic !== (request.isPublic ?? false)) {
        await publish(request.blueprintId, makePublic);
      }
      setSaving(false);
      if (ok) {
        close();
      } else {
        setError(useBlueprintStore.getState().error ?? "Saving failed.");
      }
      return;
    }

    const created = await save(trimmed, request.payload, icon, finalTags);
    if (created && makePublic) {
      await publish(created.id, true);
    }
    setSaving(false);
    if (created) {
      close();
    } else {
      setError(useBlueprintStore.getState().error ?? "Saving failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-neutral-950/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[6px] border border-neutral-600 bg-[#25272c] p-4 text-neutral-100 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Save className="h-4 w-4" />
            {isOverwrite ? "Overwrite this pocket" : "Save this pocket"}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 hover:text-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isOverwrite ? (
          <p className="mb-3 text-xs leading-relaxed text-amber-300">
            The picked pocket replaces this one&apos;s contents. Its votes, downloads and
            standing stay.
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <EntryIconSlot
            icon={icon}
            editable
            onEdit={() => setPickingIcon(true)}
            className="!h-10 !w-10 border border-neutral-700 bg-[#17191d]"
          />
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void commit();
              }
            }}
            placeholder="Pocket name"
            className="h-10 min-w-0 flex-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2.5 text-sm outline-none focus:border-cyan-600"
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-[4px] border border-neutral-700 bg-[#17191d] p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums text-neutral-400">
            <span>
              <span className="font-semibold text-neutral-100">{cardCount}</span> cards inside
            </span>
            <span>
              <span className="font-semibold text-neutral-100">{machineCount}</span> machines
            </span>
            {io.highestTier ? (
              <span className="flex items-center gap-1.5">
                up to <TierBadge tier={io.highestTier} />
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            {renderIoStats(io.needs, io.outputs, { layout: "side-by-side" }) ?? (
              <p className="text-[11px] text-neutral-500">No outside needs or leftovers.</p>
            )}
          </div>
        </div>

        <div className="mt-3 text-sm">
          <span className="mb-1 block text-xs font-medium text-neutral-300">Tags (optional)</span>
          <div className="flex flex-wrap items-center gap-1 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 py-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                title={`Remove #${tag}`}
                className="rounded-[3px] border border-neutral-600 bg-[#25272c] px-1.5 py-0.5 text-[11px] text-neutral-300 hover:border-red-500 hover:text-red-400"
              >
                #{tag} ×
              </button>
            ))}
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTagFromInput();
                }
              }}
              placeholder={tags.length === 0 ? "steel, early game..." : ""}
              className="h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none"
            />
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2.5 py-2 text-sm">
          <input
            type="checkbox"
            checked={makePublic}
            onChange={(event) => setMakePublic(event.target.checked)}
          />
          <Globe className="h-4 w-4 text-emerald-400" />
          <span className="min-w-0">
            <span className="block leading-tight">Publish to everyone</span>
            <span className="block text-[11px] leading-tight text-neutral-500">
              {isOverwrite
                ? "Off keeps it private. It stays on your shelf either way."
                : "On the Public shelf the moment it saves. You can flip this any time."}
            </span>
          </span>
        </label>

        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="h-9 rounded-[4px] border border-neutral-700 bg-[#17191d] px-4 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving || !name.trim()}
            onClick={() => void commit()}
            className="flex h-9 items-center gap-1.5 rounded-[4px] border border-cyan-700 bg-cyan-600 px-4 text-sm font-medium text-white enabled:hover:bg-cyan-500 disabled:opacity-50"
          >
            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {isOverwrite ? "Overwrite" : "Save to my shelf"}
          </button>
        </div>
      </div>
      {isPickingIcon ? (
        <IconPicker
          title="Pick this pocket's icon"
          suggestions={iconSuggestionsFromStats(io.needs, io.outputs)}
          onPick={(picked) => {
            setIcon(picked);
            setPickingIcon(false);
          }}
          onClear={
            icon
              ? () => {
                  setIcon(undefined);
                  setPickingIcon(false);
                }
              : undefined
          }
          onClose={() => setPickingIcon(false)}
        />
      ) : null}
    </div>
  );
}
