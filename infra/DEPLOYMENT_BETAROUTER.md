# BetaRouter production deployment

This deployment runs the unified BetaRouter gateway image, including the licensed
enterprise packages in `ee/`, on one DigitalOcean Droplet. Cloudflare Tunnel
publishes the services without opening application ports on the Droplet.

## Public routes

Configure these public hostnames on the remotely managed Cloudflare tunnel:

| Hostname                      | Tunnel service           |
| ----------------------------- | ------------------------ |
| `betarouter.com`              | `http://betarouter:3002` |
| `api.betarouter.com`          | `http://betarouter:4001` |
| `platform-api.betarouter.com` | `http://betarouter:4002` |
| `chat.betarouter.com`         | `http://betarouter:3003` |
| `playground.betarouter.com`   | `http://betarouter:3003` |
| `code.betarouter.com`         | `http://betarouter:3004` |
| `betapass.betarouter.com`     | `http://betarouter:3004` |
| `docs.betarouter.com`         | `http://betarouter:3005` |
| `admin.betarouter.com`        | `http://betarouter:3006` |

Cloudflare creates and proxies the required DNS records when each public
hostname is saved. The application, PostgreSQL, and Redis ports are not bound
to the Droplet's public interface.

`chat.betarouter.com` is the canonical public domain of the Playground (the
`playground` app) and shares the tunnel service with
`playground.betarouter.com`. The app's own metadata treats `chat.` as canonical
— `metadataBase`, `sitemap.ts`, `robots.ts`, and every OpenGraph/canonical URL
point there — so `PLAYGROUND_URL` must be `https://chat.betarouter.com` and
`chat.betarouter.com` must appear in `ORIGIN_URLS` and `GATEWAY_CORS_ORIGINS`.
`playground.betarouter.com` is kept as an alias so existing links keep working.

`betapass.betarouter.com` is the canonical public domain of the BetaPass product
(the `code` app) and shares the tunnel service with `code.betarouter.com`. Its
metadata treats `betapass.` as canonical the same way, and `betarouter.com/code`
permanently redirects there — so `CODE_URL` must be
`https://betapass.betarouter.com`. `code.betarouter.com` is kept as an alias.

`CODE_URL` is not only a link target: `apps/api/src/auth/config.ts` uses it in
`isCodeAppOrigin`/`resolveCallbackBaseUrl` to decide where an auth callback
returns to. Only the origin matching `CODE_URL` is treated as the code app, so
requests arriving on the alias fall back to `UI_URL`. Keep BOTH
`betapass.betarouter.com` and `code.betarouter.com` in `ORIGIN_URLS`, which is
what better-auth uses for `trustedOrigins`.

Both hostnames now exist, so `https://chat.betarouter.com/` and
`https://betapass.betarouter.com/` can be added to the "Verify public routes"
step in `.github/workflows/deploy-production.yml`.

Create a Cloudflare Access self-hosted application for
`admin.betarouter.com` before sharing the admin URL. Tunnel transport protects
the connection but does not replace an identity policy.

### Access policy on admin.betarouter.com

Configured in Cloudflare Zero Trust under **Access controls → Applications**:

| Field       | Value                                             |
| ----------- | ------------------------------------------------- |
| Application | `betarouter admin dashboard` (self-hosted, public DNS) |
| Destination | `admin.betarouter.com`                            |
| Policy      | `betarouter admins`, action **Allow**             |
| Rule        | selector **Emails** is `lawrence@publicbeta.io`   |
| Identity    | One-time PIN by email (no external IdP)           |
| Session     | 24 hours                                          |

Use the **Emails** selector, not **Emails ending in** — the latter would admit
every address on the domain. Access is default-deny, so anything not matching
the rule is rejected at Cloudflare's edge and never reaches the Droplet.

There are TWO independent gates and they must be kept in sync:

1. **Cloudflare Access** decides who may reach `admin.betarouter.com` at all.
2. **`ADMIN_EMAILS`** in `.env.production` decides who the `ee/admin` app treats
   as an admin once they have logged in.

An address in Access but not in `ADMIN_EMAILS` clears the edge and is then
rejected by the app; the reverse never gets far enough to matter. When adding
or removing an admin, change both.

To verify: `curl -sI https://admin.betarouter.com/` should return `302` with a
`location` on `*.cloudflareaccess.com`. A redirect to `/login` instead means
Access is NOT in front of the app and the dashboard is publicly reachable.
Deleting the Access application reverts to exactly that unprotected state, so it
is also the escape hatch if a policy change locks everyone out.

## First deployment

The production checkout lives at `/opt/betarouter-ai-gateway`.

```sh
git clone git@github.com:lawrencettc/betarouter-ai-gateway.git /opt/betarouter-ai-gateway
cd /opt/betarouter-ai-gateway
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every `replace-with-...` value in `.env.production`, including the
Cloudflare tunnel token, `ADMIN_EMAILS`, platform-provider encryption keys, and
`PLATFORM_ADMIN_USER_IDS`. Admin users first create a normal BetaRouter account;
look up that account's immutable database user ID and place it in
`PLATFORM_ADMIN_USER_IDS` before enabling credential management. They then sign
in to `admin.betarouter.com` with the same email and password. Keep this file
only on the Droplet.

### Hosted authentication and email

The managed Compose file pins `HOSTED=true`. This keeps email verification
enabled and prevents the self-hosted sign-in hook from automatically verifying
new accounts.

Add `mail.betarouter.com` as a sending domain in Resend, publish its DNS records
through Cloudflare, and wait for Resend to report the domain as verified. Create
a full-access API key because hosted authentication uses both transactional
email and the Contacts API. Set `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`,
`RESEND_NEWSLETTER_TOPIC_ID`, `RESEND_FROM_EMAIL`, and
`RESEND_REPLY_TO_EMAIL` in `.env.production`.

Compose refuses to start when the required Resend values are missing. Hosted
verification delivery uses strict, token-safe error logging. Better Auth may
still return a successful sign-up response when delivery fails, but the account
remains unverified and the user can retry verification after email recovers.

Normally, GitHub Actions publishes the unified image to GHCR. Start it with:

```sh
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml up -d
```

If GitHub Actions or GHCR is temporarily unavailable, build on the Droplet:

```sh
sed -i 's|^BETAROUTER_IMAGE=.*|BETAROUTER_IMAGE=betarouter-ai-gateway-unified:local|' .env.production
sed -i 's|^BETAROUTER_PULL_POLICY=.*|BETAROUTER_PULL_POLICY=never|' .env.production
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml build betarouter
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml up -d
```

A small Droplet may need temporary swap while building the monorepo. Do not
expose ports `3002-3006`, `4001-4002`, `5432`, `6379`, or `6380` in the cloud
firewall.
Allow outbound TCP/UDP `7844` and outbound HTTPS for `cloudflared`.

The current 2 GB Droplet is suitable for running the service but is tight for a
full monorepo build. Add at least 4 GB of temporary swap and confirm adequate
free disk before using the local-build fallback. Keep
`BETAROUTER_BUILD_CONCURRENCY=1` so the Next.js applications build serially and
`BETAROUTER_BUILD_NODE_HEAP_MB=1536` so the largest build can use enough heap;
higher concurrency can trigger the Linux out-of-memory killer. Once GHCR builds
resume, set `BETAROUTER_IMAGE` back to the GHCR image and
`BETAROUTER_PULL_POLICY=always`.

## Verify

```sh
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml ps
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml logs --tail=100 betarouter betarouter-tunnel
curl --fail --silent --show-error https://betarouter.com/ >/dev/null
curl --fail --silent --show-error https://api.betarouter.com/ >/dev/null
curl --fail --silent --show-error https://platform-api.betarouter.com/ >/dev/null
```

## Update and rollback

For the normal GHCR path:

```sh
git pull --ff-only
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml pull
docker compose --env-file .env.production -f infra/docker-compose.betarouter.yml up -d
```

Before an update, record the current immutable image digest. Roll back by
setting `BETAROUTER_IMAGE` to that digest and running `docker compose up -d`
again. PostgreSQL data is stored in the named `postgres_data` volume; back it
up separately before application or schema upgrades.

The deploy workflow creates a compressed pre-deploy PostgreSQL dump under
`/opt/betarouter-backups` and restores the previous application image if health
verification fails. Schema rollback is intentionally not automatic; migrations
must remain backward compatible, and a database restore is a separate operator
decision. Copy backups off the Droplet and test the restore procedure regularly.

Redis is used for queue/cache state. The unified startup runs TWO Redis
instances: `redis` on 6379 (queue, rate limits, preferred-provider state, video
jobs) with persistence deliberately disabled, so queued work can be lost when
the container is recreated even though a Redis volume is attached; and
`redis-storage` on 6380 (gateway response cache, Responses API state) with AOF
persistence on the `redis_storage_data` volume. Back up
`redis_storage_data` alongside `postgres_data`.

## Deploy checklist for this release

Three things changed that a deploy will NOT surface as an error, only as
different behaviour:

1. **CORS now defaults closed.** The gateway used to send
   `Access-Control-Allow-Origin: *` to everyone; it now sends no CORS headers at
   all unless `GATEWAY_CORS_ORIGINS` is set. Any browser-based client calling
   `api.betarouter.com` directly breaks silently on the next deploy. Set the
   allowlist BEFORE deploying if such clients exist:

   ```sh
   GATEWAY_CORS_ORIGINS=https://chat.betarouter.com,https://playground.betarouter.com,https://*.betarouter.com
   ```

   Entries are full origins and may use one leading wildcard label. Credentials
   are never allowed — the API key travels in `Authorization`, never in cookies.
   Server-to-server integrations (SDKs, curl, backends) are unaffected: CORS is
   a browser mechanism only. Leave the variable empty to keep the API
   browser-inaccessible, which is the intended posture.

2. **A second Redis process starts.** `redis-storage` is a new supervisord
   program, so the container healthcheck (which requires every supervisord
   program to be `RUNNING`) now depends on it. The gateway `/` health endpoint
   pings both instances; either one failing marks the gateway unhealthy. The
   `redis_storage_data` volume is created automatically. Set
   `STORAGE_REDIS_HOST`/`STORAGE_REDIS_PORT` (the compose file defaults them to
   `localhost:6380`). The fallback to `REDIS_*` is all-or-nothing: setting any
   one `STORAGE_REDIS_*` variable stops the rest being inherited, so a dedicated
   passwordless instance never picks up the main instance's password. Setting
   none of them keeps everything on the main Redis.

   Migrating an existing deployment loses nothing: the response cache is
   regenerated on demand, so the first requests after the switch simply miss.

3. **One new migration.** `1785386011_colorful_sharon_carter` adds
   `model_provider_mapping.input_audio_hour_price` and is `IF NOT EXISTS`
   guarded. Its timestamp is above the ledger high-water mark, so drizzle will
   apply it normally — unlike the two upstream migrations called out in the
   Stage 2 ops note, which still need the manual treatment described there.

## New environment variables

| Variable                             | Default          | Notes                                                                       |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `GATEWAY_CORS_ORIGINS`               | *empty*          | **Required for browser clients.** Comma-separated origin allowlist. Empty ⇒ no CORS headers at all. |
| `STORAGE_REDIS_HOST`                 | `REDIS_HOST`     | Bulk-data Redis. Compose sets `localhost`.                                  |
| `STORAGE_REDIS_PORT`                 | `REDIS_PORT`     | Compose sets `6380`.                                                        |
| `STORAGE_REDIS_PASSWORD`             | `REDIS_PASSWORD` | Only inherited when NO `STORAGE_REDIS_*` variable is set.                    |
| `RESPONSES_STORAGE_DRIVER`           | `redis`          | Reserved. This fork does not read it yet (upstream's responses-storage extraction is not merged); Responses state always uses Redis. |
| `UPSTREAM_KEEPALIVE_TIMEOUT_MS`      | `60000`          | undici dispatcher keep-alive for provider connections (landed in Stage 3).   |
| `REALTIME_INLINE`                    | `false`          | Attach the `/v1/realtime` WebSocket proxy to the gateway port. **The switch that actually turns realtime on.** |
| `REALTIME_DISABLED`                  | *unset*          | Kill switch; `true` wins over `REALTIME_INLINE` and `REALTIME_ENABLED`. Compose sets `true`. |
| `REALTIME_ENABLED`                   | *unset*          | Mint client secrets without an inline listener. Only for deployments where something else fronts `/v1/realtime`. Any value other than `false` enables. |
| `REALTIME_MAX_SESSIONS_PER_ORG`      | `20`             | Concurrent-session lease cap per organization.                               |
| `REALTIME_MAX_SESSIONS_PER_KEY`      | `10`             | Concurrent-session lease cap per API key.                                    |
| `REALTIME_MAX_SESSION_SECONDS`       | `3600`           | Hard session-duration cap. Also feeds the shutdown drain budget.             |
| `REALTIME_MAX_SESSION_SPEND_USD`     | `10`             | Per-session spend ceiling; the session closes when exceeded.                 |
| `REALTIME_MAX_MESSAGE_BYTES`         | `8388608`        | Largest single WebSocket frame accepted (8 MiB).                             |
| `REALTIME_MAX_BUFFERED_BYTES`        | `4194304`        | Backpressure threshold per socket (4 MiB).                                   |
| `REALTIME_BACKPRESSURE_TIMEOUT_MS`   | `30000`          | How long a socket may stay over the buffer threshold before being closed.    |
| `REALTIME_PING_INTERVAL_MS`          | `15000`          | Keep-alive ping cadence.                                                    |
| `REALTIME_DRAIN_TIMEOUT_MS`          | `10000`          | Per-session drain budget on a normal disconnect (lets pending billing land). |
| `REALTIME_UPSTREAM_HANDSHAKE_TIMEOUT_MS` | `10000`      | Upstream WebSocket handshake timeout.                                       |
| `REALTIME_SHUTDOWN_GRACE_PERIOD_MS`  | `(MAX_SESSION_SECONDS + 60) * 1000` | Shutdown drain for live calls. **Must stay ≤ the container/pod termination grace period**, or the orchestrator SIGKILLs mid-call and the wait accomplishes nothing. `stop_grace_period` in the compose file is 2m, so raising `REALTIME_MAX_SESSION_SECONDS` above ~60s of drain means raising `stop_grace_period` too. |

Client-secret TTL is not configurable: it is clamped in code to 10–300s
(default 60s).

## Enabling realtime

`/v1/realtime` ships **dark**. With the shipped defaults the gateway attaches no
WebSocket listener and `POST /v1/realtime/client_secrets` returns 404, so the
merged code is inert. This differs from hosted upstream, where realtime is on.

The frontend is dark independently: the playground Voice studio tile is hidden
and `/realtime` returns 404 unless `NEXT_PUBLIC_REALTIME_ENABLED=true` is set at
build time for `apps/playground`. Leave it off until the gateway side is proven.

Preconditions before enabling anything:

- `redis-storage` is `RUNNING` and the gateway health endpoint is green.
- A provider credential exists for a mapping with `realtime: true` (currently
  OpenAI), reachable in the project's mode (`credits` needs the env/platform
  credential; `api-keys` needs a provider key with **no** custom base URL —
  realtime rejects BYOK base-URL overrides because a proxy would break the
  metering-critical event contract).
- `REALTIME_MAX_SESSION_SPEND_USD` and the per-org/per-key lease caps are set to
  values you are willing to be billed for. A realtime session bills continuously
  and is not covered by the request-level usage limits.
- `REALTIME_SHUTDOWN_GRACE_PERIOD_MS` ≤ `stop_grace_period`.

Realtime also refuses, by design, to serve: end-user session tokens and platform
keys (only regular developer API keys), and dev-plan or chat-plan organizations
(regular pay-as-you-go credits or BYOK only).

**Step 1 — per-organization pilot.** There is no per-org realtime flag, so scope
the pilot with the tools that do exist rather than by flipping the global
switch broadly:

1. Set `REALTIME_INLINE=true` and remove `REALTIME_DISABLED` (or set it to
   `false`) in `.env.production`, then `docker compose up -d`.
2. Immediately restrict who can reach it: in the platform catalogue, keep the
   `realtime`/`realtimeTranscription` mappings visible only to the pilot
   organization's routing, or use per-key IAM rules (allowed models) so only the
   pilot organization's keys can name a realtime model. Catalog admission and
   IAM are both enforced on every session and on every ASR model an ASR-enabled
   session tries to use.
3. Watch `realtime_session` rows and the `log` rows they link to
   (`realtime_session_id` is set) for cost, `close_reason`, and duplicate-event
   handling. `unpriceable_usage:*` / `unbillable_transcription` close reasons
   mean the gateway refused to deliver unbilled work — investigate the mapping's
   prices rather than raising limits.
4. Roll back instantly at any point with `REALTIME_DISABLED=true` and
   `docker compose up -d`. In-flight sessions drain rather than being cut.

**Step 2 — global.** Once the pilot's billing rows reconcile, widen catalogue
visibility / IAM, and set `NEXT_PUBLIC_REALTIME_ENABLED=true` for the playground
build so the Voice studio becomes reachable.

Do not enable `REALTIME_ENABLED` without `REALTIME_INLINE` unless another
process genuinely serves `/v1/realtime`: it makes the gateway mint client
secrets for a WebSocket path nothing answers.

## GitHub Actions deployment

`.github/workflows/images.yml` builds and publishes the unified GHCR image.
After that workflow succeeds on `main`, `deploy-production.yml` runs on the
Droplet's outbound-only self-hosted runner labeled `betarouter-production`.
The deploy workflow can also be started manually.

The runner needs read access to this repository, access to Docker, and access
to `/opt/betarouter-ai-gateway`. Keep `.env.production` on the Droplet; do not
store application or tunnel secrets in the workflow file.

In GitHub, open **Settings → Actions → Runners → New self-hosted runner**, choose
Linux x64, and run the displayed installation commands on the Droplet as a
dedicated non-login user. Add the custom label `betarouter-production`, add the
runner user to the `docker` group, grant it access to the production checkout,
and install the runner as a system service. The runner connects outbound to
GitHub; it does not require inbound SSH or application ports.

## One-time cleanup used on the existing Droplet

Before deletion, inspect Compose labels and mounts to verify ownership. For the
previous deployment, the confirmed targets were project directory
`/opt/betarouter`, containers `betarouter`, `postgres`, and `redis`, volume
`betarouter_pg_data`, and the unrelated-but-no-longer-needed `uptime-kuma`
container and volume. Those exact resources were removed before this deployment.
Do not use a broad `docker system prune --volumes` on a shared Droplet.
