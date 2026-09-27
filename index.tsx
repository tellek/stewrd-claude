/// <reference path="./.stewrd/plugin-api.d.ts" />
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PluginApi, PluginContext } from "stewrd-plugin-api";
import { createClaudeHome, type ClaudeHome } from "./lib/claudeHome";
import { DEFAULT_PLUGIN_PATHS, loadPluginPaths, type PluginPaths } from "./lib/pluginPaths";
import { IDLE_DOT, type SaveStatusDot } from "./lib/useSaveStatusDot";
import { AutoSaveEditor } from "./components/AutoSaveEditor";
import { FileListEditor } from "./components/FileListEditor";

type TabId = "rules" | "settings" | "output-styles" | "agents" | "skills" | "commands";

const TABS: { id: TabId; label: string }[] = [
  { id: "rules", label: "Global Rules" },
  { id: "settings", label: "Global Settings" },
  { id: "output-styles", label: "Output Styles" },
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "commands", label: "Commands" },
];

/** Module-level, not component-state: sidebar sub-items are registered once
 * in activate() (see below) so they keep working across the many times this
 * plugin's Component mounts/unmounts within one activation - a Component-
 * scoped useEffect's onClick would go dead the moment that particular
 * mounted instance unmounts. Component reads the current tab via
 * useSyncExternalStore so a freshly (re)mounted instance always reflects
 * whichever tab was last clicked, even from the sidebar while unmounted. */
function createTabStore(initial: TabId) {
  let tab = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => tab,
    set(next: TabId) {
      tab = next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const tabStore = createTabStore("rules");

export function activate(ctx: PluginContext) {
  if (ctx.signal.aborted) return;
  ctx.api.statusIcon.set("idle");
  ctx.api.sidebar.setItems(
    TABS.map((t) => ({
      id: t.id,
      label: t.label,
      onClick: () => {
        if (ctx.signal.aborted) return;
        tabStore.set(t.id);
        ctx.api.sidebar.setSelected(t.id);
      },
    })),
  );
  ctx.api.sidebar.setSelected(tabStore.get());
}

export function deactivate() {}

function jsonValidate(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch {
    return "Invalid JSON — Not Saved";
  }
}

export function Component({ api }: { api: PluginApi }) {
  const tab = useSyncExternalStore(tabStore.subscribe, tabStore.get);
  const home: ClaudeHome = useMemo(() => createClaudeHome(api), [api]);
  const [paths, setPaths] = useState<PluginPaths>(DEFAULT_PLUGIN_PATHS);
  const [dot, setDot] = useState<SaveStatusDot>(IDLE_DOT);

  useEffect(() => {
    let cancelled = false;
    loadPluginPaths(api).then((loaded) => {
      if (!cancelled) setPaths(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const setTab = (next: string) => {
    tabStore.set(next as TabId);
    api.sidebar.setSelected(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <api.ui.Tabs tabs={TABS.map(({ id, label }) => ({ value: id, label }))} value={tab} onChange={setTab} />
        <span title={dot.tooltip} onClick={dot.onClick} style={{ cursor: dot.onClick ? "pointer" : "default" }}>
          <api.ui.StatusDot color={dot.color} />
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, marginTop: 12, display: "flex" }}>
        {tab === "rules" && (
          <AutoSaveEditor api={api} home={home} relPath={paths.claudeMdPath} language="markdown" onStatusChange={setDot} />
        )}
        {tab === "settings" && (
          <AutoSaveEditor
            api={api}
            home={home}
            relPath={paths.settingsJsonPath}
            language="json"
            validate={jsonValidate}
            onStatusChange={setDot}
          />
        )}
        {tab === "output-styles" && (
          <FileListEditor
            api={api}
            home={home}
            title="Output Styles"
            dirRelPath={paths.outputStylesDir}
            kind="file"
            onStatusChange={setDot}
          />
        )}
        {tab === "agents" && (
          <FileListEditor api={api} home={home} title="Agents" dirRelPath={paths.agentsDir} kind="file" onStatusChange={setDot} />
        )}
        {tab === "commands" && (
          <FileListEditor
            api={api}
            home={home}
            title="Commands"
            dirRelPath={paths.commandsDir}
            kind="file"
            onStatusChange={setDot}
          />
        )}
        {tab === "skills" && (
          <FileListEditor api={api} home={home} title="Skills" dirRelPath={paths.skillsDir} kind="skill" onStatusChange={setDot} />
        )}
      </div>
    </div>
  );
}
