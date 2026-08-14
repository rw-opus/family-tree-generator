# Production Hardening Plan

Target scale: **~1,000 accounts**, professional (notarial) use, Malta business
hours. Realistic peak concurrency is tens of sessions, not thousands. Every
recommendation below is sized for that. Where the obvious "best practice" is
hyperscale engineering, this plan says so and rejects it.

This plan complements [`production-governance-decisions.md`](production-governance-decisions.md),
which remains the canonical governance brief. Section 8 of that document is a
list of things to _verify in the Supabase dashboard_; this plan is about what to
_build and automate_.

---

## 0. What the system actually is

| Layer                         | What it does                                                                             | Where load lands              |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
| `server.mjs` on Railway       | Serves the built SPA + `/healthz` + `/env.js`. No application logic, no database access. | Bandwidth and file reads only |
| Supabase Postgres + PostgREST | Auth, `family_trees`, entitlements, terms. All authorisation is RLS.                     | Real query load               |
| Supabase Edge Functions       | Stripe checkout + webhook                                                                | Rare (a purchase)             |
| Browser                       | The entire application: succession, ownership and tax calculation                        | Client CPU                    |

The important consequence: **the Node server is a static file host.** It cannot
be the bottleneck for correctness, only for bytes. Almost all "web app under
load" advice does not apply here. Effort belongs in payload size, Supabase
query shape, and deployment safety.

---

## 1. Load, concurrency and resource limits

### 1.1 Findings

| #   | Finding                                                                                                                                                                                      | Evidence                                                                                                                                                                       | Severity at 1k users                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| L1  | **No compression.** `sendFile` (`server.mjs:100`) streams raw bytes. No `Content-Encoding` anywhere.                                                                                         | Built assets total **1,039,581 B raw vs 289,931 B gzipped — 72% waste** on every cold visit                                                                                    | **High** — cheapest win available                                             |
| L2  | **The Home page downloads every tree in full.** `listFamilyTrees` (`services/familyTrees.js:36`) selects `tree_data` for all rows; the library only renders title, date and a warning count. | A 23-person fixture tree is 11 KB of `tree_data` against 114 B actually needed (~97×). A realistic 100+ person succession tree is 30–100 KB; 20 trees ≈ 0.6–2 MB per Home load | **Medium**                                                                    |
| L3  | **No graceful shutdown.** No `SIGTERM` handler; Railway's stop signal kills in-flight responses.                                                                                             | `server.mjs:180` — `listen()` and nothing else                                                                                                                                 | **Medium** — causes visible errors on every deploy                            |
| L4  | **No request logging.** Only a boot line. An incident leaves no server-side trace.                                                                                                           | `server.mjs:182`                                                                                                                                                               | **Medium** — blocks the incident runbook                                      |
| L5  | `stat()` + `createReadStream` per request, no in-memory cache                                                                                                                                | `server.mjs:77-101`                                                                                                                                                            | **Low** — ignore at this scale                                                |
| L6  | Single Node process, no clustering                                                                                                                                                           | —                                                                                                                                                                              | **Not a problem.** Node serves static files at thousands of req/s on one core |

### 1.2 What I will change

**L1 — precompress at build time, serve the variant.**
Generate `.br` and `.gz` beside each `dist/assets/*` in `scripts/write-build-info.mjs`
(or a sibling script), then have `sendFile` pick a variant from `Accept-Encoding`
and add `Vary: Accept-Encoding`. Build-time compression beats runtime `zlib`
here: zero CPU per request, maximum compression level, and the content never
changes between requests.

**L2 — split the list query.**
`listFamilyTrees` selects `id,title,created_at,updated_at` plus the two warning
arrays only. Add `fetchFamilyTree(id)` for the full `tree_data`, called when a
tree is opened. Workspace backup fetches full rows on demand. Local-only mode is
untouched.

**L3 — graceful shutdown.** `server.close()` on `SIGTERM`/`SIGINT`, stop
accepting new connections, allow in-flight responses to finish, hard-exit after
a 10 s deadline.

**L4 — one structured log line per non-200 response** plus an error log with the
request path. Not per-request access logging — that is noise at this volume and
a privacy question (paths can carry identifiers).

### 1.3 Explicitly NOT doing

- **No clustering / PM2 / worker threads.** One process is correct here.
- **No Redis, no queue, no read replicas.**
- **No app-level rate limiting in `server.mjs`.** It serves static files; the
  answer to bandwidth abuse is Cloudflare or Railway in front, not middleware.
- **No CDN as a launch requirement.** Worth it later if the audience spreads
  beyond Malta; immutable asset caching already does most of the work.
- **No load test rig.** A one-off `autocannon` run against `/` and `/healthz` to
  confirm headroom, recorded in the doc, is proportionate. A standing load-test
  pipeline is not.

### 1.4 Supabase limits to confirm (needs dashboard access)

Free tier pauses projects after inactivity and caps connections — unsuitable for
production. Pro is the realistic floor. Confirm: connection pooler mode and size,
statement timeout, and whether the project sleeps. These are settings, not code.

---

## 2. Automated backups

### 2.1 Layers

| Layer                | Mechanism                                               | Retention             | Purpose                                                                                                                                  |
| -------------------- | ------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Provider          | Supabase automatic backups / PITR (plan-dependent)      | Provider schedule     | Primary recovery. **Must be confirmed in the dashboard — the governance doc explicitly forbids claiming this is active until verified.** |
| 2. Offsite logical   | Nightly `pg_dump`, encrypted, pushed to an object store | 30 daily + 12 monthly | Survives loss of, or lockout from, the Supabase project                                                                                  |
| 3. User self-service | Existing "Download workspace backup"                    | User-held             | Already built; not disaster recovery                                                                                                     |

### 2.2 Design for layer 2

A scheduled GitHub Actions workflow (`.github/workflows/backup.yml`), nightly:

1. `pg_dump --format=custom --no-owner --no-privileges` against the pooler URL.
2. Encrypt with **`age` using a public key only** (`AGE_PUBLIC_KEY` as a repo
   variable). The private key never exists in CI — so a compromised Actions
   runner cannot decrypt any backup, past or future. This is the key property
   that makes an offsite dump acceptable under the governance rules.
3. Upload to the configured destination (S3-compatible: Backblaze B2, Cloudflare
   R2, or a second Supabase project's Storage).
4. Record size and row counts to the job summary; fail loudly if the dump is
   suspiciously small.

The workflow ships **disabled by default** (guarded on a secret being present),
because the governance brief requires encryption, secret ownership, storage
region, retention and deletion to be agreed before an offsite copy exists.

### 2.3 Restore rehearsal

`.github/workflows/restore-drill.yml`, **manual trigger only**: restores the
latest encrypted dump into a throwaway Postgres service container, then asserts
table counts and that RLS policies exist. Run quarterly. This is the step that
turns a backup into a _recovery capability_, and it is the item most often
skipped.

Private key handling: held by the operator outside CI, in a password manager,
with a documented second holder. Recorded in the backup doc.

---

## 3. GitHub Actions pipeline and canary deployment

### 3.1 Current state

One workflow (`quality.yml`): format, lint, test, build, `npm audit` on PR and
main push. Deployment is Railway's own GitHub integration — nothing gates it.
**A red build does not stop a deploy today.**

### 3.2 Target pipeline

```
PR ─────────► quality.yml      format · lint · unit tests · build · audit
              e2e.yml          Playwright suite against a preview server
              migrations.yml   (only when supabase/** changes) apply + drift check

main ───────► quality.yml + e2e.yml
                    │ (must pass)
                    ▼
              deploy.yml
                    ├─ 1. deploy to STAGING (Railway staging environment)
                    ├─ 2. wait for /healthz to report the new commit SHA
                    ├─ 3. run the E2E smoke subset against staging
                    ├─ 4. promote the same build to PRODUCTION
                    ├─ 5. poll /healthz + smoke subset against production
                    └─ 6. on failure → `railway rollback` + fail the run
```

### 3.3 On "canary"

Percentage-based traffic splitting is **not worth building here**, and Railway
does not offer it natively. At 1,000 users a 5% canary is ~2 concurrent sessions
— statistically useless as a signal, and it would need a proxy layer, session
affinity and per-cohort metrics that this system has no way to produce.

The proportionate equivalent, which is what the pipeline above implements:

- **staging gets the build first**, exercised by the real E2E suite;
- **production promotion is health-gated** on `/healthz` returning the expected
  commit SHA (this is exactly what `write-build-info.mjs` was built for);
- **automatic rollback** when the post-deploy smoke check fails.

That gives the actual benefit of a canary — a bad build is caught by machines,
not users — without the machinery. If genuine traffic-splitting is wanted later,
the honest prerequisite is a proxy (Cloudflare Workers) plus real per-release
metrics, and that is a separate project.

### 3.4 Other pipeline work

- Concurrency groups so a new push cancels the superseded run.
- Pin third-party actions by SHA (currently `@v6` tags — mutable).
- Add **Dependabot** (npm weekly + actions monthly). Today `npm audit
--audit-level=high` can break the build with no automated route to a fix.
- Branch protection on `main`: require `quality` and `e2e`, no force-push.
- `CODEOWNERS` so the owner is a required reviewer.

---

## 4. Regression test suite

### 4.1 What exists

804 unit/jsdom tests across 67 files — genuinely strong coverage of the domain
(succession rules, fractions, Article 5A, ownership ledger) and of individual
components. Recent additions cover the tree pan/centre behaviour and the sticky
workspace offset.

**What is missing is end-to-end coverage.** Nothing exercises the real
application in a real browser, so nothing catches a broken build, a bad CSP, a
missing asset, a router-less navigation dead end, or a regression that only
appears once components are composed.

### 4.2 What I will build

`tests/e2e/` driven by Playwright against `npm run build && npm start`, in
local-only mode with fictional data (no Supabase, no account, no PII):

| Spec                | Covers                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot.spec.js`      | App loads, terms gate appears, acceptance persists, `/healthz` reports the built commit, security headers present, no console errors         |
| `family.spec.js`    | Create a family, add people and relationships, rename, delete, reopen; persistence across reload                                             |
| `tree.spec.js`      | Pan by dragging a card, click-to-select still works, zoom, fit tree, find person, keyboard arrow navigation                                  |
| `property.spec.js`  | Property & Tax workspace: initial ownership, select-from-tree round trip, add outside owner, section navigation clears the sticky menu       |
| `transfers.spec.js` | Sale and donation from a person card and from an outside-owner card; edit; delete; sold-out owner reopens                                    |
| `tax.spec.js`       | **Asserts actual € figures** for a fixed scenario set — 10% pre-2004, 8% post-2004, mixed owners, partial totals when a source is incomplete |
| `backup.spec.js`    | Workspace backup downloads and round-trips                                                                                                   |
| `mobile.spec.js`    | 390 px: no horizontal overflow, sticky nav, single-finger pan, owner card sheet                                                              |

`tax.spec.js` is the one that matters most. It is the only test that would catch
a change silently altering money on screen, and it locks in the figures I
verified during the audit.

Runtime target: under 3 minutes in CI. Chromium only — this is a desktop-and-
tablet professional tool, and a Firefox/WebKit matrix triples cost for little
return at this size.

---

## 5. Database schema versioning and migrations

### 5.1 The actual problem

There are **two sources of truth**:

- `supabase/schema.sql` — a full, idempotent, hand-maintained script
- `supabase/migrations/*.sql` — four timestamped migrations

The first migration's own header says _"Kept in sync with supabase/schema.sql"_ —
i.e. synchronised by hand. Nothing verifies it. They will drift, and the drift
will be discovered during an incident, which is the worst possible time.

### 5.2 Policy

1. **`supabase/migrations/` is the single source of truth.** Every schema change
   is a new timestamped migration. Forward-only: no editing an applied migration,
   no rollback scripts — a mistake is corrected by a new migration.
2. **`supabase/schema.sql` becomes a generated snapshot**, not a hand-written
   file. It is regenerated from the migrations and committed, so it stays useful
   for bootstrapping a fresh project and for reviewing the current shape.
3. **CI proves they agree.** `migrations.yml`, triggered on `supabase/**`:
   - boot the local Supabase stack (`supabase start`),
   - apply all migrations from scratch (`supabase db reset`),
   - dump the resulting schema and **diff it against the committed
     `schema.sql`** — any difference fails the build,
   - run `supabase db lint`.
4. **Migrations reach staging before production.** Applied via
   `supabase db push --linked` against staging in the deploy workflow, gated on
   the drift check passing.
5. **Destructive changes need a two-step migration** (add nullable → backfill →
   switch → drop in a later release), so a rollback of application code never
   meets a column that no longer exists.
6. **RLS is part of the migration.** Any new table arrives with `enable row level
security`, its policies, and revoked default grants in the same file — never
   as a follow-up.

### 5.3 Why not a heavier tool

Prisma Migrate, Atlas or Flyway would each add a toolchain and a second schema
language for four migrations against a database whose most important feature is
RLS policies those tools model poorly. The Supabase CLI already does versioning,
diffing and linting. Using it properly is the right answer.

---

## 6. What is missing that neither list covers

Ranked by how much it would hurt.

| #   | Gap                                                                                                                                                                                                 | Why it matters                                                                                    | Effort                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| M1  | **No staging environment.**                                                                                                                                                                         | Blocks canary, blocks migration rehearsal, blocks restore drills. Everything in §3 depends on it. | Half a day, mostly Railway + a second Supabase project                            |
| M2  | **Silent Stripe webhook failure.** The idempotency ledger (`stripe_tree_events`) is sound, but nothing alerts if the webhook stops delivering. A customer pays €30 and silently receives no credit. | Direct revenue and trust loss                                                                     | Small — a scheduled query for paid orders with no matching `tree_generations` row |
| M3  | **No external uptime monitoring.** `/healthz` exists and nothing watches it.                                                                                                                        | You learn about outages from users                                                                | 15 minutes (UptimeRobot/BetterStack)                                              |
| M4  | **No alert routing or named responder.** Sentry is optional and off; no one is on the other end of anything.                                                                                        | An alert nobody receives is not monitoring                                                        | Decision, not code                                                                |
| M5  | **No dependency update automation.**                                                                                                                                                                | `npm audit --audit-level=high` in CI will eventually block every merge with no update path        | Dependabot config, 10 minutes                                                     |
| M6  | **No branch protection / CODEOWNERS.** Direct pushes to `main` are possible today (I did two).                                                                                                      | CI can be bypassed entirely                                                                       | 10 minutes                                                                        |
| M7  | **Actions pinned to mutable tags** (`actions/checkout@v6`).                                                                                                                                         | Supply-chain exposure in a repo with deploy credentials                                           | 10 minutes                                                                        |
| M8  | **No recorded DPA / processor register.** Supabase, Railway, Stripe and optionally Sentry all process Maltese client PII.                                                                           | GDPR Art. 28/30 obligation for a commercial product                                               | Paperwork, needs your legal review                                                |
| M9  | **Edge Function secrets and Stripe config are not captured anywhere.** If the Supabase project is lost, the runbook restores data but not the functions, secrets, webhook endpoint or price ID.     | Turns a 1-hour recovery into a day                                                                | Extend the incident runbook                                                       |
| M10 | **`/healthz` is shallow.** It reports the commit but never checks Supabase reachability, so the app can be "healthy" while completely unusable.                                                     | Deploy gating and uptime checks both trust it                                                     | Add `/readyz` with a cheap authenticated-free probe                               |
| M11 | **No error boundary verification.** Governance §4 requires a user-friendly boundary; nothing tests that it renders.                                                                                 | Silent white screen                                                                               | Covered by `boot.spec.js`                                                         |
| M12 | **Legal review still outstanding** (README says so). Terms, Privacy and the tax disclaimer are templates.                                                                                           | Blocks commercial launch regardless of engineering                                                | Yours                                                                             |

---

## 7. Sequencing

**Phase 1 — no external dependencies, I can do now**

1. Compression + graceful shutdown + error logging (`server.mjs`)
2. Split the tree list query
3. Playwright E2E suite + `e2e.yml`
4. `migrations.yml` drift check; regenerate `schema.sql` as a snapshot
5. Dependabot, action SHA pinning, concurrency groups
6. Backup + restore-drill workflows, shipped disabled pending §8 answers
7. Update `backup-and-account-deletion.md` and `incident-response.md`

**Phase 2 — needs your decisions or credentials** 8. `deploy.yml` with staging → production promotion and auto-rollback 9. Enable the backup workflow against a real bucket 10. Branch protection, CODEOWNERS, uptime monitor, alert routing

## 8. What I need from you

1. **Supabase plan** — Free or Pro? Determines whether provider backups and PITR
   exist at all, and therefore how hard layer 2 has to work.
2. **Staging** — do you want a second Railway environment and a second Supabase
   project? Without it, §3 degrades to health-gated deploy with rollback on
   production only, which is weaker but still a real improvement.
3. **Offsite backup destination** — B2, R2, S3, or a second Supabase project? The
   governance brief requires region and retention to be agreed before this is
   switched on.
4. **Who receives alerts**, and at what hours?
