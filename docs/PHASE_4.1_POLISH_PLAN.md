# Phase 4.1 — Content Agent polish pass: build plan

Status: **planned, not built** (awaiting the 3 decisions below).

## What already exists

- `contentAgent.runContentPolish` (Opus 4.7), `CONTENT_POLISH_SYSTEM_PROMPT`,
  `ContentPolishInputSchema`, disclosure enforcement — all done in
  `packages/agent-sdk/src/agents/content/`.
- The draft job pattern (`test-page-draft.ts`) and its DI/mocked-agent test
  pattern — reuse verbatim.

So 4.1 is **only the triggering job** (4.1.2) + internal-link feed (4.1.3).

## The job (to build): `apps/scrapers/src/jobs/content-polish.ts`

`runContentPolishJob({ db, runtime, pageId?, limit?, ... })`:

1. **Select** pages to polish: commercial/hero kinds
   (`product_review | comparison | buying_guide`) in `state IN (draft,
   pending_review)`, OR one operator-named `pageId`. (4.1.2)
2. For each page, build `ContentPolishInput`:
   - `draft` ← the page's current `title / meta_description / body_md`
   - `operator_edited_body_md` ← same current `body_md` (operator edits land in
     the body before re-polish)
   - `peer_pages` ← published pages for the same tenant
     (`url, title, kind`), capped at 50 — the internal-link feed (4.1.3)
   - `products` / `first_party_tests` / `existing_claims` ← see decision #2
3. `runContentPolish` (mocked in tests), then write the polished
   `body_md/title/meta_description/schema_jsonld/ai_disclosure_jsonld` back to
   the page. **State stays pre-approval** — operator still approves (gate #1).
4. Re-persist claims (reuse the `persistClaims` helper) so the Claim Verifier
   sees the polished page's claims.
5. Per-page error isolation; sum cost; CLI `bin/content-polish-once.ts`.

Tests mirror `test-page-draft.test.ts` (fake db + mocked `runContentPolish`).

## The 3 decisions (need operator input)

### D1 — where does `page.primary_keyword` come from for an existing page?
`ContentPolishInputSchema.page.primary_keyword` is required, but pages don't
store it.
- **Recommended:** synthesize from `niche.topic` (the body is the real content;
  the keyword is only context for the polish pass). Zero schema change.
- Alt: add `primary_keyword text` to `pages` (migration) and populate it in the
  draft job from the plan. Cleaner long-term, +1 migration.

### D2 — how do `claim_sources` with a `first_party_test_id` (no URL) map in?
`existing_claims[].sources` requires a `source_url` (URL). First-party-test
sources have no URL.
- **Recommended:** split — URL sources → `existing_claims[].sources`;
  first-party-test-backed claims → surface the test via the `first_party_tests`
  input instead (load from `first_party_tests` by id). No data lost.
- Alt: relax the schema to allow `{ first_party_test_id }` sources (agent-sdk
  change + prompt update).

### D3 — where do `operator_todos` / `polish_notes` / `needs_polish_pass` go?
The agent returns these; pages have no column for them, so today they're
dropped.
- **Recommended:** migration 0004 adds to `pages`:
  `operator_todos text[]`, `polish_notes text`, `needs_polish_pass boolean
  default false`, `polished_at timestamptz`. Surface `operator_todos` in the
  admin niche-detail page next to the Claim-Verifier todos.
- Alt: a separate `page_polish_runs` table (fuller audit, more work).

## Build order once decided
1. migration 0004 (if D1-alt / D3-recommended) + Drizzle schema
2. `content-polish.ts` + tests
3. `bin/content-polish-once.ts` + cron note (operator-triggered first; auto
   for hero kinds later)
4. admin surface for `operator_todos` (if D3)
