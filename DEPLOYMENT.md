# Container deployment (WA-021)

## Build

```sh
docker build -t whatsapp-agent .
```

The image is reproducible: both stages run `bun install --frozen-lockfile`
against the committed `bun.lock` / `ui/bun.lock`. There is no unlocked
fallback; a dependency drift fails the build loudly. Base images are
`oven/bun:1.3` / `oven/bun:1.3-slim`, matching `package.json` engines
(`bun >=1.3.0`).

## Run

```sh
cp .env.example .env   # then set AGENT_DASHBOARD_TOKEN and GEMINI_API_KEY
docker compose up -d
```

`AGENT_DASHBOARD_TOKEN` and `GEMINI_API_KEY` are required: `docker compose config`
fails fast with an explicit message when they are missing, so the container can
never boot without dashboard auth or a model credential.

## Runtime properties (verified on a clean Linux daemon)

- Non-root: the process runs as the `bun` user (uid 1000).
- Persistence: the named volume `whatsapp-agent-data` is mounted at `/app/data`
  with `bun:bun` ownership; SQLite state survives `docker restart` and rebuilds.
- Probes: Docker HEALTHCHECK and the compose healthcheck both hit
  `GET /healthz` (liveness, no auth) every 30s with a 5s timeout.
- Resources: compose caps the service at 1.5 CPU / 1024M, reserving 0.25 CPU /
  256M, matching the low-spec VPS target.

## Optional components

- `WHATSAPP_TRANSPORT=meta-cloud` uses the Meta Cloud API instead of the
  self-hosted Baileys companion; see `.env.example` section 3 and
  `docs/meta-cloud-api-adapter.md` for the required `META_CLOUD_*` values.
- The Python media worker (`workers/media-python`) is optional and not part of
  this image; media features degrade gracefully when it is absent.
- `DATABASE_URL` switches persistence from local SQLite WAL to PostgreSQL;
  see `docs/POSTGRES_MIGRATION.md`.
