// A "scope" is either the global ~/.claude or one targeted project. Pure so
// it can be unit tested without the plugin host.
export const GLOBAL_SCOPE_ID = "global";

export interface ResolvedScope {
  /** Absolute <project>/.claude, or "" for the global ~/.claude. */
  base: string;
  /** Rules file relative to base. Project rules live in <project>/CLAUDE.md, one level above base. */
  rulesRelPath: string | null;
  /** api.storage key prefix; empty for Global so pre-existing keys keep working. */
  storageScope: string;
}

export function resolveScope(scopeId: string): ResolvedScope {
  if (scopeId === GLOBAL_SCOPE_ID) return { base: "", rulesRelPath: null, storageScope: "" };
  const project = scopeId.replace(/[\\/]+$/, "");
  return { base: `${project}\\.claude`, rulesRelPath: "../CLAUDE.md", storageScope: `project:${project}:` };
}

export function scopeLabel(scopeId: string): string {
  if (scopeId === GLOBAL_SCOPE_ID) return "Global";
  const parts = scopeId.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? scopeId;
}
