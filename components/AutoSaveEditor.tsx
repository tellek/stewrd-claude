import type { PluginApi } from "stewrd-plugin-api";
import type { ClaudeHome } from "../lib/claudeHome";
import { useAutoSaveFile } from "../lib/useAutoSaveFile";

export function AutoSaveEditor({
  api,
  home,
  relPath,
  language,
  validate,
}: {
  api: PluginApi;
  home: ClaudeHome;
  relPath: string;
  language: "json" | "markdown";
  validate?: (text: string) => string | null;
}) {
  const { text, setText, loaded, status, errorMessage, reload, loadGeneration } = useAutoSaveFile(home, relPath, validate);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
      <StatusLine api={api} status={status} errorMessage={errorMessage} onReload={reload} />
    </div>
  );
}

function StatusLine({
  api,
  status,
  errorMessage,
  onReload,
}: {
  api: PluginApi;
  status: ReturnType<typeof useAutoSaveFile>["status"];
  errorMessage?: string;
  onReload: () => void;
}) {
  if (status === "conflict") {
    return (
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <api.ui.Banner message="File Changed On Disk" tone="error" />
        <api.ui.Link label="Reload" onClick={onReload} />
      </div>
    );
  }
  if (status === "error") {
    return <api.ui.Banner message={errorMessage ?? "Error"} tone="error" />;
  }
  const label = status === "saving" ? "Saving…" : status === "loading" ? "Loading…" : "Saved";
  return <div style={{ color: api.theme.palette.textMuted, fontSize: 12, marginTop: 4 }}>{label}</div>;
}
