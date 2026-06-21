# NicheFinder — Operator Runbook

This document covers every alert the engine can produce, how to diagnose it,
and what to do. It is the Phase 6.5 deliverable (CLAUDE.md §6.5.1).

---

## Quick-reference: admin URLs

| Page | URL |
|---|---|
| Dashboard | `/admin` |
| Niches | `/admin/niches` |
| Kill flags | `/admin/niches` → flag badge per niche |
| Approval queue | `/admin/approval` |
| Cost telemetry | `/admin/costs` |
| Orchestrator | `/admin/orchestrator` |
| Jobs (manual run) | `/admin/jobs` |
| First-party tests | `/admin/tests` |
| Promotions | `/admin/promotions` |

---

## 1. Claude budget alerts

### 1a. "Claude spend ≥80% of budget" (warning)

**Cause:** Month-to-date Anthropic spend has crossed 80% of `CLAUDE_MONTHLY_BUDGET_EUR`.

**Check:**
```
/admin/costs  →  "% van budget" stat
```

**Actions:**
- Review the `Per agent` table. High-cost agents: `content`, `orchestrator` (Opus).
- If the niche count is high, reduce `SCORING_BATCH_SIZE` in `.env.local` temporarily.
- If still in the first half of the month: reduce `SCORING_BATCH_LIMIT` in
  `/etc/nichefinder/env` on Hetzner, then `systemctl restart nichefinder-scoring.timer`.
- No immediate code change needed; the warning is informational.

### 1b. "Claude spend ≥100% of budget" (critical)

**Cause:** Hard ceiling hit. The agent SDK's cost-guard middleware aborts new
runs (throws `CostBudgetExceededError`).

**Actions (in order):**
1. Verify no runaway loop is active: check `agent_runs` for any run with
   `status='running'` older than 30 min; kill the Hetzner process if found.
2. Raise `CLAUDE_MONTHLY_BUDGET_EUR` in Vercel env **only after** reviewing
   which agent caused the spike.
3. Restart the Hetzner scrapers service: `systemctl restart nichefinder-scrapers`.
4. Resume the daily batch once you confirm the spike is explained.

---

## 2. Niche state alerts

### 2a. Niche stuck in `validating` >21 days

**Cause:** Not enough conversion data; or the validation job is not running.

**Check:**
```
Hetzner: journalctl -u nichefinder-validation --since "7 days ago" | tail -100
```

**Actions:**
- If the job failed: fix the error, re-run `node dist/bin/validation-once.js`.
- If the niche genuinely has no click data after 21 days: consider dropping
  it (kill flag → confirm in admin).

### 2b. Kill flag open >7 days unreviewed

**Cause:** The kill-scan ran but you haven't acted.

**Actions:**
- Open `/admin/niches`, review the niche's kill-flag details.
- Confirm or dismiss. If dismissing, add a note in `niches.notes`.

---

## 3. Affiliate webhook failures

### 3a. Conversion not showing up

**Check:**
```
Vercel logs: Functions → /api/webhooks/[network]/[token]
```

Look for `400` or `401` responses. Common causes:

| Error | Fix |
|---|---|
| `401 invalid token` | Regenerate `WEBHOOK_<NETWORK>_TOKEN` env, update postback URL in the affiliate network dashboard |
| `400 missing fields` | Network changed their payload schema; update `apps/web/app/webhooks/[network]/[token]/route.ts` |
| `500 DB error` | Check Supabase status at status.supabase.com |

### 3b. Reconciliation mismatch >5% delta

**Cause:** The daily reconciliation job found that tracked conversions differ
from network-reported totals by more than 5%.

**Check:**
```
Hetzner: node dist/bin/reconciliation-once.js --window 7
```

**Actions:**
- If delta is <15%: normal network delay; no action needed.
- If delta is >15%: open the affiliate network dashboard and compare raw
  transaction IDs. Update `conversions.status` for any wrongly-marked rows.

---

## 4. Scraper failures

### 4a. DataForSEO quota exceeded

**Symptom:** Scoring batch fails with `402` or `quota` in error.

**Fix:**
1. Check balance at `app.dataforseo.com` → Billing.
2. Top up or wait for monthly reset.
3. Re-run: `node dist/bin/scoring-once.js`.

### 4b. Bol.com OAuth token expired

**Symptom:** Bol API calls return `401`.

**Fix:**
- The Bol client auto-refreshes using `BOL_CLIENT_ID` / `BOL_CLIENT_SECRET`.
  If it still fails, verify the credentials haven't been rotated in the Bol
  Partner portal and update `.env.local` + Vercel env.

---

## 5. Restart procedures

### 5a. Restart all Hetzner timers + dispatcher

```bash
ssh hetzner
# Restart all nichefinder timers
systemctl list-unit-files 'nichefinder-*.timer' --no-legend | awk '{print $1}' | \
  xargs sudo systemctl restart
# Restart the persistent dispatcher
sudo systemctl restart nichefinder-job-dispatcher.service
# Verify
systemctl list-timers 'nichefinder-*' --all
```

### 5b. Re-run a specific one-shot job

```bash
ssh hetzner
cd /opt/nichefinder/apps/scrapers
node dist/bin/discovery-once.js
node dist/bin/scoring-once.js
node dist/bin/validation-once.js
node dist/bin/test-page-draft-once.js
node dist/bin/content-polish-once.js
node dist/bin/kill-scan-once.js          # runs nichefinder-kill-sweep.timer job
node dist/bin/orchestrator-once.js
node dist/bin/reconciliation-once.js
node dist/bin/bol-feed-sync-once.js
node dist/bin/gsc-pull-once.js
node dist/bin/niche-monthly-metrics-once.js
node dist/bin/algorithm-events-ingest-once.js
node dist/bin/promotion-once.js          # Sunday gate evaluation
node dist/bin/migration-dry-run-once.js  # dry-run only — real migration needs approval
```

**Scheduling order (NL time).** Two jobs feed the promotion gate and MUST run
before it, or the gate reads stale inputs. The systemd timers stagger them:

1. `niche-monthly-metrics` — daily **03:00** — per-niche revenue + organic-clicks closes (criteria 1–3)
2. `algorithm-events-ingest` — daily **03:30** — Google ranking-update windows (criterion 6)
3. `promotion-eval` — **Sun 04:00** — evaluates the gate

A missed `algorithm-events-ingest` run degrades safely: the gate just reads the
last-ingested events, and an empty table means criterion 6 passes (the
pre-ingestion default). It never blocks a promotion on stale data falsely.

**Enabling new timers (one-time).** `deploy.sh` rsyncs the unit files and
restarts already-enabled units, but a brand-new timer must be enabled once:

```bash
ssh hetzner
# Enable all timers (first deploy on a new box):
sudo systemctl enable --now nichefinder-discovery.timer
sudo systemctl enable --now nichefinder-scoring.timer
sudo systemctl enable --now nichefinder-validation-review.timer
sudo systemctl enable --now nichefinder-test-page-draft.timer
sudo systemctl enable --now nichefinder-content-polish.timer
sudo systemctl enable --now nichefinder-kill-sweep.timer
sudo systemctl enable --now nichefinder-orchestrator.timer
sudo systemctl enable --now nichefinder-promotion-eval.timer
sudo systemctl enable --now nichefinder-bol-feed-sync.timer
sudo systemctl enable --now nichefinder-gsc-pull.timer
sudo systemctl enable --now nichefinder-niche-monthly-metrics.timer
sudo systemctl enable --now nichefinder-algorithm-events-ingest.timer
sudo systemctl enable --now nichefinder-conversions-reconcile.timer
# Enable dispatcher service
sudo systemctl enable --now nichefinder-job-dispatcher.service
systemctl list-timers 'nichefinder-*' --all   # verify next-run times
```

### 5c. Restart Next.js on Vercel

Trigger a re-deploy via the Vercel dashboard or:
```bash
vercel deploy --prod
```

---

## 6. Secret rotation

### 6a. Anthropic API key rotation

1. Generate a new key at `console.anthropic.com`.
2. Update `ANTHROPIC_API_KEY` in:
   - Vercel: Project → Settings → Environment Variables
   - Hetzner: `/opt/nichefinder/.env.local`
3. Restart Hetzner scrapers (§5a).
4. Verify: `node dist/bin/scoring-once.js` should complete without auth error.

### 6b. Supabase service-role key rotation

1. Rotate in Supabase → Project Settings → API → Service Role Key.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel and Hetzner `.env.local`.
3. Restart Hetzner; redeploy Vercel.

### 6c. Affiliate webhook tokens

```bash
# Generate a new token for Bol:
openssl rand -hex 32
# Update WEBHOOK_BOL_TOKEN in Vercel + .env.local
# Update the postback URL in the Bol Partner portal
```

---

## 7. Anthropic outage fallback

**Symptom:** All agent runs fail with `503` or connection errors.

**Check:** https://status.anthropic.com

**Actions:**
1. Suspend the nightly batch:
   ```bash
   ssh hetzner
   systemctl list-unit-files 'nichefinder-*.timer' --no-legend | \
     awk '{print $1}' | xargs sudo systemctl stop
   sudo systemctl stop nichefinder-job-dispatcher.service
   ```
2. No content will be drafted or scored until Anthropic recovers. That is OK.
   The existing published pages remain live (ISR-cached on Vercel CDN).
3. Once Anthropic recovers, restart (§5a) and run any missed one-shots manually.

**Do NOT:**
- Switch to a different LLM provider mid-outage. The prompts are calibrated for
  Claude; an emergency swap produces uncalibrated output. Wait for recovery.

---

## 8. Database migrations

When a migration is needed (new schema):

```bash
# Generate
pnpm --filter @nichefinder/db drizzle-kit generate

# Review the generated SQL in packages/db/migrations/

# Apply to Supabase
pnpm --filter @nichefinder/db drizzle-kit migrate
```

Never run ad-hoc SQL in Supabase Studio for schema changes (CLAUDE.md #11).

---

## 9. Compliance checks (monthly)

Run this checklist at the start of each month:

- [ ] Every published page has the AI-assisted badge visible (`ai_assisted=true` in DB).
- [ ] `/ai-disclosure` loads on every tenant and is linked from the footer.
- [ ] Affiliate disclosure renders above the fold on every monetised page.
- [ ] Klaro CMP loads on every tenant site (check browser network tab for `klaro.js`).
- [ ] `robots.txt` on every tenant returns correct `User-agent: *` rules.
- [ ] `sitemap.xml` on every tenant lists only `published` pages.
- [ ] Claim verifier passes for all `published` pages: run a manual spot check in
  `/admin/niches/[id]` and verify no unsourced-claim warnings.

---

## 10. Cost ledger: adding manual entries

Vendor invoices (Vercel, Hetzner, Supabase, DataForSEO) appear in the
orchestrator's spend summary when entered in the `cost_ledger` table:

```sql
insert into cost_ledger (occurred_on, category, description, amount_cents, currency)
values ('2026-06-01', 'vercel', 'June Vercel Pro', 2000, 'EUR');
```

Categories: `vercel`, `supabase`, `hetzner`, `dataforseo`, `registrar`, `other`.

---

---

## 11. Admin job-trigger dispatcher

The dispatcher is a persistent systemd service that lets the admin UI queue
one-off job runs without SSH access. The web app inserts a `job_triggers` row;
the dispatcher picks it up within 30 s and spawns the matching bin.

### 11a. Enable on a fresh Hetzner instance

```bash
ssh hetzner
# Copy the unit file (deploy.sh does this on subsequent deploys)
sudo cp /opt/nichefinder/infra/hetzner/systemd/nichefinder-job-dispatcher.service \
        /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now nichefinder-job-dispatcher.service
systemctl status nichefinder-job-dispatcher.service
```

### 11b. Check dispatcher status

```bash
ssh hetzner
systemctl status nichefinder-job-dispatcher.service
journalctl -u nichefinder-job-dispatcher.service -n 50 --no-pager
```

The log line `[dispatcher] started — polling every 30s` confirms it is running.
Each spawned job logs `[dispatcher] job <id> done (exit 0)` or `failed (exit N)`.

### 11c. Dispatcher is down / not polling

```bash
ssh hetzner
sudo systemctl restart nichefinder-job-dispatcher.service
# Then verify in the admin UI that a "Nu starten" trigger shows up as done/failed.
```

Triggers queued while the dispatcher was down remain in `status='queued'` and
are picked up automatically when it restarts — no data loss.

### 11d. A triggered job is stuck in `status='running'`

The bin was spawned but never exited (or the dispatcher restarted mid-job).
Check the journal for the job's output, then manually update the row:

```sql
update job_triggers
set status = 'failed',
    error  = 'stuck — manually reset',
    finished_at = now()
where id = '<trigger-id>';
```

Then re-queue from the admin UI if needed.

### 11e. Adding a new triggerable job

1. Add the `id` to `ALLOWED_JOBS` in `apps/scrapers/src/jobs/dispatcher.ts`.
2. Add the same `id` to `ALLOWED_JOB_IDS` in `apps/web/app/admin/(gated)/jobs/actions.ts`.
3. Add a `JobMeta` entry to the `JOBS` array in `apps/web/app/admin/(gated)/jobs/page.tsx`.
4. Ensure the bin compiles to `dist/bin/<id>-once.js`.
5. Deploy scrapers + web; restart the dispatcher.

---

---

## 12. GitHub Actions CI secrets

The CI workflows require the following repository secrets (Settings → Secrets and variables → Actions → New repository secret):

| Secret | Where to get it | Used by |
|---|---|---|
| `DATABASE_URL` | `.env.local` → `DATABASE_URL` value | `deploy-db.yml` — runs Drizzle migrations on merge to main |
| `HETZNER_HOST` | Hetzner Cloud dashboard → Server IP | `deploy-hetzner.yml` |
| `HETZNER_USER` | Usually `root` or `deploy` (the SSH user you set up) | `deploy-hetzner.yml` |
| `HETZNER_SSH_KEY` | Private key matching the public key on the Hetzner server | `deploy-hetzner.yml` |

Until these are set, the deploy workflows will fail when triggered; the lint + typecheck + test step runs without any secrets and will pass.

**Vercel project ID note:** The live project is `prj_7PqJTx7KHaPGvMh1gTUBelvjDY3A` (hostname `nichefinder-web.vercel.app`). This is stored in `.env.local` as `VERCEL_PROJECT_ID`.

---

*Last updated: 2026-06-21 (middleware→proxy rename, GitHub secrets table, corrected VERCEL_PROJECT_ID). Update this file whenever a new alert type or operational procedure is added.*
