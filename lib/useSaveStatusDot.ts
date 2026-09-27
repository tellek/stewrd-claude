import { useEffect, useRef, useState } from "react";
import type { StatusColor } from "stewrd-plugin-api";
import type { SaveStatus } from "./useAutoSaveFile";

export interface SaveStatusDot {
  color: StatusColor;
  tooltip: string;
  onClick?: () => void;
}

export const IDLE_DOT: SaveStatusDot = { color: "idle", tooltip: "Idle" };

const IDLE_AFTER_SUCCESS_MS = 5000;

/** Derives a top-right status dot from raw save status: in-progress while
 * saving, green on success (reverting to idle after 5s or whenever the
 * window regains focus - whichever comes first), red with a tooltip on
 * error/conflict. */
export function useSaveStatusDot(status: SaveStatus, errorMessage: string | undefined, onReload: () => void): SaveStatusDot {
  const [dot, setDot] = useState<SaveStatusDot>(IDLE_DOT);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (status === "saving") {
      setDot({ color: "in-progress", tooltip: "Saving…" });
    } else if (status === "saved") {
      setDot({ color: "success", tooltip: "Saved" });
      timerRef.current = setTimeout(() => setDot(IDLE_DOT), IDLE_AFTER_SUCCESS_MS);
    } else if (status === "conflict") {
      setDot({ color: "error", tooltip: "File Changed On Disk — Click To Reload", onClick: onReload });
    } else if (status === "error") {
      setDot({ color: "error", tooltip: errorMessage ?? "Save Error" });
    } else {
      setDot(IDLE_DOT);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, errorMessage]);

  useEffect(() => {
    const onFocus = () => {
      setDot((current) => (current.color === "success" ? IDLE_DOT : current));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return dot;
}
