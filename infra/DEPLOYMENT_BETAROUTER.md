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
| `playground.betarouter.com`   | `http://betarouter:3003` |
| `code.betarouter.com`         | `http://betarouter:3004` |
| `docs.betarouter.com`         | `http://betarouter:3005` |
| `admin.betarouter.com`        | `http://betarouter:3006` |

Cloudflare creates and proxies the required DNS records when each public
hostname is saved. The application, PostgreSQL, and Redis ports are not bound
to the Droplet's public interface.

Create a Cloudflare Access self-hosted application for
`admin.betarouter.com` before sharing the admin URL. Tunnel transport protects
the connection but does not replace an identity policy.

## First deployment

The production checkout lives at `/opt/betarouter-ai-gateway`.

```sh
git clone git@github.com:lawrencettc/betarouter-ai-gateway.git /opt/betarouter-ai-gateway
cd /opt/betarouter-ai-gateway
cp .env.production.example .env.production
chmod 600 .env.production
```

Replace every `replace-with-...` value in `.env.production`, including the
Cloudflare tunnel token. Keep this file only on the Droplet.

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
expose ports `3002-3006`, `4001-4002`, `5432`, or `6379` in the cloud firewall.
Allow outbound TCP/UDP `7844` and outbound HTTPS for `cloudflared`.

The current 2 GB Droplet is suitable for running the service but is tight for a
full monorepo build. Add at least 4 GB of temporary swap and confirm adequate
free disk before using the local-build fallback. Keep
`BETAROUTER_BUILD_CONCURRENCY=1` so the Next.js applications build serially;
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

Redis is used for queue/cache state. The upstream unified startup currently
disables Redis persistence, so queued work can be lost when the container is
recreated even though a Redis volume is attached.

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
