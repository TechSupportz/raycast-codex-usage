import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { parseCodexHomePaths } from "./providers/codex-home-paths.ts";

test("CODEX_HOME paths expand, label, and deduplicate", () => {
  assert.deepEqual(parseCodexHomePaths("~/.codex, School=~/.codex-school, Duplicate=~/.codex"), [
    { label: "Duplicate", home: `${homedir()}/.codex` },
    { label: "School", home: `${homedir()}/.codex-school` },
  ]);
});
