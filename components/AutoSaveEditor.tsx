import { useEffect } from "react";
import type { PluginApi } from "stewrd-plugin-api";
import type { ClaudeHome } from "../lib/claudeHome";
import { useAutoSaveFile } from "../lib/useAutoSaveFile";
import { IDLE_DOT, useSaveStatusDot, type SaveStatusDot } from "../lib/useSaveStatusDot";

export function AutoSaveEditor({
  api,
  home,
  relPath,
  language,
  validate,
  onStatusChange,
}: {
  api: PluginApi;
  home: ClaudeHome;
  relPath: string;
  language: "json" | "markdown";
  validate?: (text: string) => string | null;
  onStatusChange?: (dot: SaveStatusDot) => void;
}) {
  const { text, setText, loaded, status, errorMessage, reload, loadGeneration } = useAutoSaveFile(home, relPath, validate);
  const dot = useSaveStatusDot(status, errorMessage, reload);

  useEffect(() => {
    onStatusChange?.(dot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dot]);

  useEffect(() => {
    return () => onStatusChange?.(IDLE_DOT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      {loaded ? (
        // Never render CodeTextArea before the load resolves, and key it
        // on path+generation (not just path) - CodeMirror records every
        // dispatched value change in its undo history, so mounting before
        // load (or reusing the instance across a Reload) would let Ctrl+Z
        // revert past the user's own edits into a stale/empty buffer.
        <api.ui.CodeTextArea
          key={`${relPath}:${loadGeneration}`}
          value={text}
          onChange={setText}
          language={language}
          width="100%"
          height="100%"
        />
      ) : (
        <api.ui.Skeleton height="100%" width="100%" />
      )}
    </div>
  );
}
