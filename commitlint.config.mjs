export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "refactor", "perf", "test", "docs", "style", "build", "ci", "chore", "revert"]],
    "scope-enum": [2, "always", ["agent", "ai", "domain", "funnel", "mcp", "persistence", "server", "cli", "ui", "worker", "deps", "ci", "security", "config", "release", "acp", "learnings"]],
    "scope-empty": [0],
    "subject-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
  },
};
