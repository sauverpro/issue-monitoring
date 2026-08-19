# Deployment Guide — Issue Monitoring Backend

Manual deployment guide for hosting the backend on a **shared VPS** (Ubuntu/Debian) with PostgreSQL.

> **Shared server?** This guide is designed for a VPS where other applications are already running. Every step avoids disrupting existing services, Nginx configs, databases, or PM2 processes.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Step 1 — Pre-Flight Audit](#step-1--pre-flight-audit)
- [Step 2 — Node.js & PM2](#step-2--nodejs--pm2)
- [Step 3 — PostgreSQL Database](#step-3--postgresql-database)
- [Step 4 — Clone & Install](#step-4--clone--install)
- [Step 5 — Environment Variables](#step-5--environment-variables)
- [Step 6 — Migrations & Seed](#step-6--migrations--seed)
- [Step 7 — Build & Smoke Test](#step-7--build--smoke-test)
- [Step 8 — PM2 Process Manager](#step-8--pm2-process-manager)
- [Step 9 — Nginx Reverse Proxy & SSL](#step-9--nginx-reverse-proxy--ssl)
- [Step 10 — Verify](#step-10--verify)
- [Redeployment (Updates)](#redeployment-updates)
- [CI/CD Auto-Deploy](#cicd-auto-deploy)
- [Database Backups](#database-backups)
- [Troubleshooting](#troubleshooting)

---

## Architecture

> For the full telemetry → incident → recovery workflow, see **[System Workflow](./SYSTEM-WORKFLOW.md)**.

```
  Mobile app / Sentry          React dashboard (Vercel or static)
         │                              │
         │ POST /events                 │ JWT API calls + SSE
         ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    VPS (Ubuntu)                             │
│  HTTPS :443                                                 │
│  ┌─────────┐       ┌──────────────────┐                    │
│  │  Nginx  │──────▶│  Node.js API     │                    │
│  │ (proxy) │       │  (PM2 managed)   │                    │
│  └─────────┘       └────────┬─────────┘                    │
│       │                     │                               │
│       │ other apps          │ DATABASE_URL                  │
│       ▼                     ▼                               │
│  ┌─────────┐       ┌──────────────────┐                    │
│  │ App A,  │       │  PostgreSQL      │                    │
│  │ App B   │       │  :5432           │                    │
│  └─────────┘       └──────────────────┘                    │
└─────────────────────────────────────────────────────────────┘

Public status page (/status) reads GET /api/status — no auth required.
Background jobs: recovery, synthetic pings, retention, Sentry sync.
```

**Stack**: Express.js (TypeScript) → PostgreSQL 16 → Nginx → Let's Encrypt SSL · React frontend (separate deploy)

---

## Prerequisites

| Requirement | Details |
|---|---|
| VPS | Ubuntu 22.04/24.04 LTS, 1 GB+ RAM |
| SSH access | Key-based authentication recommended |
| Domain | A record pointing to VPS IP (for SSL) |
| Git | Repository accessible from the server |

---

## Step 1 — Pre-Flight Audit

> Run these checks first to understand what's already on the server.

```bash
ssh deploy@YOUR_VPS_IP

# Check existing services
sudo ss -tlnp                           # What's listening on which ports?
psql --version                          # PostgreSQL installed?
node -v                                 # Node.js version?
pm2 status                              # PM2 running other apps?
ls /etc/nginx/sites-enabled/            # Existing Nginx sites?
sudo ss -tlnp | grep :3000             # Is port 3000 free?
```

| Check | If YES | If NO |
|---|---|---|
| PostgreSQL installed? | Skip to [Step 3.2](#32-create-database--user) | Install in [Step 3.1](#31-install-postgresql) |
| Node.js ≥ 18? | Skip to [Step 2 — PM2](#install-pm2) | Install Node.js 22 |
| PM2 running? | Just add new app | Install PM2 |
| Port 3000 free? | Use `PORT=3000` | Use `PORT=3001` or another free port |

---

## Step 2 — Node.js & PM2

### Install Node.js (skip if already ≥ v18)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # → v22.x
```

### Install PM2

```bash
# Check if already installed
which pm2

# If not:
sudo npm install -g pm2
```

---

## Step 3 — PostgreSQL Database

### 3.1 Install PostgreSQL

> Skip this if PostgreSQL is already installed on the server.

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-contrib-16
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 3.2 Create database & user

```bash
sudo -u postgres psql
```

```sql
-- Create a user for this app (CHANGE THE PASSWORD)
CREATE USER monitor_user WITH PASSWORD 'koralink@123!';

-- Create the database (won't affect existing databases)
CREATE DATABASE koralink_monitor OWNER monitor_user;
GRANT ALL PRIVILEGES ON DATABASE koralink_monitor TO monitor_user;

-- Grant schema permissions (required for PostgreSQL 15+)
\c koralink_monitor
GRANT ALL ON SCHEMA public TO monitor_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO monitor_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO monitor_user;

\q
```

### 3.3 Test the connection

```bash
psql -U monitor_user -d koralink_monitor -h localhost
# Enter password → \q to exit
```

Your `DATABASE_URL`:
```
postgresql://monitor_user:YourStrongPassword123!@localhost:5432/koralink_monitor
```

---

## Step 4 — Clone & Install

```bash
cd ~/apps    # or wherever your other projects live
git clone https://github.com/YOUR_ORG/issue-monitoring.git
cd issue-monitoring/backend
npm install
```

---

## Step 5 — Environment Variables

Create `.env` in the **project root** (`~/apps/issue-monitoring/`):

```bash
cd ~/apps/issue-monitoring
nano .env
```

```env
# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://monitor_user:YourStrongPassword123!@localhost:5432/koralink_monitor

# ── Auth ─────────────────────────────────────────────────────────────────────
JWT_SECRET=<generate-below>

# ── Event ingestion ──────────────────────────────────────────────────────────
INGEST_API_KEY=<generate-below>

# ── CORS ─────────────────────────────────────────────────────────────────────
CORS_ORIGIN=https://your-frontend-domain.com

# ── Admin (seeded on first db:seed) ──────────────────────────────────────────
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=ChangeThisPassword!

# ── Server ───────────────────────────────────────────────────────────────────
PORT=3002

# ── Tracked APIs ─────────────────────────────────────────────────────────────
TRACKED_KORALINK_URL=https://www.koralink.org
TRACKED_GWIZA_URL=https://openapi.gwiza.tech
TRACKED_DDIN_URL=https://core-api.ddin.rw/v1/agency
TRACKED_TICKETS_URL=https://resolveit.rw

# ── Data retention ───────────────────────────────────────────────────────────
# Days of raw api_events kept before the nightly retention sweep deletes them.
RETENTION_DAYS=30

# ── Incident alerts (optional) ────────────────────────────────────────────────
# Slack incoming webhook URL; leave blank to disable alerts.
SLACK_WEBHOOK_URL=
# Public dashboard base URL, used to build incident links in Slack messages.
DASHBOARD_URL=https://your-dashboard-domain.com

# ── Sentry (optional) ───────────────────────────────────────────────────────
SENTRY_AUTH_TOKEN=
SENTRY_ORG=ict-chamber
SENTRY_PROJECT=market-place
SENTRY_BASE_URL=https://sentry.io
SENTRY_WEBHOOK_SECRET=
SENTRY_SYNC_INTERVAL_MS=300000
SENTRY_DISCOVER_QUERY=
```

**Generate real secrets:**

```bash
# JWT_SECRET (64 bytes hex)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# INGEST_API_KEY (32 bytes base64url)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Lock the file:**

```bash
chmod 600 ~/apps/issue-monitoring/.env
```

---

## Step 6 — Migrations & Seed

```bash
cd ~/apps/issue-monitoring/backend

# Create all tables (idempotent — safe to re-run)
npx tsx scripts/migrate.ts

# Create admin user
npx tsx scripts/seed.ts
```

---

## Step 7 — Build & Smoke Test

```bash
cd ~/apps/issue-monitoring/backend

# Compile TypeScript → dist/
npm run build

# Quick test (Ctrl+C to stop)
node scripts/start.js
# → "Koralink monitor API listening on port 3000"
```

---

## Step 8 — PM2 Process Manager

### Create ecosystem config

```bash
nano ~/apps/issue-monitoring/backend/ecosystem.config.cjs
```

```js
module.exports = {
  apps: [
    {
      name: "issue-monitor-api",
      script: "scripts/start.js",
      cwd: "/home/deploy/apps/issue-monitoring/backend",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "300M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/deploy/logs/issue-monitor-error.log",
      out_file: "/home/deploy/logs/issue-monitor-out.log",
      merge_logs: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
    },
  ],
};
```

### Start

```bash
mkdir -p ~/logs
pm2 start ecosystem.config.cjs
pm2 status          # Should show issue-monitor-api as "online"
pm2 save            # Persist process list for reboots
```

> **⚠️ Already have PM2 startup configured?** Don't run `pm2 startup` again — it could overwrite the existing startup script. `pm2 save` is enough to include the new app.

### PM2 commands reference

| Command | What it does |
|---|---|
| `pm2 status` | List all processes |
| `pm2 logs issue-monitor-api` | Tail live logs |
| `pm2 logs issue-monitor-api --err --lines 50` | View recent errors |
| `pm2 restart issue-monitor-api` | Restart |
| `pm2 reload issue-monitor-api` | Zero-downtime reload |
| `pm2 monit` | Real-time dashboard |

---

## Step 9 — Nginx Reverse Proxy & SSL

> **Do NOT delete** any existing Nginx configs. Only add a new server block.

### 9.1 Create Nginx config (`/etc/nginx/conf.d/`)

On CentOS/RHEL/AlmaLinux/Fedora systems, add the config file directly to `/etc/nginx/conf.d/`:

```bash
sudo nano /etc/nginx/conf.d/issue-monitor-api.conf
```

```nginx
server {
    listen 80;
    server_name 159.198.43.247;   # Your server's IP address

    location / {
        proxy_pass http://127.0.0.1:3002;   # Internal backend port
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE (Server-Sent Events) support
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        chunked_transfer_encoding off;
    }

    client_max_body_size 2m;
}
```

### 9.2 Test & Reload Nginx

```bash
sudo nginx -t            # Must pass before reloading
sudo systemctl reload nginx
```

> **Note on SSL:** Skip Certbot for now. Once you acquire a domain name later and point its A record to this server, update `server_name api.yourdomain.com;` in your Nginx config and run:
> ```bash
> sudo certbot --nginx -d api.yourdomain.com
> ```

Certbot auto-modifies the Nginx config to add SSL and HTTP→HTTPS redirect.

Verify auto-renewal:
```bash
sudo certbot renew --dry-run
```

---

## Step 10 — Verify

```bash
# Local health check
curl http://localhost:3000/health
# → {"ok":true}

# Public endpoint
curl https://api.yourdomain.com/health
# → {"ok":true}

# Auth test
curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourdomain.com","password":"YourPassword"}'
# → {"token":"eyJ..."}

# Verify existing apps still work
pm2 status   # All processes should be "online"
```

---

## Redeployment (Updates)

### Manual redeploy

```bash
ssh deploy@YOUR_VPS_IP
cd ~/apps/issue-monitoring

git pull origin main
cd backend
npm ci --production=false
npx tsx scripts/migrate.ts
npm run build
pm2 reload issue-monitor-api

curl -s http://localhost:3000/health
```

### Deploy script

Create `~/deploy-monitor.sh` on the server:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying issue-monitoring backend..."
cd ~/apps/issue-monitoring
git pull origin main

cd backend
npm ci --production=false
npx tsx scripts/migrate.ts
npm run build
pm2 reload issue-monitor-api

sleep 2
HEALTH=$(curl -sf http://localhost:3000/health || echo "FAILED")
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "✅ Deploy successful!"
else
  echo "❌ Health check failed!"
  pm2 logs issue-monitor-api --lines 20 --nostream
  exit 1
fi

pm2 status
```

```bash
chmod +x ~/deploy-monitor.sh
# Usage:
~/deploy-monitor.sh
```

---

## CI/CD Auto-Deploy

This project includes a GitHub Actions workflow at `.github/workflows/deploy-backend.yml` that automatically deploys on push to `main`.

### Required GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description | Example |
|---|---|---|
| `VPS_HOST` | Server IP or hostname | `192.168.1.100` |
| `VPS_USER` | SSH user | `deploy` |
| `VPS_SSH_KEY` | Full private SSH key | Content of `~/.ssh/id_ed25519` |
| `VPS_PORT` | SSH port | `22` |
| `DEPLOY_PATH` | Absolute project path on server | `/home/deploy/apps/issue-monitoring` |

### Generate an SSH deploy key

```bash
# On your LOCAL machine
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/deploy_key -N ""

# Copy the PUBLIC key to the server
ssh-copy-id -i ~/.ssh/deploy_key.pub deploy@YOUR_VPS_IP

# Copy the PRIVATE key content → paste into GitHub secret VPS_SSH_KEY
cat ~/.ssh/deploy_key
```

### How the workflow works

1. **Trigger**: Push to `main` that modifies `backend/**`
2. **Build & Test**: Installs deps, compiles TypeScript, runs tests in CI
3. **Deploy**: SSHs into the VPS, pulls code, runs migrations, builds, reloads PM2
4. **Health check**: Verifies `/health` returns `{"ok":true}`

Manual deploy is also available via **Actions → Deploy Backend → Run workflow**.

---

## Database Backups

### Manual backup

```bash
pg_dump -U monitor_user -h localhost koralink_monitor \
  | gzip > ~/backups/koralink_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Automated daily backup (cron)

```bash
mkdir -p ~/backups
crontab -e
```

```cron
# Daily at 2:30 AM
30 2 * * * pg_dump -U monitor_user -h localhost koralink_monitor | gzip > /home/deploy/backups/koralink_$(date +\%Y\%m\%d).sql.gz 2>&1

# Cleanup backups older than 30 days
30 3 * * * find /home/deploy/backups -name "koralink_*.sql.gz" -mtime +30 -delete
```

### Restore

```bash
gunzip -c ~/backups/koralink_20260801.sql.gz \
  | psql -U monitor_user -h localhost koralink_monitor
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Port 3000 in use | Change `PORT` in `.env` and Nginx `proxy_pass` |
| `ECONNREFUSED` on PostgreSQL | `sudo systemctl status postgresql` |
| `password authentication failed` | Verify `.env` matches the password set in psql |
| `relation "api_events" does not exist` | Run `npx tsx scripts/migrate.ts` |
| CORS errors in browser | Check `CORS_ORIGIN` matches frontend URL exactly (no trailing slash) |
| `502 Bad Gateway` | `pm2 status` — is the app online? Check `pm2 logs` |
| `nginx -t` fails | Only fix `issue-monitor-api` config — don't edit other sites |
| PM2 doesn't restart on reboot | Run `pm2 save` after adding the new app |
| Health check fails after deploy | `pm2 logs issue-monitor-api --err --lines 50` |
