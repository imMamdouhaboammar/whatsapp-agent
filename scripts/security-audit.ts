import { spawnSync } from "node:child_process";

console.log("🔍 Running dependency vulnerability audit powered by GitHub Advisory / OSV Database...");

const osv = spawnSync("osv-scanner", ["scan", "-r", ".", "--format", "json"], {
  encoding: "utf-8",
  maxBuffer: 20 * 1024 * 1024,
});

if (osv.error) {
  console.error("❌ Failed to execute osv-scanner:", osv.error.message);
  process.exit(1);
}

let hasHighOrCritical = false;
let totalVulns = 0;

try {
  const stdout = osv.stdout || "";
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    console.log("✅ No vulnerability report returned (clean).");
    process.exit(0);
  }

  const data = JSON.parse(stdout.slice(jsonStart));
  const results = data.results || [];

  for (const res of results) {
    for (const pkg of res.packages || []) {
      for (const vuln of pkg.vulnerabilities || []) {
        totalVulns++;
        const id = vuln.id || "UNKNOWN";
        const pkgName = pkg.package?.name || "unknown";
        const version = pkg.package?.version || "unknown";
        const dbSeverity = String(vuln.database_specific?.severity || "").toUpperCase();

        let isHighOrCritical = dbSeverity === "HIGH" || dbSeverity === "CRITICAL";

        if (Array.isArray(vuln.severity)) {
          for (const s of vuln.severity) {
            const score = parseFloat(s.score);
            if (!isNaN(score) && score >= 7.0) {
              isHighOrCritical = true;
            }
          }
        }

        console.log(`• [${dbSeverity || "SCORE"}] ${id} in ${pkgName}@${version}`);
        if (isHighOrCritical) {
          console.error(`🚨 HIGH or CRITICAL severity advisory detected: ${id} (${pkgName}@${version})`);
          hasHighOrCritical = true;
        }
      }
    }
  }
} catch (err) {
  console.error("❌ Error parsing osv-scanner output:", err);
  process.exit(1);
}

if (hasHighOrCritical) {
  console.error("\n❌ Security audit failed: High or Critical vulnerabilities detected.");
  process.exit(1);
}

console.log(`\n✅ Security audit passed: ${totalVulns} total vulnerabilities, 0 High/Critical.`);
process.exit(0);
