# BUCK - Monorepo build definitions for whatsapp-agent

# 1. Sanity check target
genrule(
    name = "hello_world",
    out = "out.txt",
    cmd = "echo BUILT BY BUCK2 > $OUT",
)

# 2. TypeScript typecheck target
genrule(
    name = "typecheck",
    srcs = glob([
        "src/**/*.ts",
        "tests/**/*.ts",
        "tsconfig.json",
    ]),
    out = "typecheck.log",
    cmd = """
        TARGET_OUT="$PWD/$OUT"
        ROOT="${PWD%%/buck-out/*}"
        (cd "$ROOT" && bun x tsc --noEmit)
        echo "Typecheck passed cleanly" > "$TARGET_OUT"
    """,
)

# 3. Backend Agent bundle check
genrule(
    name = "backend_check",
    srcs = glob([
        "src/**/*.ts",
        "package.json",
        "tsconfig.json",
    ]),
    out = "backend_check.log",
    cmd = """
        TARGET_OUT="$PWD/$OUT"
        ROOT="${PWD%%/buck-out/*}"
        (cd "$ROOT" && bun build src/index.ts --target bun --no-bundle > /dev/null)
        echo "Backend bundle valid" > "$TARGET_OUT"
    """,
)

# 4. Frontend UI Cockpit production build
genrule(
    name = "ui_build",
    srcs = glob([
        "ui/src/**/*",
        "ui/public/**/*",
        "ui/index.html",
        "ui/package.json",
        "ui/vite.config.ts",
        "ui/tsconfig*.json",
    ]),
    out = "ui_dist",
    cmd = """
        TARGET_OUT="$PWD/$OUT"
        ROOT="${PWD%%/buck-out/*}"
        (cd "$ROOT/ui" && bun run build)
        cp -r "$ROOT/ui/dist" "$TARGET_OUT"
    """,
)

# 5. Python media worker syntax check
genrule(
    name = "worker_check",
    srcs = glob([
        "workers/media-python/**/*.py",
        "workers/media-python/requirements.txt",
    ]),
    out = "worker_check.log",
    cmd = """
        TARGET_OUT="$PWD/$OUT"
        ROOT="${PWD%%/buck-out/*}"
        (cd "$ROOT" && python3 -m py_compile workers/media-python/document_worker.py workers/media-python/test_worker.py)
        echo "Python worker syntax valid" > "$TARGET_OUT"
    """,
)

# 6. UI SSR test suite
genrule(
    name = "ui_test",
    srcs = glob([
        "ui/src/**/*",
        "ui/tests/**/*",
        "ui/package.json",
    ]),
    out = "ui_test.log",
    cmd = """
        TARGET_OUT="$PWD/$OUT"
        ROOT="${PWD%%/buck-out/*}"
        (cd "$ROOT/ui" && bun run test:ui > "$TARGET_OUT" 2>&1)
    """,
)
