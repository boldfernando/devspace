import { PatchDiff } from "@pierre/diffs/react";
import { pierrePrettyScrollbarCss } from "./scrollbar.js";

export function DiffPayload({ patch, themeType }: { patch: string; themeType: "light" | "dark"; }) {
  return <PatchDiff patch={patch} options={{ theme: { light: "pierre-light", dark: "pierre-dark" }, themeType, diffStyle: "unified", diffIndicators: "bars", hunkSeparators: "line-info", lineDiffType: "word-alt", overflow: "scroll", unsafeCSS: pierrePrettyScrollbarCss, collapsedContextThreshold: 4, expansionLineCount: 20, stickyHeader: true, disableFileHeader: true }} className="pierre-diff pretty-scrollbar" />;
}
