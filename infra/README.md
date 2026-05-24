# Infra

Hetzner provisioning + deploy + systemd timers for the scraper plane.
Vercel hosts the web plane; its config lives in `vercel.json` at repo root
(added in a later commit) and is otherwise driven by the Vercel ↔ GitHub
integration.

## Layout

```
infra/
├── hetzner/
│   ├── provision.sh             # one-shot fresh-box setup (Ubuntu 24, Node 22, pnpm 9)
│   ├── deploy.sh                # rsync + remote pnpm install --prod + systemctl restart
│   ├── env.example              # /etc/nichefinder/env template
│   └── systemd/
│       ├── nichefinder-runner@.service           # parametric ExecStart=node index.js %i
│       ├── nichefinder-discovery.timer           # Sun 02:00 NL
│       ├── nichefinder-scoring.timer             # Sun 03:30 NL
│       ├── nichefinder-promotion-eval.timer      # Sun 04:00 NL
│       ├── nichefinder-kill-sweep.timer          # Sun 04:30 NL
│       ├── nichefinder-orchestrator.timer        # Mon 06:00 NL
│       ├── nichefinder-validation-review.timer   # Fri 18:00 NL
│       ├── nichefinder-gsc-pull.timer            # daily 05:30 NL
│       ├── nichefinder-conversions-reconcile.timer # daily 06:30 NL
│       └── nichefinder-bol-feed-sync.timer       # odd hours :35 NL
└── README.md (this file)
```

## First-time provisioning

1. Create a Hetzner CX22 (Ubuntu 24 LTS), German or Finnish region.
2. Add your SSH key during creation.
3. SSH in as root: `ssh root@<ip>`.
4. Clone the repo to `/tmp` and run `bash infra/hetzner/provision.sh`.
5. Populate `/etc/nichefinder/env` from `env.example`. Mode `640`, owner
   `root:nichefinder`. **Do not commit the populated file.**
6. Enable the timers you want active:
   ```
   sudo systemctl enable --now nichefinder-discovery.timer
   sudo systemctl enable --now nichefinder-scoring.timer
   ...
   ```

## Deploys

GitHub Actions workflow `.github/workflows/deploy-hetzner.yml` runs on every
push to `main` that touches `apps/scrapers/**` or `packages/**`. It:

1. Installs + builds the workspace.
2. `rsync`'s to `/opt/nichefinder`.
3. `pnpm install --prod --frozen-lockfile` on the remote.
4. Reloads systemd and restarts any enabled `nichefinder-*` units.

Secrets required in the GitHub `production` environment:
- `HETZNER_HOST`, `HETZNER_USER`, `HETZNER_SSH_KEY`

## Observability

- Logs: `journalctl -u nichefinder-runner@discovery.service -e -n 200`
- Timer status: `systemctl list-timers nichefinder-*`
- Disk: `du -sh /opt/nichefinder/* | sort -h`
- Sentry captures errors with `tenant_id` tags (configured in
  `apps/scrapers/src/lib/logger.ts` once SENTRY_DSN is set).
