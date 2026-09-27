import { useCallback, useEffect, useState } from "react";
import type { PluginApi } from "stewrd-plugin-api";
import type { ClaudeHome } from "../lib/claudeHome";
import type { SaveStatusDot } from "../lib/useSaveStatusDot";
import { AutoSaveEditor } from "./AutoSaveEditor";
import { scrollbarStyle } from "./scrollbarStyle";
import trashIcon from "../assets/trash.png";
import renameIcon from "../assets/rename.png";

const NAME_RE = /^[\w.-]+$/;

interface Entry {
  name: string;
  enabled: boolean;
}

function entryKey(e: Entry): string {
  return `${e.enabled}:${e.name}`;
}

function nameError(name: string): string | null {
  if (!name) return "Enter A Name";
  if (/^\.+$/.test(name)) return "Invalid Name";
  if (!NAME_RE.test(name)) return "Only Letters, Numbers, Dots, Dashes And Underscores Are Allowed";
  return null;
}

function statusTemplate(displayName: string): string {
  return `---\nname: ${displayName}\ndescription: TODO\n---\n\n# ${displayName}\n`;
}

// Flat-file display names never carry the .md extension; this normalizes a
// user-entered name back to the on-disk filename. Shared by create and
// rename so they can't diverge.
function toFilename(displayName: string): string {
  return displayName.toLowerCase().endsWith(".md") ? displayName : `${displayName}.md`;
}

function toDisplayName(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

/** List (in a Drawer) + editor over a folder of flat *.md files
 * (Output Styles/Agents/Commands) or, with kind="skill", over
 * ~/.claude/skills/<name>/SKILL.md directories. "Disabled" entries live in a
 * sibling `${dirRelPath}-disabled` folder (Claude Code has no native
 * enable/disable flag - moving a file/dir out of the folder it scans is the
 * only way to make it inactive without deleting it). The drawer is
 * controlled by the parent (opened via the "Load" button next to the tab
 * row) so it's the sole way to pick/create/rename/enable/delete an entry. */
export function FileListEditor({
  api,
  home,
  title,
  itemLabel,
  dirRelPath,
  disabledDirRelPath,
  kind,
  drawerOpen,
  onDrawerOpenChange,
  onStatusChange,
}: {
  api: PluginApi;
  home: ClaudeHome;
  title: string;
  itemLabel: string;
  dirRelPath: string;
  disabledDirRelPath: string;
  kind: "file" | "skill";
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  onStatusChange?: (dot: SaveStatusDot) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [selectedDirty, setSelectedDirty] = useState(false);
  const [pendingOp, setPendingOp] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  const [renameTarget, setRenameTarget] = useState<Entry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);

  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const [banner, setBanner] = useState<string | undefined>(undefined);

  const dirOf = useCallback((enabled: boolean) => (enabled ? dirRelPath : disabledDirRelPath), [dirRelPath, disabledDirRelPath]);

  const relPathOf = useCallback(
    (e: Entry) => (kind === "skill" ? `${dirOf(e.enabled)}/${e.name}/SKILL.md` : `${dirOf(e.enabled)}/${e.name}`),
    [dirOf, kind],
  );

  const refresh = useCallback(() => {
    setListLoaded(false);
    const listKind = kind === "skill" ? "dir" : "file";
    Promise.all([
      home.listDir(dirRelPath, listKind).catch(() => [] as string[]),
      home.listDir(disabledDirRelPath, listKind).catch(() => [] as string[]),
    ]).then(([activeNames, disabledNames]) => {
      const merged: Entry[] = [
        ...activeNames.map((name) => ({ name, enabled: true })),
        ...disabledNames.map((name) => ({ name, enabled: false })),
      ].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
      setEntries(merged);
      setListLoaded(true);
    });
  }, [home, dirRelPath, disabledDirRelPath, kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const withPending = useCallback(async (key: string, fn: () => Promise<void>) => {
    setPendingOp((prev) => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      setPendingOp((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const openCreate = () => {
    setNewName("");
    setCreateError(undefined);
    setCreateOpen(true);
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    const err = nameError(trimmed);
    if (err) {
      setCreateError(err);
      return;
    }
    setCreating(true);
    setCreateError(undefined);

    if (kind === "skill") {
      home.createSkill(dirRelPath, trimmed, statusTemplate(trimmed)).then((result) => {
        setCreating(false);
        if (result.status === "ok") {
          setCreateOpen(false);
          refresh();
          setSelected({ name: trimmed, enabled: true });
          onDrawerOpenChange(false);
        } else if (result.status === "exists") {
          setCreateError("Already Exists");
        } else {
          setCreateError(result.message ?? "Create Failed");
        }
      });
    } else {
      const filename = toFilename(trimmed);
      const displayName = toDisplayName(filename);
      home.createFile(`${dirRelPath}/${filename}`, statusTemplate(displayName)).then((result) => {
        setCreating(false);
        if (result.status === "ok") {
          setCreateOpen(false);
          refresh();
          setSelected({ name: filename, enabled: true });
          onDrawerOpenChange(false);
        } else if (result.status === "exists") {
          setCreateError("Already Exists");
        } else {
          setCreateError(result.message ?? "Create Failed");
        }
      });
    }
  };

  const openRename = (entry: Entry) => {
    setRenameTarget(entry);
    setRenameName(kind === "file" ? toDisplayName(entry.name) : entry.name);
    setRenameError(undefined);
  };

  const handleRename = () => {
    const target = renameTarget;
    if (!target) return;
    const trimmed = renameName.trim();
    const err = nameError(trimmed);
    if (err) {
      setRenameError(err);
      return;
    }
    const newEntryName = kind === "file" ? toFilename(trimmed) : trimmed;
    if (newEntryName === target.name) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    setRenameError(undefined);
    const key = entryKey(target);
    withPending(key, async () => {
      const dir = dirOf(target.enabled);
      const fromMoveArg = `${dir}/${target.name}`;
      const toMoveArg = `${dir}/${newEntryName}`;
      const result = await home.renameEntry(fromMoveArg, toMoveArg, kind === "skill" ? "dir" : "file");
      setRenaming(false);
      if (result.status === "ok") {
        setRenameTarget(null);
        refresh();
        if (selected && entryKey(selected) === key) {
          setSelected({ name: newEntryName, enabled: target.enabled });
        }
      } else if (result.status === "exists") {
        setRenameError("Already Exists");
      } else {
        setRenameError(result.message ?? "Rename Failed");
      }
    });
  };

  const handleToggle = (entry: Entry) => {
    const key = entryKey(entry);
    if (pendingOp.has(key)) return;
    if (selected && entryKey(selected) === key && selectedDirty) return;
    withPending(key, async () => {
      const fromMoveArg = `${dirOf(entry.enabled)}/${entry.name}`;
      const toMoveArg = `${dirOf(!entry.enabled)}/${entry.name}`;
      const result = await home.renameEntry(fromMoveArg, toMoveArg, kind === "skill" ? "dir" : "file");
      if (result.status === "ok") {
        refresh();
        if (selected && entryKey(selected) === key) setSelected(null);
      } else if (result.status === "exists") {
        setBanner("Already Exists In Target Location — Rename First");
      } else {
        setBanner(result.message ?? "Move Failed");
      }
    });
  };

  const handleDeleteConfirmed = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const key = entryKey(target);
    withPending(key, async () => {
      const relPath = kind === "skill" ? `${dirOf(target.enabled)}/${target.name}` : relPathOf(target);
      const result = await home.deleteEntry(relPath, kind === "skill" ? "dir" : "file");
      if (result.status === "ok") {
        refresh();
        if (selected && entryKey(selected) === key) setSelected(null);
      } else {
        setBanner(result.message ?? "Delete Failed");
      }
    });
  };

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      {selected ? (
        <AutoSaveEditor
          api={api}
          home={home}
          relPath={relPathOf(selected)}
          language="markdown"
          onStatusChange={onStatusChange}
          onDirtyChange={setSelectedDirty}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: api.theme.palette.textMuted }}>
            Load {/^[aeiou]/i.test(itemLabel) ? "an" : "a"} {itemLabel.toLowerCase()} to continue.
          </p>
        </div>
      )}

      <api.ui.Drawer open={drawerOpen} onClose={() => onDrawerOpenChange(false)} side="right" size={400}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <h3 style={{ marginTop: 0, color: api.theme.palette.text }}>{title}</h3>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              ...scrollbarStyle(api.theme.palette),
            }}
          >
            {banner && <api.ui.Banner message={banner} tone="error" onDismiss={() => setBanner(undefined)} />}
            {!listLoaded && <api.ui.Skeleton height={100} width="100%" />}
            {listLoaded && entries.length === 0 && <p style={{ color: api.theme.palette.textMuted }}>None Found</p>}
            {listLoaded &&
              entries.map((entry) => {
                const key = entryKey(entry);
                const isSelected = selected !== null && entryKey(selected) === key;
                const rowBusy = pendingOp.has(key) || (isSelected && selectedDirty);
                const toggleTitle = isSelected && selectedDirty
                  ? "Save Pending — Finish Editing First"
                  : entry.enabled
                    ? "Click To Disable"
                    : "Click To Enable";
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      border: `1px solid ${api.theme.palette.border}`,
                      borderRadius: 6,
                      background: api.theme.palette.surface,
                      padding: "6px 8px",
                    }}
                  >
                    <div
                      style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" }}
                      title={entry.name}
                    >
                      <api.ui.TextButton
                        label={entry.name}
                        variant="secondary"
                        onClick={() => {
                          setSelected(entry);
                          onDrawerOpenChange(false);
                        }}
                      />
                    </div>
                    <div
                      title={toggleTitle}
                      style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <api.ui.Toggle checked={entry.enabled} onChange={() => handleToggle(entry)} disabled={rowBusy} />
                    </div>
                    <api.ui.IconButton icon={renameIcon} label="Rename" onClick={() => openRename(entry)} disabled={rowBusy} />
                    <api.ui.IconButton icon={trashIcon} label="Delete" onClick={() => setDeleteTarget(entry)} disabled={rowBusy} />
                  </div>
                );
              })}
          </div>
          <div style={{ marginTop: 8 }}>
            <api.ui.TextButton label={`Create New ${itemLabel}`} variant="primary" onClick={openCreate} />
          </div>
        </div>
      </api.ui.Drawer>

      <api.ui.InlineDialog open={createOpen} onClose={() => setCreateOpen(false)} title={`Create New ${itemLabel}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <api.ui.TextBox value={newName} onChange={setNewName} placeholder="Name" readOnly={creating} />
          {createError && <api.ui.Banner message={createError} tone="error" onDismiss={() => setCreateError(undefined)} />}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <api.ui.TextButton label="Cancel" onClick={() => setCreateOpen(false)} disabled={creating} />
            <api.ui.TextButton label="Ok" variant="primary" onClick={handleCreate} disabled={creating} />
          </div>
        </div>
      </api.ui.InlineDialog>

      <api.ui.InlineDialog open={renameTarget !== null} onClose={() => setRenameTarget(null)} title={`Rename ${itemLabel}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <api.ui.TextBox value={renameName} onChange={setRenameName} placeholder="Name" readOnly={renaming} />
          {renameError && <api.ui.Banner message={renameError} tone="error" onDismiss={() => setRenameError(undefined)} />}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <api.ui.TextButton label="Cancel" onClick={() => setRenameTarget(null)} disabled={renaming} />
            <api.ui.TextButton label="Ok" variant="primary" onClick={handleRename} disabled={renaming} />
          </div>
        </div>
      </api.ui.InlineDialog>

      <api.ui.InlineDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${itemLabel}`}
        message={`Delete "${deleteTarget?.name}"? This Cannot Be Undone.`}
      >
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <api.ui.TextButton label="Cancel" onClick={() => setDeleteTarget(null)} />
          <api.ui.TextButton label="Delete" variant="primary" onClick={handleDeleteConfirmed} />
        </div>
      </api.ui.InlineDialog>
    </div>
  );
}
