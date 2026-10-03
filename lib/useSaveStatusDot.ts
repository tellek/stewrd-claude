import { useEffect, useRef, useState } from "react";
import type { StatusColor } from "stewrd-plugin-api";
import type { SaveStatus } from "./useAutoSaveFile";

export interface SaveStatusDot {
  color: StatusColor;
  tooltip: string;
  onClick?: () => void;
}

export const IDLE_DOT: SaveStatusDot = { color: "idle", tooltip: "Idle" };

export const IDLE_AFTER_SUCCESS_MS = 3000;

/** Derives a top-right status dot from raw save status: in-progress while
 * saving, success for 3s (the countdown only runs while the window has focus,
 * and restarts when focus returns; the pane being mounted means the plugin
 * has focus), warning with a click-to-reload tooltip on a conflict (needs
 * the user, but nothing is broken), error on a failed save. */
export function useSaveStatusDot(status: SaveStatus, errorMessage: string | undefined, onReload: () => void): SaveStatusDot {
  const [dot, setDot] = useState<SaveStatusDot>(IDLE_DOT);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (status === "saving") {
      setDot({ color: "in-progress", tooltip: "Saving…" });
    } else if (status === "saved") {
      setDot({ color: "success", tooltip: "Saved" });
      const start = () => {
        if (!timerRef.current) timerRef.current = setTimeout(() => setDot(IDLE_DOT), IDLE_AFTER_SUCCESS_MS);
      };
      const pause = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
      };
      if (document.hasFocus()) start();
      window.addEventListener("focus", start);
      window.addEventListener("blur", pause);
      cleanupRef.current = () => {
        window.removeEventListener("focus", start);
        window.removeEventListener("blur", pause);
      };
    } else if (status === "conflict") {
      setDot({ color: "warning", tooltip: "File Changed On Disk — Click To Reload", onClick: onReload });
    } else if (status === "error") {
      setDot({ color: "error", tooltip: errorMessage ?? "Save Error" });
    } else {
      setDot(IDLE_DOT);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, errorMessage]);

  return dot;
}
