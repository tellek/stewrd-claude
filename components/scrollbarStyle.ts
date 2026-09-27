import type { CSSProperties } from "react";
import type { PluginApi } from "stewrd-plugin-api";

/** Palette-driven scrollbar for a plugin-owned scrollable element - copied
 * from plugins/_template/demos/TextAreaDemo.tsx (see it for the reasoning:
 * standard scrollbar-color/-width beats ::-webkit-scrollbar-* since those
 * are pseudo-elements and can't be expressed as an inline style object). */
export function scrollbarStyle(palette: PluginApi["theme"]["palette"]): CSSProperties {
  return { scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` };
}
