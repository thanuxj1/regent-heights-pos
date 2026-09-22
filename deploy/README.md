# Hosting — how this is actually deployed

Live server: DigitalOcean, Bangalore region, $6/mo Droplet (1 GB RAM / 1 vCPU / 25 GB SSD),
Ubuntu 24.04. Domain: `134-209-150-215.sslip.io` for now (swap for a real domain later — no
disruption, just a DNS change and re-running certbot).

The app and the database run on the **same box** — Postgres was deliberately self-hosted
here rather than kept on a managed service, to stay inside a small annual hosting budget.
See the commit history around this folder for the reasoning.

## What's where

| Piece | Location |
|---|---|
| App code | `/home/appuser/app` (this repo's `Server/`, without `node_modules`) |
| Built frontend | `/home/appuser/app-web` (this repo's `Client/`, built with `npm run build`) |
| Database | Local PostgreSQL 16, database `regent_heights`, role `regent_app` |
| Process manager | PM2, running as `appuser`, auto-starts on reboot (`pm2 startup` + `pm2 save`) |
| Reverse proxy | nginx — see `nginx-regent-heights.conf` in this folder |
| HTTPS | Let's Encrypt via certbot, auto-renewing |
| Backups | Nightly to Backblaze B2 — see `backup-db.sh` in this folder |

## Rebuilding from scratch, if the server is ever lost

1. New Ubuntu Droplet, same region/size (or bigger — see "Sizing" below).
2. Install: `nodejs` (20.x via NodeSource), `postgresql`, `nginx`, `certbot python3-certbot-nginx`, `pm2` (global npm).
3. Create a non-root `appuser` to run everything as (never run the app as root).
4. Postgres: create role `regent_app` and database `regent_heights`, owned by that role.
   Tune `postgresql.conf` for the box's RAM — see the commit that added this folder for the
   exact settings used on a 1 GB box (`shared_buffers`, `work_mem`, `max_connections`, etc.)
5. Run `schema.sql` **first**, then every file in `Server/migrations/` in order
   (`node scripts/migrate.js`) — the numbered migrations assume the base schema already
   exists.
6. Copy `Server/` (minus `node_modules`) and the built `Client/dist/` onto the server;
   `npm ci --omit=dev` inside `Server/`.
7. Write `Server/.env` on the server (never commit this file — see below for what it needs).
8. `pm2 start server.js --name regent-heights`, then `pm2 save` and `pm2 startup`.
9. Install `nginx-regent-heights.conf` from this folder (fill in the real domain/address),
   `certbot --nginx -d your-domain` for HTTPS.
10. Restore the latest database backup from Backblaze B2 (`b2 file download`, then
    `pg_restore` — the reverse of `backup-db.sh` in this folder), or run a fresh
    `pg_dump`/`pg_restore` from wherever the live data currently is.
11. Install the Backblaze B2 CLI as `appuser` specifically (**not** as root — see the note
    below), configure `~/.secrets/b2.env`, and schedule `backup-db.sh` via `crontab -e`.

## `.env` — what it needs (values are secrets; never commit the real ones)

```
DATABASE_URL=postgresql://regent_app:<db-password>@localhost:5432/regent_heights
JWT_SECRET=<long random string — losing this just signs everyone out, no data lost>
NODE_ENV=production
PORT=5000
CLIENT_URL=https://<your-domain-or-sslip-address>
TRUST_PROXY=1
HOTEL_TZ=Asia/Colombo
```

## `~/.secrets/b2.env` on the server (also never committed)

```
B2_KEY_ID=<Backblaze application key ID>
B2_APP_KEY=<Backblaze application key>
B2_BUCKET=<the bucket name>
```

Use a Backblaze **Application Key** scoped to just this one bucket — never the account's
own login credentials.

## Sizing note

1 GB RAM was a deliberate budget choice, verified against real measured usage (the Node
app alone runs at ~75 MB under load) plus a 1 GB swap file as a safety margin. If the
property grows — more staff, more concurrent bookings — resizing the Droplet to 2 GB is a
few minutes of downtime with **no data loss**; nothing here assumes 1 GB specifically.

## A mistake worth not repeating

Two things installed with `sudo`/as `root` (the B2 CLI, at first) ended up unreachable by
`appuser` because `/root` itself isn't readable by other accounts — install anything the
app's own user needs to run **as that user**, not as root, or explicitly fix permissions
afterward. The same class of bug also broke nginx's access to the built frontend on first
deploy (the app's home directory needed `chmod o+x`, not `chmod o+r` — nginx only needs to
pass through it, never list it).
