import { useEffect, useState } from "react";
import type { PluginApi } from "stewrd-plugin-api";
import type { ClaudeHome } from "../lib/claudeHome";
import { useAutoSaveFile } from "../lib/useAutoSaveFile";
import { IDLE_DOT, useSaveStatusDot, type SaveStatusDot } from "../lib/useSaveStatusDot";

export function AutoSaveEditor({
  api,
  home,
  relPath,
  language,
  debounceMs,
  validate,
  onStatusChange,
  onDirtyChange,
}: {
  api: PluginApi;
  home: ClaudeHome;
  relPath: string;
  language: "json" | "markdown";
  debounceMs: number;
  validate?: (text: string) => string | null;
  onStatusChange?: (dot: SaveStatusDot) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { text, setText, loaded, status, errorMessage, reload, loadGeneration, dirty } = useAutoSaveFile(home, relPath, debounceMs, validate);
  const dot = useSaveStatusDot(status, errorMessage, reload);

  // Remembered cursor/scroll position per file, restored once per mount.
  // Waits for its own storage round-trip (viewportLoaded) alongside the
  // text load (loaded) before ever mounting CodeTextArea, since it only
  // applies initialSelection/initialScrollTop once, at construction.
  const viewportKey = `viewport:${relPath}`;
  const [viewport, setViewport] = useState<{ selection: { anchor: number; head: number }; scrollTop: number } | null>(null);
  const [viewportLoaded, setViewportLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setViewportLoaded(false);
    setViewport(null);
    api.storage.get<{ selection: { anchor: number; head: number }; scrollTop: number }>(viewportKey).then((stored) => {
      if (cancelled) return;
      setViewport(stored ?? null);
      setViewportLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, viewportKey]);

  useEffect(() => {
    onStatusChange?.(dot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dot]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => {
    return () => {
      onStatusChange?.(IDLE_DOT);
      onDirtyChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Must be a flex item of a display:flex parent: CodeTextArea's
    // height="100%" only resolves against a definite (flex-sized) height -
    // under a plain block parent it becomes auto and grows with the content.
    <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      {loaded && viewportLoaded ? (
        // Never render CodeTextArea before the load resolves, and key it
        // on path+generation (not just path) - CodeMirror records every
        // dispatched value change in its undo history, so mounting before
        // load (or reusing the instance across a Reload) would let Ctrl+Z
        // revert past the user's own edits into a stale/empty buffer.
        // Also wait for viewportLoaded - initialSelection/initialScrollTop
        // only apply once, at construction.
        <api.ui.CodeTextArea
          key={`${relPath}:${loadGeneration}`}
          value={text}
          onChange={setText}
          language={language}
          width="100%"
          height="100%"
          initialSelection={viewport?.selection}
          initialScrollTop={viewport?.scrollTop}
          onViewportChange={(state) => api.storage.set(viewportKey, state)}
        />
      ) : (
        <api.ui.Skeleton height="100%" width="100%" />
      )}
    </div>
  );
}
