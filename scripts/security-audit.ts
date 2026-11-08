import { spawnSync } from "node:child_process";

interface OsvSeverity {
  score?: unknown;
}

interface OsvVulnerability {
  id?: unknown;
  database_specific?: { severity?: unknown };
  ecosystem_specific?: { severity?: unknown };
  severity?: OsvSeverity[];
}

interface OsvPackage {
  package?: { name?: unknown; version?: unknown };
  vulnerabilities?: OsvVulnerability[];
}

interface OsvResult {
  packages?: OsvPackage[];
}

interface AuditFinding {
  id: string;
  packageName: string;
  version: string;
  label: string;
  isHighOrCritical: boolean;
  severityKnown: boolean;
}

const KNOWN_LOWER_SEVERITIES = new Set(["LOW", "MODERATE", "MEDIUM", "NEGLIGIBLE", "INFO", "INFORMATIONAL"]);
const HIGH_SEVERITIES = new Set(["HIGH", "CRITICAL"]);

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReport(output: string): OsvResult[] {
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("OSV scanner did not return a JSON report");
  }

  const parsed: unknown = JSON.parse(output.slice(jsonStart));
  if (!objectRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new Error("OSV scanner report is missing a valid results array");
  }

  for (const result of parsed.results) {
    if (!objectRecord(result) || !Array.isArray(result.packages)) {
      throw new Error("OSV scanner report contains a malformed result");
    }
    for (const pkg of result.packages) {
      if (!objectRecord(pkg) || !Array.isArray(pkg.vulnerabilities)) {
        throw new Error("OSV scanner report contains a malformed package");
      }
      for (const vuln of pkg.vulnerabilities) {
        if (!objectRecord(vuln)) {
          throw new Error("OSV scanner report contains a malformed vulnerability");
        }
      }
    }
  }

  return parsed.results as OsvResult[];
}

function describeVulnerability(vuln: OsvVulnerability, pkg: OsvPackage): AuditFinding {
  const label = [vuln.database_specific?.severity, vuln.ecosystem_specific?.severity]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  const normalizedLabel = typeof label === "string" ? label.trim().toUpperCase() : "";
  const scores = Array.isArray(vuln.severity) ? vuln.severity.map((entry) => {
    const raw = entry?.score;
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string" || !/^(?:10(?:\.0+)?|[0-9](?:\.\d+)?)$/.test(raw.trim())) {
      return Number.NaN;
    }
    return Number(raw.trim());
  }) : [];
  const validScores = scores.filter((score) => Number.isFinite(score) && score >= 0 && score <= 10);

  return {
    id: typeof vuln.id === "string" ? vuln.id : "UNKNOWN",
    packageName: typeof pkg.package?.name === "string" ? pkg.package.name : "unknown",
    version: typeof pkg.package?.version === "string" ? pkg.package.version : "unknown",
    label: normalizedLabel || (validScores.length > 0 ? "CVSS" : "UNRATED"),
    isHighOrCritical: HIGH_SEVERITIES.has(normalizedLabel) || validScores.some((score) => score >= 7),
    severityKnown: HIGH_SEVERITIES.has(normalizedLabel) || KNOWN_LOWER_SEVERITIES.has(normalizedLabel) || validScores.length > 0,
  };
}

function executeScanner() {
  const binary = process.env.OSV_SCANNER_BIN?.trim() || "osv-scanner";
  return spawnSync(binary, ["scan", "-r", ".", "--format", "json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

console.log("🔍 Running dependency vulnerability audit powered by GitHub Advisory / OSV Database...");

try {
  const scan = executeScanner();
  if (scan.error) {
    throw new Error("Failed to execute osv-scanner: " + scan.error.message);
  }
  if (scan.signal) {
    throw new Error("osv-scanner terminated with signal " + scan.signal);
  }

  const findings = parseReport(scan.stdout || "").flatMap((result) =>
    (result.packages || []).flatMap((pkg) =>
      (pkg.vulnerabilities || []).map((vuln) => describeVulnerability(vuln, pkg)),
    ),
  );

  for (const finding of findings) {
    const summary = finding.id + " in " + finding.packageName + "@" + finding.version;
    console.log("• [" + finding.label + "] " + summary);
    if (finding.isHighOrCritical) {
      console.error("🚨 HIGH or CRITICAL severity advisory detected: " + summary);
    } else if (!finding.severityKnown) {
      console.error("⚠️ Advisory with unknown severity requires review: " + summary);
    }
  }

  if (scan.status !== 0) {
    throw new Error("osv-scanner exited unsuccessfully (status " + String(scan.status) + ")");
  }
  if (findings.some((finding) => finding.isHighOrCritical)) {
    throw new Error("Security audit failed: High or Critical vulnerabilities detected");
  }
  if (findings.some((finding) => !finding.severityKnown)) {
    throw new Error("Security audit failed: advisory severity could not be verified");
  }

  console.log("\n✅ Security audit passed: " + findings.length + " total vulnerabilities, 0 High/Critical.");
} catch (error) {
  console.error("❌ " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
