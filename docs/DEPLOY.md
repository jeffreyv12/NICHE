# Deployment Guide

Step-by-step instructions to get NicheFinder running from a fresh checkout.
Execute every section in order. Estimated time: 90 minutes.

---

## Prerequisites

All accounts must exist before you start. See `docs/PHASE_PLAN.md` Phase 0 for the full list.
The minimum required to reach a working deployment:

| Account | What you need |
|---------|---------------|
| Supabase | Project in `eu-central-1`, service-role key, direct + pool connection strings |
| Vercel | Pro plan, team, project linked to this repo |
| Anthropic | API key with ≥€50 credit |
| Resend | API key, verified sender domain |
| GitHub | Repo with Actions enabled |
| Hetzner | CX22 server (Ubuntu 24 LTS), SSH access |

---

## 1. Clone and install

```bash
git clone <your-repo-url> nichefinder
cd nichefinder
pnpm install
```

Verify the monorepo is healthy:

```bash
pnpm typecheck && pnpm lint
```

Both must exit 0 before continuing.

---

## 2. Local env file

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the **required** values (everything else is optional at first boot):

```
# Core
PRIMARY_TENANT_HOSTNAME=<your-main-domain>        # e.g. expertgids.nl
NEXT_PUBLIC_APP_URL=https://<your-main-domain>

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<pw>@db.<project>.supabase.co:5432/postgres
DATABASE_POOL_URL=postgresql://postgres.<project>:<pw>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Admin login
ADMIN_ALLOWED_EMAILS=<your-email>
OPERATOR_EMAIL=<your-email>
```

---

## 3. Database migrations

Run all migrations in order against your Supabase project:

```bash
pnpm db:migrate
```

This applies:
- `0001_init.sql` — full schema (tenants, niches, pages, clicks, conversions, …)
- `0002_rls.sql` — Row-Level Security policies
- `0003_validation_evaluations.sql`
- `0004_page_polish_fields.sql`
- `0005_kill_flags.sql`
- `0006_promotion_migrations.sql`
- `0007_daily_costs_view.sql` — `daily_costs` view for cost analytics

Verify in the Supabase dashboard: **Table Editor** should show all tables; **SQL Editor** → `select count(*) from tenants;` should return 0.

---

## 4. Seed first tenant

```bash
pnpm db:seed
```

This inserts the main authority tenant and your admin email into `tenants` + `admin_emails`.
After seeding, confirm in Supabase:

```sql
select slug, hostname, is_active from tenants;
```

Should show one row with your `PRIMARY_TENANT_HOSTNAME`.

---

## 5. Vercel deployment

### 5.1 Link the project

```bash
pnpm vercel link
```

Select your team and project.

### 5.2 Set environment variables

In Vercel dashboard → **Settings → Environment Variables**, add every key from `.env.example`.
Required for production:

```
NODE_ENV                    production
APP_ENV                     production
PRIMARY_TENANT_HOSTNAME     <your-domain>
NEXT_PUBLIC_APP_URL         https://<your-domain>
NEXT_PUBLIC_SUPABASE_URL    https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
DATABASE_POOL_URL
ANTHROPIC_API_KEY
CLAUDE_MONTHLY_BUDGET_EUR   200
CLAUDE_PER_CALL_CAP_EUR     2.50
ADMIN_ALLOWED_EMAILS        <your-email>
OPERATOR_EMAIL              <your-email>
RESEND_API_KEY
EMAIL_FROM                  NicheFinder <noreply@<your-domain>>
```

Affiliate keys, DataForSEO, and webhook tokens can be added later as you activate each network.

### 5.3 Configure domain

In Vercel → **Domains**, add your main domain. Point DNS:

```
A     @    76.76.21.21
CNAME www  cname.vercel-dns.com
```

### 5.4 Deploy

```bash
pnpm vercel --prod
```

Visit `https://<your-domain>/admin` — you should see the login page.

---

## 6. Hetzner scraper server

### 6.1 Provision

Create a CX22 (2 vCPU, 4 GB RAM, €4/mo) in Hetzner Cloud, Ubuntu 24 LTS, Frankfurt region.
Add your SSH key during creation.

### 6.2 Bootstrap

```bash
ssh root@<server-ip>

# System packages
apt update && apt upgrade -y
apt install -y git curl build-essential

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# pnpm
npm install -g pnpm@9

# nichefinder user
useradd -m -s /bin/bash nichefinder
```

### 6.3 Deploy code

```bash
# As root or with sudo
mkdir -p /opt/nichefinder
git clone <your-repo-url> /opt/nichefinder
cd /opt/nichefinder
pnpm install
pnpm build   # builds apps/scrapers → dist/
chown -R nichefinder:nichefinder /opt/nichefinder
```

### 6.4 Environment file

```bash
mkdir -p /etc/nichefinder
cat > /etc/nichefinder/env << 'EOF'
NODE_ENV=production
APP_ENV=production
DATABASE_URL=<direct-connection-string>
DATABASE_POOL_URL=<pool-connection-string>
ANTHROPIC_API_KEY=<key>
CLAUDE_MONTHLY_BUDGET_EUR=200
CLAUDE_PER_CALL_CAP_EUR=2.50
OPERATOR_EMAIL=<your-email>
RESEND_API_KEY=<key>
EMAIL_FROM=NicheFinder <noreply@<your-domain>>
SLACK_WEBHOOK_URL=<optional>
BOL_PARTNER_CLIENT_ID=<key>
BOL_PARTNER_CLIENT_SECRET=<key>
DATAFORSEO_LOGIN=<login>
DATAFORSEO_PASSWORD=<pw>
GSC_SERVICE_ACCOUNT_JSON=<single-line-json>
BING_INDEXNOW_KEY=<key>
EOF
chmod 600 /etc/nichefinder/env
chown root:root /etc/nichefinder/env
```

### 6.5 Install systemd units

```bash
SYSTEMD_DIR=/opt/nichefinder/infra/hetzner/systemd

# Copy all units
cp $SYSTEMD_DIR/nichefinder-runner@.service /etc/systemd/system/
cp $SYSTEMD_DIR/*.timer /etc/systemd/system/

systemctl daemon-reload

# Enable and start all timers
for timer in \
  nichefinder-discovery \
  nichefinder-scoring \
  nichefinder-validation-review \
  nichefinder-content-polish \
  nichefinder-conversions-reconcile \
  nichefinder-gsc-pull \
  nichefinder-kill-sweep \
  nichefinder-promotion-eval \
  nichefinder-orchestrator \
  nichefinder-bol-feed-sync; do
    systemctl enable --now ${timer}.timer
done

# Verify all timers are active
systemctl list-timers --all | grep nichefinder
```

### 6.6 Cron schedule summary

| Timer | Schedule (NL time) | Job |
|-------|--------------------|-----|
| `nichefinder-discovery` | Sun 02:00 | Discovery agent — surfaces niche candidates |
| `nichefinder-scoring` | Sun 03:30 | Scoring agent — ranks candidates |
| `nichefinder-promotion-eval` | Sun 04:00 | Promotion gate evaluation |
| `nichefinder-kill-sweep` | Sun 04:30 | Kill-flag scan |
| `nichefinder-orchestrator` | Mon 06:00 | Weekly portfolio review |
| `nichefinder-validation-review` | Fri 18:00 | Validation agent run |
| `nichefinder-content-polish` | Mon/Wed/Fri 01:00 | Opus polish pass |
| `nichefinder-gsc-pull` | Daily 05:30 | GSC metrics pull |
| `nichefinder-conversions-reconcile` | Daily 06:30 | Affiliate reconciliation |
| `nichefinder-bol-feed-sync` | Every 2h | Bol product feed sync |

### 6.7 Smoke-test a job

Run discovery manually to verify the Hetzner → DB → Anthropic path works:

```bash
sudo -u nichefinder node /opt/nichefinder/apps/scrapers/dist/bin/discovery-once.js
```

Check Supabase: `select count(*) from niche_candidates;` should increase.

---

## 7. Affiliate webhook URLs

For each network you activate, configure the postback URL in its dashboard.
Generate a random token (e.g. `openssl rand -hex 16`) for each, set it in Vercel env, and
enter the matching URL:

| Network | Postback URL |
|---------|-------------|
| Bol.com | `https://<domain>/webhooks/bol/<WEBHOOK_BOL_TOKEN>` |
| Awin | `https://<domain>/webhooks/awin/<WEBHOOK_AWIN_TOKEN>` |
| Daisycon | `https://<domain>/webhooks/daisycon/<WEBHOOK_DAISYCON_TOKEN>` |
| Digistore24 | `https://<domain>/webhooks/digistore/<WEBHOOK_DIGISTORE_TOKEN>` |
| Impact | `https://<domain>/webhooks/impact/<WEBHOOK_IMPACT_TOKEN>` |

---

## 8. First admin login

1. Visit `https://<your-domain>/admin`
2. Enter your email (must be in `ADMIN_ALLOWED_EMAILS`)
3. Click the magic link in your inbox
4. You arrive at the operational dashboard

From here you can triage niche candidates, approve pages, and monitor costs.

---

## 9. Pending operator actions before the engine runs live

Apply these in sequence after deploying:

- [ ] Run `pnpm db:seed` and confirm tenant row exists
- [ ] Set `WEBHOOK_*_TOKEN` env vars and configure postback URLs in affiliate dashboards
- [ ] Add GSC service account to each GSC property
- [ ] Verify `BING_INDEXNOW_KEY` file is served at `https://<domain>/<key>.txt`
- [ ] Set `SLACK_WEBHOOK_URL` or confirm `OPERATOR_EMAIL` + `RESEND_API_KEY` for alerts
- [ ] Trigger `discovery-once.js` manually and verify candidates appear in `/admin/niches`
- [ ] Approve at least one candidate → validation starts automatically on Friday

---

## 10. Updating the deployment

### Code update (Vercel)

Vercel auto-deploys on push to `main`. DB migrations do **not** run automatically —
run `pnpm db:migrate` manually or via the `deploy-db.yml` GitHub Action.

### Code update (Hetzner)

```bash
cd /opt/nichefinder
git pull
pnpm install
pnpm build
# No restart needed — jobs are oneshot and read fresh code each run
```

### Secret rotation

1. Update value in Vercel env + `/etc/nichefinder/env`
2. Redeploy Vercel: `pnpm vercel --prod`
3. No Hetzner restart needed (env is read at job start)

---

## Troubleshooting

**Admin login loop** — check `ADMIN_ALLOWED_EMAILS` matches your email exactly (lowercase).

**Migrations fail** — ensure `DATABASE_URL` uses the *direct* connection string, not the pool URL. Drizzle migrations require a direct connection.

**Budget alert not firing** — confirm `OPERATOR_EMAIL` and `RESEND_API_KEY` are set in the Hetzner env file. The alert fires from the orchestrator job (Mon 06:00), not from Vercel.

**Discovery job produces 0 candidates** — check `ANTHROPIC_API_KEY` is set in `/etc/nichefinder/env` and the Anthropic account has credit. Check `journalctl -u nichefinder-runner@discovery -n 50`.

**GSC pull returns empty** — the service account JSON must be a single-line string with literal `\n` for newlines. Run `jq -c . service-account.json` to compact it before pasting.

See `docs/RUNBOOK.md` for ongoing operational procedures.
