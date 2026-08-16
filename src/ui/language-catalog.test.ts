import assert from "node:assert/strict";
import test from "node:test";
import { isHeavyLanguage, selectFileLanguage } from "./language-catalog.js";

test("selective language catalog falls back heavy grammars to text", () => {
  assert.equal(selectFileLanguage("src/main.cpp"), "text");
  assert.equal(selectFileLanguage("src/main.emacs-lisp"), "text");
  assert.equal(selectFileLanguage("src/runtime.wasm"), "text");
  assert.equal(selectFileLanguage("src/main.ts"), "typescript");
  assert.equal(isHeavyLanguage("cpp"), true);
  assert.equal(isHeavyLanguage("typescript"), false);
});

test("selective language catalog allows explicit heavy-language opt in", () => {
  const enabled = new Set(["cpp"]);
  assert.equal(selectFileLanguage("src/main.cpp", enabled), "cpp");
  assert.equal(selectFileLanguage("src/main.emacs-lisp", enabled), "text");
});
