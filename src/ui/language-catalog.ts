import { getFiletypeFromFileName, type SupportedLanguages } from "@pierre/diffs";

const HEAVY_LANGUAGES = new Set(["cpp", "objective-cpp", "emacs-lisp", "wasm"]);
const DEFAULT_ENABLED_HEAVY_LANGUAGES = new Set<SupportedLanguages>();

export function selectFileLanguage(path: string, enabledHeavyLanguages: ReadonlySet<SupportedLanguages> = DEFAULT_ENABLED_HEAVY_LANGUAGES): SupportedLanguages {
  const detected = getFiletypeFromFileName(path) as SupportedLanguages | undefined;
  if (!detected) return "text" as SupportedLanguages;
  if (HEAVY_LANGUAGES.has(detected) && !enabledHeavyLanguages.has(detected)) return "text" as SupportedLanguages;
  return detected;
}

export function isHeavyLanguage(language: string): boolean {
  return HEAVY_LANGUAGES.has(language);
}
