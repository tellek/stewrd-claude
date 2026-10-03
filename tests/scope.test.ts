import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_SCOPE_ID, resolveScope, scopeLabel } from "../lib/scope.ts";

test("global scope uses the default base and unprefixed storage keys", () => {
  assert.deepEqual(resolveScope(GLOBAL_SCOPE_ID), { base: "", rulesRelPath: null, storageScope: "" });
});

test("project scope points at <project>/.claude with rules one level up", () => {
  const s = resolveScope("C:\\git\\app\\");
  assert.equal(s.base, "C:\\git\\app\\.claude");
  assert.equal(s.rulesRelPath, "../CLAUDE.md");
  assert.equal(s.storageScope, "project:C:\\git\\app:");
});

test("labels use the folder name", () => {
  assert.equal(scopeLabel(GLOBAL_SCOPE_ID), "Global");
  assert.equal(scopeLabel("C:\\git\\stewrd-claude"), "stewrd-claude");
});
