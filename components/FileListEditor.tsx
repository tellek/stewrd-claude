import { useCallback, useEffect, useState } from "react";
import type { PluginApi } from "stewrd-plugin-api";
import type { ClaudeHome } from "../lib/claudeHome";
import { AutoSaveEditor } from "./AutoSaveEditor";

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
}: {
  api: PluginApi;
  home: ClaudeHome;
  title: string;
  dirRelPath: string;
  kind: "file" | "skill";
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
    const relPath = kind === "skill" ? `skills/${selected}/SKILL.md` : `${dirRelPath}/${selected}`;
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <api.ui.Link label="← Back" onClick={() => setSelected(null)} />
        <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
          <AutoSaveEditor api={api} home={home} relPath={relPath} language="markdown" />
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
      home.createSkill(trimmed, statusTemplate(trimmed)).then((result) => {
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
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
      <h3 style={{ color: api.theme.palette.text }}>{title}</h3>
      {!listLoaded && <api.ui.Skeleton height={100} width="100%" />}
      {listLoaded &&
        entries.map((name) => (
          <api.ui.TextButton key={name} label={name} variant="secondary" onClick={() => setSelected(name)} />
        ))}
      {listLoaded && entries.length === 0 && (
        <p style={{ color: api.theme.palette.textMuted }}>None Found</p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <api.ui.TextBox value={newName} onChange={setNewName} placeholder="New Name" readOnly={creating} />
        <api.ui.TextButton label="Create New" variant="primary" onClick={handleCreate} disabled={creating} />
      </div>
      {createError && <api.ui.Banner message={createError} tone="error" onDismiss={() => setCreateError(undefined)} />}
    </div>
  );
}
