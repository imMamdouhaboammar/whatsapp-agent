import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const forbidden = /(?:oxlint[-]disable|eslint[-]disable|@ts[-]ignore|@ts[-]expect-error|#\s*noqa\b|#\s*type:\s*ignore\b|as\s+unknown\s+as\b)/i;
const secret = /(?:AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/;

function scan(diff) {
  let path = "";
  let line = 0;
  let hunk = false;
  const findings = [];
  for (const text of diff.split("\n")) {
    if (text.startsWith("diff --git ")) {
      hunk = false;
      path = "";
    } else if (!hunk && text.startsWith("+++ ")) {
      path = text.slice(4);
    } else if (text.startsWith("@@ ")) {
      const match = /\+(\d+)(?:,\d+)? @@/.exec(text);
      if (!match) throw new Error("Unrecognized diff hunk");
      line = Number(match[1]);
      hunk = true;
    } else if (hunk && text.startsWith("+")) {
      const added = text.slice(1);
      if (!/\.(?:md|mdx)$/i.test(path) && !path.endsWith("/bun.lock") && forbidden.test(added)) findings.push({ path, line, reason: "forbidden suppression or cast" });
      if (secret.test(added)) findings.push({ path, line, reason: "potential secret (redacted)" });
      line++;
    } else if (hunk && text.startsWith(" ")) {
      line++;
    }
  }
  return findings;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Git diff failed; refusing to pass", { cause: result.error });
  return result.stdout;
}

function patch(line) {
  return "diff --git a/tests/example.ts b/tests/example.ts\n+++ b/tests/example.ts\n@@ -0,0 +1 @@\n+" + line;
}

if (process.argv[2] === "self-test") {
  for (const marker of [
    ["// oxlint", "disable"].join("-"),
    ["// eslint", "disable-next-line"].join("-"),
    ["// @ts", "ignore"].join("-"),
    ["// @ts", "expect-error"].join("-"),
    ["# ", "noqa"].join(""),
    ["# type: ", "ignore"].join(""),
    ["value as ", "unknown as Foo"].join(""),
    ["ghp", "_", "A".repeat(36)].join(""),
  ]) assert.equal(scan(patch(marker)).length, 1);
  assert.deepEqual(scan(patch("const value: unknown = input;")), []);
  assert.deepEqual(scan("diff --git a/x b/x\n+++ b/x\n@@ -1 +0,0 @@\n-" + ["// @ts", "ignore"].join("-")), []);
  console.log("Quality guard self-test: 10 assertions passed");
} else {
  const [mode, base, head] = process.argv.slice(2);
  const common = ["diff", "--no-ext-diff", "--no-textconv", "--unified=0", "--no-color", "--find-renames"];
  const revisions = mode === "staged" ? ["--cached"] : mode === "range" && base && head ? [git(["merge-base", base, head]).trim(), head] : null;
  if (!revisions) throw new Error("Usage: quality-guard.mjs staged | range BASE HEAD | self-test");
  const paths = ["--", "."];
  const findings = scan(git([...common, ...revisions, ...paths]));
  for (const finding of findings) console.error(finding.path + ":" + finding.line + ": " + finding.reason);
  if (findings.length) process.exitCode = 1;
  else console.log("Quality guard: no newly added forbidden patterns");
}
