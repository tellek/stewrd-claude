/// <reference path="./.stewrd/plugin-api.d.ts" />
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PluginApi, PluginContext, StatusColor } from "stewrd-plugin-api";
import { createClaudeHome, type ClaudeHome } from "./lib/claudeHome";
import { DEFAULT_PLUGIN_PATHS, loadPluginPaths, type PluginPaths } from "./lib/pluginPaths";
import { IDLE_DOT, type SaveStatusDot } from "./lib/useSaveStatusDot";
import { AutoSaveEditor } from "./components/AutoSaveEditor";
import { FileListEditor } from "./components/FileListEditor";
import { scrollbarStyle } from "./components/scrollbarStyle";

type TabId = "rules" | "settings" | "output-styles" | "agents" | "skills" | "commands";

const TABS: { id: TabId; label: string }[] = [
  { id: "rules", label: "Global Rules" },
  { id: "settings", label: "Global Settings" },
  { id: "output-styles", label: "Output Styles" },
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "commands", label: "Commands" },
];

// Singular display name for the four file-list tabs (Load/Create dialogs,
// placeholder text). Rules/Settings aren't file-list tabs, so they're omitted.
const ITEM_LABELS: Partial<Record<TabId, string>> = {
  "output-styles": "Output Style",
  agents: "Agent",
  skills: "Skill",
  commands: "Command",
};

function isFileListTab(tab: TabId): boolean {
  return tab in ITEM_LABELS;
}

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

/** Module-level for the same reason as tabStore: the sidebar sub-items (and
 * their per-tab save-status dot colors) outlive any one mounted Component,
 * and ctx is only handed to activate(). */
let activeCtx: PluginContext | null = null;
const tabColors: Partial<Record<TabId, StatusColor>> = {};

function publishSidebarItems() {
  const ctx = activeCtx;
  if (!ctx || ctx.signal.aborted) return;
  ctx.api.sidebar.setItems(
    TABS.map((t) => ({
      id: t.id,
      label: t.label,
      color: tabColors[t.id] ?? "idle",
      onClick: () => {
        if (ctx.signal.aborted) return;
        tabStore.set(t.id);
        ctx.api.sidebar.setSelected(t.id);
      },
    })),
  );
}

function setTabColor(tab: TabId, color: StatusColor) {
  if (tabColors[tab] === color) return;
  tabColors[tab] = color;
  publishSidebarItems();
}

export function activate(ctx: PluginContext) {
  if (ctx.signal.aborted) return;
  activeCtx = ctx;
  ctx.api.statusIcon.set("idle");
  publishSidebarItems();
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
  // Each dot is tagged with the tab whose editor reported it, so the outgoing
  // editor's unmount-time IDLE report (or a stale dot from the previous tab)
  // is never attributed to the newly active tab.
  const [reported, setReported] = useState<{ tab: TabId; dot: SaveStatusDot }>({ tab, dot: IDLE_DOT });
  const dot = reported.tab === tab ? reported.dot : IDLE_DOT;
  // Mirrors to the sidebar immediately, not through a useEffect over this
  // batched state - React batches an outgoing tab's unmount cleanup together
  // with an incoming tab's mount effect in the same commit, so an effect
  // watching `reported` would only ever see the last write and silently drop
  // the outgoing tab's own IDLE_DOT report (leaving its sidebar dot stuck
  // green). setTabColor works off the module-level activeCtx, so it's safe
  // to call here even while the calling component is mid-unmount.
  const setDot = (d: SaveStatusDot) => {
    setReported({ tab, dot: d });
    setTabColor(tab, d.color);
  };
  const [loadDrawerOpen, setLoadDrawerOpen] = useState(false);

  useEffect(() => {
    setLoadDrawerOpen(false);
  }, [tab]);

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
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* api.ui.Tabs is a plain non-wrapping flex row; without minWidth:0 its
            min-content width (all tab buttons) would force this row, and the
            whole pane, wider than the container. It scrolls horizontally here
            instead, while the dot and Load button keep their size at the
            right edge (Load is the rightmost element). */}
        <div
          style={{
            display: "flex",
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            overflowY: "hidden",
            whiteSpace: "nowrap",
            ...scrollbarStyle(api.theme.palette),
          }}
        >
          <api.ui.Tabs tabs={TABS.map(({ id, label }) => ({ value: id, label }))} value={tab} onChange={setTab} />
        </div>
        <span title={dot.tooltip} onClick={dot.onClick} style={{ flexShrink: 0, cursor: dot.onClick ? "pointer" : "default" }}>
          <api.ui.StatusDot color={dot.color} />
        </span>
        {isFileListTab(tab) && (
          <div style={{ flexShrink: 0 }}>
            <api.ui.TextButton label="Load" onClick={() => setLoadDrawerOpen(true)} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, marginTop: 12, display: "flex" }}>
        {tab === "rules" && (
          <AutoSaveEditor
            api={api}
            home={home}
            relPath={paths.claudeMdPath}
            language="markdown"
            debounceMs={paths.saveDelayMs}
            onStatusChange={setDot}
          />
        )}
        {tab === "settings" && (
          <AutoSaveEditor
            api={api}
            home={home}
            relPath={paths.settingsJsonPath}
            language="json"
            debounceMs={paths.saveDelayMs}
            validate={jsonValidate}
            onStatusChange={setDot}
          />
        )}
        {tab === "output-styles" && (
          <FileListEditor
            api={api}
            home={home}
            title="Output Styles"
            itemLabel={ITEM_LABELS["output-styles"]!}
            dirRelPath={paths.outputStylesDir}
            disabledDirRelPath={`${paths.outputStylesDir}-disabled`}
            kind="file"
            drawerOpen={loadDrawerOpen}
            onDrawerOpenChange={setLoadDrawerOpen}
            debounceMs={paths.saveDelayMs}
            onStatusChange={setDot}
          />
        )}
        {tab === "agents" && (
          <FileListEditor
            api={api}
            home={home}
            title="Agents"
            itemLabel={ITEM_LABELS.agents!}
            dirRelPath={paths.agentsDir}
            disabledDirRelPath={`${paths.agentsDir}-disabled`}
            kind="file"
            drawerOpen={loadDrawerOpen}
            onDrawerOpenChange={setLoadDrawerOpen}
            debounceMs={paths.saveDelayMs}
            onStatusChange={setDot}
          />
        )}
        {tab === "commands" && (
          <FileListEditor
            api={api}
            home={home}
            title="Commands"
            itemLabel={ITEM_LABELS.commands!}
            dirRelPath={paths.commandsDir}
            disabledDirRelPath={`${paths.commandsDir}-disabled`}
            kind="file"
            drawerOpen={loadDrawerOpen}
            onDrawerOpenChange={setLoadDrawerOpen}
            debounceMs={paths.saveDelayMs}
            onStatusChange={setDot}
          />
        )}
        {tab === "skills" && (
          <FileListEditor
            api={api}
            home={home}
            title="Skills"
            itemLabel={ITEM_LABELS.skills!}
            dirRelPath={paths.skillsDir}
            disabledDirRelPath={`${paths.skillsDir}-disabled`}
            kind="skill"
            drawerOpen={loadDrawerOpen}
            onDrawerOpenChange={setLoadDrawerOpen}
            debounceMs={paths.saveDelayMs}
            onStatusChange={setDot}
          />
        )}
      </div>
    </div>
  );
}
