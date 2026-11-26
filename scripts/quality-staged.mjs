import { spawnSync } from "node:child_process";
import { basename } from "node:path";

function run(command, args, cwd = ".") {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(command + " failed or is unavailable", { cause: result.error });
}
const diff = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { encoding: "utf8" });
if (diff.error || diff.status !== 0) throw new Error("Cannot enumerate staged files", { cause: diff.error });
const files = diff.stdout.split("\0").filter(Boolean);
const js = files.filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));
const python = files.filter((file) => file.startsWith("workers/media-python/") && file.endsWith(".py"));
const buck = files.filter((file) => basename(file) === "BUCK" || file.endsWith(".bzl"));
const docker = files.filter((file) => /^Dockerfile(?:\..+)?$/.test(basename(file)));
for (const file of [...js, ...python, ...buck, ...docker]) {
  const state = spawnSync("git", ["diff", "--quiet", "--", file]);
  if (state.error || state.status !== 0) throw new Error("Stage the full file before checking: " + file);
}
if (js.length) run("bunx", ["--no-install", "oxlint", "--disable-nested-config", "-c", ".oxlintrc.json", "--deny-warnings", "--", ...js]);
if (files.some((file) => /^(src|scripts|tests)\//.test(file) && /\.tsx?$/.test(file) || file === "tsconfig.json")) {
  run("bun", ["run", "typecheck:backend"]);
}
if (files.some((file) => file.startsWith("ui/") && (/\.(?:tsx?|json)$/.test(file)))) {
  run("bun", ["run", "typecheck:ui"]);
}
if (python.length) {
  run("uvx", ["--from", "ruff==0.17.4", "ruff", "check", "--", ...python]);
  run("uvx", ["--from", "ruff==0.17.4", "ruff", "format", "--check", "--", ...python]);
}
for (const file of buck) run("buildifier", ["-mode=check", "-lint=warn", basename(file) === "BUCK" ? "-type=build" : "-type=bzl", file]);
for (const file of docker) run("hadolint", ["--failure-threshold", "warning", file]);
