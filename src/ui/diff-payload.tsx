import { memo, useMemo } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import { pierrePrettyScrollbarCss } from "./scrollbar.js";

interface DiffPayloadProps {
  patch: string;
  themeType: "light" | "dark";
}

export const DiffPayload = memo(function DiffPayload({ patch, themeType }: DiffPayloadProps) {
  const options = useMemo(() => ({
    theme: { light: "pierre-light", dark: "pierre-dark" },
    themeType,
    diffStyle: "unified" as const,
    diffIndicators: "bars" as const,
    hunkSeparators: "line-info" as const,
    lineDiffType: "word-alt" as const,
    overflow: "scroll" as const,
    unsafeCSS: pierrePrettyScrollbarCss,
    collapsedContextThreshold: 4,
    expansionLineCount: 20,
    stickyHeader: true,
    disableFileHeader: true,
  }), [themeType]);

  return <PatchDiff patch={patch} options={options} className="pierre-diff pretty-scrollbar" />;
});
