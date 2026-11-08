import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const auditScript = fileURLToPath(new URL("../scripts/security-audit.ts", import.meta.url));
const temporaryDirectories: string[] = [];

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function scanWithFakeScanner(stdout: string, scannerStatus = 0, explicitBinary = false) {
  const dir = mkdtempSync(join(tmpdir(), "whatsapp-osv-audit-"));
  temporaryDirectories.push(dir);
  const executable = join(dir, "osv-scanner");
  writeFileSync(
    executable,
    ["#!/bin/sh", "printf %s " + shellQuote(stdout), "exit " + scannerStatus, ""].join("\n"),
  );
  chmodSync(executable, 0o755);

  const result = spawnSync(process.execPath, [auditScript], {
    cwd: dir,
    env: { ...process.env, OSV_SCANNER_BIN: explicitBinary ? executable : "osv-scanner", PATH: dir + delimiter + (process.env.PATH ?? "") },
    encoding: "utf8",
    timeout: 10_000,
  });

  expect(result.error).toBeUndefined();
  return result;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("dependency security audit", () => {
  it("accepts a valid empty OSV report", () => {
    const result = scanWithFakeScanner(JSON.stringify({ results: [] }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Security audit passed");
  });

  it("can use an explicit scanner executable path without assuming the host PATH", () => {
    expect(scanWithFakeScanner(JSON.stringify({ results: [] }), 0, true).status).toBe(0);
  });

  it("fails closed if scanner returns empty stdout", () => {
    expect(scanWithFakeScanner("").status).not.toBe(0);
  });

  it("fails closed if scanner returns no JSON object", () => {
    expect(scanWithFakeScanner("an upstream proxy error").status).not.toBe(0);
  });

  it("fails closed if scanner returns malformed JSON", () => {
    expect(scanWithFakeScanner("{not valid json").status).not.toBe(0);
  });

  it("fails closed if scanner output is not a valid OSV results report", () => {
    expect(scanWithFakeScanner(JSON.stringify({ "experimental_config": {} })).status).not.toBe(0);
  });

  it("fails closed if scanner exits unsuccessfully despite clean JSON", () => {
    expect(scanWithFakeScanner(JSON.stringify({ results: [] }), 2).status).not.toBe(0);
  });

  it("detects HIGH severity labels", () => {
    const payload = { results: [{ packages: [{ package: { name: "synthetic", version: "1.0.0" }, vulnerabilities: [{ id: "GHSA-TEST-HIGH", database_specific: { severity: "HIGH" } }] }] }] };
    expect(scanWithFakeScanner(JSON.stringify(payload)).status).not.toBe(0);
  });

  it("detects numeric CVSS scores at the 7.0 boundary", () => {
    const payload = { results: [{ packages: [{ package: { name: "synthetic", version: "1.0.0" }, vulnerabilities: [{ id: "GHSA-TEST-CVSS", severity: [{ type: "CVSS_V3", score: "7.0" }] }] }] }] };
    expect(scanWithFakeScanner(JSON.stringify(payload)).status).not.toBe(0);
  });

  it("permits a known moderate severity with an otherwise valid report", () => {
    const payload = { results: [{ packages: [{ package: { name: "synthetic", version: "1.0.0" }, vulnerabilities: [{ id: "GHSA-TEST-MODERATE", database_specific: { severity: "MODERATE" } }] }] }] };
    expect(scanWithFakeScanner(JSON.stringify(payload)).status).toBe(0);
  });

  it("fails closed on a vulnerability without severity evidence", () => {
    const payload = { results: [{ packages: [{ package: { name: "synthetic", version: "1.0.0" }, vulnerabilities: [{ id: "GHSA-TEST-UNKNOWN" }] }] }] };
    expect(scanWithFakeScanner(JSON.stringify(payload)).status).not.toBe(0);
  });

  it("accepts an informational prefix before a valid report", () => {
    const result = scanWithFakeScanner("scanner notice\\n" + JSON.stringify({ results: [] }));
    expect(result.status).toBe(0);
  });
});
