import { useCallback, useEffect, useState } from "react";
import type { PluginApi } from "stewrd-plugin-api";
import type { ClaudeHome } from "../lib/claudeHome";
import type { SaveStatusDot } from "../lib/useSaveStatusDot";
import { AutoSaveEditor } from "./AutoSaveEditor";
import { scrollbarStyle } from "./scrollbarStyle";

const NAME_RE = /^[\w.-]+$/;

function nameError(name: string): string | null {
  if (!name) return "Enter A Name";
  if (/^\.+$/.test(name)) return "Invalid Name";
  if (!NAME_RE.test(name)) return "Only Letters, Numbers, Dots, Dashes And Underscores Are Allowed";
  return null;
}

function statusTemplate(displayName: string): string {
  return `---\nname: ${displayName}\ndescription: TODO\n---\n\n# ${displayName}\n`;
}

/** Rollout (list + "Create New") over a folder of flat *.md files
 * (Output Styles/Agents/Commands) or, with kind="skill", over
 * ~/.claude/skills/<name>/SKILL.md directories. */
export function FileListEditor({
  api,
  home,
  title,
  dirRelPath,
  kind,
  onStatusChange,
}: {
  api: PluginApi;
  home: ClaudeHome;
  title: string;
  dirRelPath: string;
  kind: "file" | "skill";
  onStatusChange?: (dot: SaveStatusDot) => void;
}) {
  const [entries, setEntries] = useState<string[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  const refresh = useCallback(() => {
    setListLoaded(false);
    home.listDir(dirRelPath, kind === "skill" ? "dir" : "file").then(
      (names) => {
        setEntries([...names].sort());
        setListLoaded(true);
      },
      () => setListLoaded(true),
    );
  }, [home, dirRelPath, kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (selected) {
    const relPath = kind === "skill" ? `${dirRelPath}/${selected}/SKILL.md` : `${dirRelPath}/${selected}`;
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
        <api.ui.Link label="← Back" onClick={() => setSelected(null)} />
        {/* display:flex is load-bearing: AutoSaveEditor's flex:1 (and so
            CodeTextArea's height:100%) is ignored under a block parent, which
            let the editor grow to its content height and overflow the pane. */}
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, marginTop: 8, display: "flex" }}>
          <AutoSaveEditor api={api} home={home} relPath={relPath} language="markdown" onStatusChange={onStatusChange} />
        </div>
      </div>
    );
  }

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
          setNewName("");
          refresh();
          setSelected(trimmed);
        } else if (result.status === "exists") {
          setCreateError("Already Exists");
        } else {
          setCreateError(result.message ?? "Create Failed");
        }
      });
    } else {
      const filename = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
      const displayName = filename.replace(/\.md$/i, "");
      home.createFile(`${dirRelPath}/${filename}`, statusTemplate(displayName)).then((result) => {
        setCreating(false);
        if (result.status === "ok") {
          setNewName("");
          refresh();
          setSelected(filename);
        } else if (result.status === "exists") {
          setCreateError("Already Exists");
        } else {
          setCreateError(result.message ?? "Create Failed");
        }
      });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: "auto",
        overflowWrap: "anywhere",
        ...scrollbarStyle(api.theme.palette),
      }}
    >
      <h3 style={{ color: api.theme.palette.text }}>{title}</h3>
      {!listLoaded && <api.ui.Skeleton height={100} width="100%" />}
      {listLoaded &&
        entries.map((name) => (
          <api.ui.TextButton key={name} label={name} variant="secondary" onClick={() => setSelected(name)} />
        ))}
      {listLoaded && entries.length === 0 && (
        <p style={{ color: api.theme.palette.textMuted }}>None Found</p>
      )}
      {/* flexWrap + the minWidth:0 TextBox wrapper: the textarea's intrinsic
          (cols-based) width would otherwise set this row's minimum width. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
        <div style={{ flex: "1 1 120px", minWidth: 0 }}>
          <api.ui.TextBox value={newName} onChange={setNewName} placeholder="New Name" readOnly={creating} />
        </div>
        <api.ui.TextButton label="Create New" variant="primary" onClick={handleCreate} disabled={creating} />
      </div>
      {createError && <api.ui.Banner message={createError} tone="error" onDismiss={() => setCreateError(undefined)} />}
    </div>
  );
}
