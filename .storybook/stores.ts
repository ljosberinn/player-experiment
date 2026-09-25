import type { StoreApi } from "zustand";
import { useEditorStore } from "../src/features/editor/store";
import { useExportStore } from "../src/features/export/store";
import { useLastfmStore } from "../src/features/lastfm/store";
import { useScanStore } from "../src/features/library/scan";
import { useLibraryStore } from "../src/features/library/store";
import { useLovedStore } from "../src/features/love/store";
import { usePlayerStore } from "../src/features/player/store";
import { usePlaylistsStore } from "../src/features/playlists/store";
import { useBackgroundTaskStore } from "../src/features/shell/backgroundTaskStore";
import { useDynamicBackgroundStore } from "../src/features/shell/dynamicBackgroundStore";
import { useLookupStore } from "../src/features/shell/lookupStore";
import { useStatusStore } from "../src/features/shell/statusStore";
import { useThemeStore } from "../src/features/shell/themeStore";
import { useZoomStore } from "../src/features/shell/zoomStore";
import { useStatsStore } from "../src/features/stats/store";
import { useTagsourceStore } from "../src/features/tagsource/store";
import { useUpdaterStore } from "../src/features/updater/store";

/**
 * Every store in `src/`. They are module singletons, so a story that seeds
 * one would otherwise leave it seeded for the next. A new store goes here.
 */
export const STORES = [
  useBackgroundTaskStore,
  useDynamicBackgroundStore,
  useEditorStore,
  useExportStore,
  useLastfmStore,
  useLibraryStore,
  useLookupStore,
  useLovedStore,
  usePlayerStore,
  usePlaylistsStore,
  useScanStore,
  useStatsStore,
  useStatusStore,
  useTagsourceStore,
  useThemeStore,
  useUpdaterStore,
  useZoomStore,
];

function reset<T>(store: StoreApi<T>) {
  store.setState(store.getInitialState(), true);
}

export function resetStores() {
  for (const store of STORES) {
    reset(store as StoreApi<unknown>);
  }
}
