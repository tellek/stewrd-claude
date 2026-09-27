import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeHome } from "./claudeHome";

export type SaveStatus = "loading" | "saved" | "saving" | "error" | "conflict";

export interface UseAutoSaveFileResult {
  text: string;
  setText: (text: string) => void;
  loaded: boolean;
  status: SaveStatus;
  errorMessage?: string;
  reload: () => void;
  loadGeneration: number;
}

interface LoadedState {
  path: string;
  gen: number;
  text: string;
  lastSaved: string;
  crlf: boolean;
  bom: boolean;
  loaded: boolean;
}

const DEBOUNCE_MS = 600;

/** Auto-saving buffer for a single ~/.claude file. Owns {path, text, loaded,
 * loadGeneration} as one unit: switching `relPath` (or calling `reload`)
 * flushes any pending edit against the file being left (via the effect
 * cleanup below, which runs before the next load starts) rather than
 * dropping it, then starts a fresh load. `claudeHome` itself is the source
 * of truth for concurrency/mtime bookkeeping - this hook only decides *when*
 * to call readFile/writeFile and renders the resulting status. */
export function useAutoSaveFile(
  home: ClaudeHome,
  relPath: string,
  validate?: (text: string) => string | null,
): UseAutoSaveFileResult {
  const [text, setTextState] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);

  const current = useRef<LoadedState>({ path: relPath, gen: reloadTick, text: "", lastSaved: "", crlf: false, bom: false, loaded: false });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const path = relPath;
    const gen = reloadTick;
    let cancelled = false;

    current.current = { path, gen, text: "", lastSaved: "", crlf: false, bom: false, loaded: false };
    setTextState("");
    setLoaded(false);
    setStatus("loading");
    setErrorMessage(undefined);

    home.readFile(path).then(
      (result) => {
        if (cancelled) return;
        current.current = { path, gen, text: result.text, lastSaved: result.text, crlf: result.crlf, bom: result.bom, loaded: true };
        setTextState(result.text);
        setLoaded(true);
        setStatus("saved");
      },
      (err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(String((err as Error)?.message ?? err));
      },
    );

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const snap = current.current;
      if (snap.path === path && snap.gen === gen && snap.loaded && snap.text !== snap.lastSaved) {
        // Fire-and-forget: nothing here still cares about the UI-facing
        // result, but claudeHome's own per-path queue/mtime tracking makes
        // the write itself correct regardless.
        home.writeFile(path, snap.text, { crlf: snap.crlf, bom: snap.bom }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, relPath, reloadTick]);

  const setText = useCallback(
    (newText: string) => {
      current.current.text = newText;
      setTextState(newText);
      if (!current.current.loaded) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      const path = current.current.path;
      const gen = current.current.gen;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const snap = current.current;
        if (snap.path !== path || snap.gen !== gen) return;
        if (snap.text === snap.lastSaved) return;

        if (validate) {
          const validationError = validate(snap.text);
          if (validationError) {
            setStatus("error");
            setErrorMessage(validationError);
            return;
          }
        }

        setStatus("saving");
        home.writeFile(path, snap.text, { crlf: snap.crlf, bom: snap.bom }).then(
          (result) => {
            if (current.current.path !== path || current.current.gen !== gen) return;
            if (result.status === "ok") {
              current.current.lastSaved = snap.text;
              setStatus("saved");
              setErrorMessage(undefined);
            } else if (result.status === "conflict") {
              setStatus("conflict");
            } else {
              setStatus("error");
              setErrorMessage(result.message ?? "Save Failed");
            }
          },
          (err) => {
            if (current.current.path !== path || current.current.gen !== gen) return;
            setStatus("error");
            setErrorMessage(String((err as Error)?.message ?? err));
          },
        );
      }, DEBOUNCE_MS);
    },
    [home, validate],
  );

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  return { text, setText, loaded, status, errorMessage, reload, loadGeneration: reloadTick };
}
