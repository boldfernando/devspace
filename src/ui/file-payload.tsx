import { useEffect, useMemo, useRef } from "react";
import { FileStream, getFiletypeFromFileName, type FileStreamOptions } from "@pierre/diffs";
import type { HostContext } from "./card-types.js";
import { pierrePrettyScrollbarCss } from "./scrollbar.js";

export function FilePayload({ path, text, startLine, themeType }: { path: string; text: string; startLine: number; themeType: "light" | "dark"; }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fileOptions: FileStreamOptions = useMemo(() => ({ theme: { light: "pierre-light", dark: "pierre-dark" }, themeType, overflow: "scroll", unsafeCSS: pierrePrettyScrollbarCss }), [themeType]);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fileStream = new FileStream({ ...fileOptions, lang: getFiletypeFromFileName(path), startingLineIndex: startLine });
    const source = new ReadableStream<string>({ start(controller) { controller.enqueue(text); controller.close(); } });
    let disposed = false;
    void fileStream.setup(source, wrapper).then(() => { if (!disposed) return; fileStream.cleanUp(); wrapper.replaceChildren(); });
    return () => { disposed = true; fileStream.cleanUp(); wrapper.replaceChildren(); };
  }, [fileOptions, path, startLine, text]);
  return <div ref={wrapperRef} className="pierre-file pretty-scrollbar" />;
}
