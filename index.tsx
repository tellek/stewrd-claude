/// <reference path="./.stewrd/plugin-api.d.ts" />
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PluginApi, PluginContext, StatusColor } from "stewrd-plugin-api";
import { createClaudeHome, type ClaudeHome } from "./lib/claudeHome";
import { DEFAULT_PLUGIN_PATHS, loadPluginPaths, type PluginPaths } from "./lib/pluginPaths";
import { IDLE_AFTER_SUCCESS_MS, IDLE_DOT, type SaveStatusDot } from "./lib/useSaveStatusDot";
import { AutoSaveEditor } from "./components/AutoSaveEditor";
import { FileListEditor } from "./components/FileListEditor";
import { scrollbarStyle } from "./components/scrollbarStyle";
import { GLOBAL_SCOPE_ID, resolveScope, scopeLabel } from "./lib/scope";
import { directoryExists, discoverProjects } from "./lib/projects";

type TabId = "rules" | "settings" | "output-styles" | "agents" | "skills" | "commands";

const TABS: { id: TabId; label: string }[] = [
  { id: "rules", label: "Rules" },
  { id: "settings", label: "Settings" },
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

/** Selected scope (Global or a targeted project path) plus the targeted
 * project list. Module-level for the same reason as tabStore. The snapshot is
 * replaced (never mutated) so useSyncExternalStore sees changes. */
interface ScopeState {
  selected: string;
  projects: string[];
}
let scopeState: ScopeState = { selected: GLOBAL_SCOPE_ID, projects: [] };
const scopeListeners = new Set<() => void>();
const scopeStore = {
  get: () => scopeState,
  set(next: ScopeState) {
    scopeState = next;
    scopeListeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    scopeListeners.add(fn);
    return () => scopeListeners.delete(fn);
  },
};

const PROJECTS_KEY = "targetedProjects";

/** Module-level for the same reason as tabStore: the sidebar sub-items (and
 * their per-tab save-status dot colors) outlive any one mounted Component,
 * and ctx is only handed to activate(). */
let activeCtx: PluginContext | null = null;
const tabColors: Record<string, StatusColor> = {}; // keyed `${scope}:${tab}`

const SEVERITY: StatusColor[] = ["idle", "success", "in-progress", "warning", "error"];

function worstColor(colors: StatusColor[]): StatusColor {
  return colors.reduce<StatusColor>((w, c) => (SEVERITY.indexOf(c) > SEVERITY.indexOf(w) ? c : w), "idle");
}

function scopeColor(scopeId: string): StatusColor {
  return worstColor(TABS.map((t) => tabColors[`${scopeId}:${t.id}`] ?? "idle"));
}

function selectScope(scopeId: string) {
  const ctx = activeCtx;
  scopeStore.set({ ...scopeState, selected: scopeId });
  if (ctx && !ctx.signal.aborted) ctx.api.sidebar.setSelected(scopeId);
}

function publishSidebarItems() {
  const ctx = activeCtx;
  if (!ctx || ctx.signal.aborted) return;
  const { projects } = scopeState;
  // Global is only a sub-item while at least one project is targeted.
  const ids = projects.length === 0 ? [] : [GLOBAL_SCOPE_ID, ...projects];
  ctx.api.sidebar.setItems(
    ids.map((id) => ({
      id,
      label: scopeLabel(id),
      color: scopeColor(id),
      onClick: () => selectScope(id),
    })),
  );
  ctx.api.statusIcon.set(worstColor(Object.values(tabColors)));
}

// Sidebar success dots revert to idle IDLE_AFTER_SUCCESS_MS after success, but
// only while the window has focus and this plugin's pane is mounted; leaving
// either pauses the countdown and returning restarts it.
const successTimers = new Map<string, ReturnType<typeof setTimeout>>();
let paneMounted = false;

function armSuccessTimers() {
  if (!paneMounted || !document.hasFocus()) return;
  for (const key of Object.keys(tabColors)) {
    if (tabColors[key] !== "success" || successTimers.has(key)) continue;
    successTimers.set(
      key,
      setTimeout(() => {
        successTimers.delete(key);
        if (tabColors[key] !== "success") return;
        tabColors[key] = "idle";
        publishSidebarItems();
      }, IDLE_AFTER_SUCCESS_MS),
    );
  }
}

function pauseSuccessTimers() {
  successTimers.forEach(clearTimeout);
  successTimers.clear();
}

function setTabColor(scopeId: string, tab: TabId, color: StatusColor) {
  const key = `${scopeId}:${tab}`;
  const current = tabColors[key] ?? "idle";
  // Only the countdown above (or a newer non-idle status) clears success, so an
  // editor unmounting on a plugin switch can't cut the 3s short.
  if (color === "idle" && current === "success") return;
  if (current === color) return;
  tabColors[key] = color;
  publishSidebarItems();
  if (color === "success") armSuccessTimers();
}

async function persistProjects(projects: string[]) {
  const ctx = activeCtx;
  if (ctx && !ctx.signal.aborted) await ctx.api.storage.set(PROJECTS_KEY, projects);
}

async function addProject(path: string) {
  const project = path.trim().replace(/[\\/]+$/, "");
  if (!project) return;
  const projects = scopeState.projects.includes(project) ? scopeState.projects : [...scopeState.projects, project];
  scopeStore.set({ selected: project, projects });
  publishSidebarItems();
  selectScope(project);
  await persistProjects(projects);
}

async function removeProject(project: string) {
  const projects = scopeState.projects.filter((p) => p !== project);
  for (const key of Object.keys(tabColors)) if (key.startsWith(`${project}:`)) delete tabColors[key];
  const selected = scopeState.selected === project ? GLOBAL_SCOPE_ID : scopeState.selected;
  scopeStore.set({ selected, projects });
  publishSidebarItems();
  selectScope(selected);
  await persistProjects(projects);
}

export async function activate(ctx: PluginContext) {
  if (ctx.signal.aborted) return;
  activeCtx = ctx;
  ctx.api.statusIcon.set("idle");
  const stored = (await ctx.api.storage.get<string[]>(PROJECTS_KEY)) ?? [];
  if (ctx.signal.aborted) return;
  scopeStore.set({ selected: stored.includes(scopeState.selected) ? scopeState.selected : GLOBAL_SCOPE_ID, projects: stored });
  publishSidebarItems();
  ctx.api.sidebar.setSelected(scopeState.selected);
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
  const { selected: scopeId, projects } = useSyncExternalStore(scopeStore.subscribe, scopeStore.get);
  const scope = useMemo(() => resolveScope(scopeId), [scopeId]);
  // One immutable home per scope keeps its mtime cache and unmount flush tied
  // to the right folder.
  const home: ClaudeHome = useMemo(() => createClaudeHome(api, scope.base), [api, scope.base]);
  const [paths, setPaths] = useState<PluginPaths>(DEFAULT_PLUGIN_PATHS);
  const [targetOpen, setTargetOpen] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [manualPath, setManualPath] = useState("");
  const [targetError, setTargetError] = useState<string | null>(null);
  // Each dot is tagged with the tab whose editor reported it, so the outgoing
  // editor's unmount-time IDLE report (or a stale dot from the previous tab)
  // is never attributed to the newly active tab.
  const [reported, setReported] = useState<{ scopeId: string; tab: TabId; dot: SaveStatusDot }>({ scopeId, tab, dot: IDLE_DOT });
  const dot = reported.scopeId === scopeId && reported.tab === tab ? reported.dot : IDLE_DOT;
  // Mirrors to the sidebar immediately, not through a useEffect over this
  // batched state - React batches an outgoing tab's unmount cleanup together
  // with an incoming tab's mount effect in the same commit, so an effect
  // watching `reported` would only ever see the last write and silently drop
  // the outgoing tab's own IDLE_DOT report (leaving its sidebar dot stuck
  // green). setTabColor works off the module-level activeCtx, so it's safe
  // to call here even while the calling component is mid-unmount.
  const setDot = (d: SaveStatusDot) => {
    setReported({ scopeId, tab, dot: d });
    setTabColor(scopeId, tab, d.color);
  };
  const [loadDrawerOpen, setLoadDrawerOpen] = useState(false);

  useEffect(() => {
    setLoadDrawerOpen(false);
  }, [tab, scopeId]);

  useEffect(() => {
    paneMounted = true;
    armSuccessTimers();
    window.addEventListener("focus", armSuccessTimers);
    window.addEventListener("blur", pauseSuccessTimers);
    return () => {
      paneMounted = false;
      pauseSuccessTimers();
      window.removeEventListener("focus", armSuccessTimers);
      window.removeEventListener("blur", pauseSuccessTimers);
    };
  }, []);

  useEffect(() => {
    if (!targetOpen) return;
    let cancelled = false;
    discoverProjects(api).then((found) => {
      if (!cancelled) setCandidates(found);
    });
    return () => {
      cancelled = true;
    };
  }, [api, targetOpen]);

  const targetProject = async (path: string) => {
    if (!path.trim()) return;
    if (!(await directoryExists(api, path.trim()))) {
      setTargetError("Folder Not Found");
      return;
    }
    setTargetError(null);
    setManualPath("");
    setTargetOpen(false);
    await addProject(path);
  };

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
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ flex: 1, minWidth: 0, color: api.theme.palette.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {scopeId === GLOBAL_SCOPE_ID ? "Global" : scopeId}
        </span>
        {scopeId !== GLOBAL_SCOPE_ID && <api.ui.TextButton label="Remove Project" onClick={() => removeProject(scopeId)} />}
        <api.ui.TextButton label="Target Project" onClick={() => setTargetOpen((o) => !o)} />
      </div>
      {targetOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <api.ui.Dropdown
            options={candidates.filter((c) => !projects.includes(c)).map((c) => ({ label: c, value: c }))}
            value=""
            placeholder="Recent Projects"
            onChange={targetProject}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <api.ui.TextBox value={manualPath} onChange={setManualPath} placeholder="Or Enter A Project Folder Path" rows={1} />
            </div>
            <api.ui.TextButton label="Add" variant="primary" onClick={() => targetProject(manualPath)} />
          </div>
          {targetError && <span style={{ color: api.theme.palette.status.error }}>{targetError}</span>}
        </div>
      )}
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
      <div key={scopeId} style={{ flex: 1, minHeight: 0, minWidth: 0, marginTop: 12, display: "flex" }}>
        {tab === "rules" && (
          <AutoSaveEditor
            api={api}
            home={home}
            relPath={scope.rulesRelPath ?? paths.claudeMdPath}
            storageScope={scope.storageScope}
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
            storageScope={scope.storageScope}
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
            storageScope={scope.storageScope}
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
            storageScope={scope.storageScope}
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
            storageScope={scope.storageScope}
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
            storageScope={scope.storageScope}
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
