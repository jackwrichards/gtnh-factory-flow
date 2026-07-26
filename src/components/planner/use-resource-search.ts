"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { queryRecipeDatasetResources } from "@/lib/datasets/browser-loader";
import type { DatasetResourceIndexEntry } from "@/lib/datasets/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useFactoryStore } from "@/store/factory-store";

const SEARCH_DEBOUNCE_MS = 220;
const MIN_QUERY_LENGTH = 2;

/**
 * Item-picker search against the active dataset's resource index.
 *
 * State holds only settled fetches, keyed by the query that produced them;
 * "searching" and "no results yet" are derived by comparing keys, so the
 * effect never has to reset state synchronously.
 */
export function useResourceSearch(query: string, limit = 24) {
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [settled, setSettled] = useState<{
    key: string;
    results: DatasetResourceIndexEntry[];
  }>();

  const version = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );

  const trimmedQuery = debouncedQuery.trim();
  const isActive = Boolean(version) && trimmedQuery.length >= MIN_QUERY_LENGTH;
  const searchKey = version ? `${version.id}|${trimmedQuery}|${limit}` : "";

  useEffect(() => {
    if (!isActive || !version) {
      return;
    }

    const controller = new AbortController();
    queryRecipeDatasetResources(
      datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      version,
      { query: trimmedQuery, offset: 0, limit },
      { signal: controller.signal },
    )
      .then((result) => setSettled({ key: searchKey, results: result.resources }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setSettled({ key: searchKey, results: [] });
        }
      });

    return () => controller.abort();
  }, [datasetManifestUrl, isActive, limit, searchKey, trimmedQuery, version]);

  return {
    results: isActive && settled?.key === searchKey ? settled.results : [],
    isSearching: isActive && settled?.key !== searchKey,
    hasDataset: Boolean(version),
  };
}
