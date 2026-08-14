# Production Hardening Plan

FAMILY TREE GENERATOR · MALTA

## Target

Commercial launch for approximately:

- 1,000 professional accounts
- Tens of simultaneous active sessions
- Supabase-hosted authentication and database
- Railway-hosted frontend/static server
- Supabase Edge Functions for Stripe
- Client-side succession, ownership and tax calculations

The objective is not hyperscale engineering.

The objective is:

1. prevent one account accessing another account's data;
2. prevent loss or corruption of professional data;
3. prevent manipulation of paid entitlements;
4. make deployments recoverable;
5. make failures detectable;
6. prove backups can actually restore the service;
7. protect sensitive family/property/succession information;
8. preserve legal and calculation correctness.

---

## 00 — Architecture and security boundary

### Current architecture

**Railway / `server.mjs`** serves the built SPA, `/healthz`, `/env.js` and
static assets. It does not contain the primary business logic or database
access.

**Supabase** is responsible for authentication, `family_trees`, entitlements,
terms acceptance, other persisted application data, PostgreSQL, PostgREST, RLS
and Edge Functions.

**Browser** is responsible for family-tree editing, succession, ownership and
tax calculations, UI state and local-only mode.

**Stripe** is responsible for payment events.

### Security conclusion

The principal security boundary is Supabase + RLS + database grants +
authentication + Edge Functions.

The browser is never trusted. Anything supplied by the browser must be treated
as potentially malicious or malformed.

RLS must be proven by automated tests, not assumed merely because policies
exist.

---

## 01 — P0: Tenant isolation and authorisation

### A1 — Automated cross-account RLS tests

Create two independent test users, Alice and Bob. Alice creates Tree A. Bob must
be unable to select, fetch by UUID, update, delete, alter ownership of, use any
RPC against, reach through REST/PostgREST, or manipulate records associated with
Tree A. Repeat in reverse.

Test authenticated user, anonymous user, expired/invalid authentication,
malformed IDs and guessed UUIDs. These tests must run in CI.

**Severity: CRITICAL**

### A2 — Audit every exposed table

For every table exposed through Supabase: RLS enabled; appropriate SELECT,
INSERT, UPDATE and DELETE policies; grants reviewed; anonymous and authenticated
access explicitly reviewed.

No new exposed table may be merged without its RLS and grants in the same
migration.

**Severity: CRITICAL**

### A3 — Service-role key audit

Confirm the service-role key never enters browser code, never appears in
`/env.js`, is not contained in the built bundle, is not logged, and is only
available to workloads that genuinely require it.

Add a CI/build check for known secret patterns.

**Severity: CRITICAL**

### A4 — Direct API security tests

Do not test security solely through the application's UI. Tests must call
Supabase/PostgREST directly and attempt forbidden operations.

> If the browser can send it, assume an attacker can send it manually.

**Severity: CRITICAL**

---

## 02 — P0: Authentication and account security

### B1 — Authentication review

Document and verify email verification, password requirements, password reset,
reset-token expiration, reset-token reuse, session expiration, refresh-token
behaviour, logout, account deletion and revoked account behaviour.

### B2 — MFA

Evaluate MFA for professional accounts. Prefer MFA available from launch, MFA
strongly encouraged, and the ability to require MFA later without redesigning
the account model. MFA should be compulsory for administrative infrastructure
accounts.

### B3 — Infrastructure account MFA

Require MFA for GitHub, Supabase, Railway, Stripe, domain registrar, DNS
provider and backup provider. Store recovery codes securely. Document a
break-glass recovery procedure.

### B4 — Session behaviour

Determine and implement inactivity behaviour, long-lived office sessions,
password reset/session invalidation, account suspension, and logout from all
devices if required.

### B5 — Account enumeration

Ensure login and password-reset responses do not unnecessarily reveal whether a
particular email address has an account.

---

## 03 — P0: Data integrity

### C1 — Tree schema version

Every saved `tree_data` object must contain an explicit schema version, for
example `tree_schema_version: 3`. Application code must know how to read
supported old versions, migrate them forward, and reject impossible future
versions safely. Database migrations alone are not sufficient.

### C2 — Validate every tree

Before persistence or import: validate required structure, types and
relationship references; reject impossible data structures; impose reasonable
limits; reject excessive nesting and excessively large payloads.

Do not trust browser-generated JSON.

### C3 — Payload limits

Define maximum acceptable persons per tree, relationships, properties,
transfers, notes/text length, overall `tree_data` size and workspace-backup
upload size. Limits should be generous enough for real Maltese succession
matters but finite.

### C4 — Concurrent edit protection

Prevent stale-browser overwrites using optimistic concurrency — a tree version
number, or an `updated_at` condition. If Client A saves version 15 and Client B
attempts to save version 15 after A has produced version 16, B must receive a
conflict rather than silently overwriting A.

### C5 — Save status

The UI must clearly distinguish Saved, Saving, Save failed and Conflict
detected. Do not allow users to believe work is persisted when it is not.

### C6 — Delete recovery

Implement recoverable deletion: delete moves the tree to Trash, with a 30-day
restoration period and permanent deletion later. Avoid requiring full disaster
recovery merely because a user accidentally deleted one tree.

### C7 — Database constraints

Where relational data permits, use database enforcement: `NOT NULL`, foreign
keys, unique constraints, `CHECK` constraints and sensible cascade/restrict
behaviour.

RLS answers _who may act_. Constraints answer _what states are valid_.

### C8 — Transactions

Operations affecting multiple related rows must be atomic where necessary.
Either the whole change succeeds or none of it succeeds.

---

## 04 — P0: Calculation correctness

This is a legal/professional application. Incorrect calculations can be more
damaging than temporary downtime.

### D1 — Maintain unit-level calculation tests

Do not move calculation testing principally to Playwright. Use detailed
unit/domain tests for succession, fractions, ownership, transfers, tax, Article
5A and historical rules. Use E2E tests only to prove that the UI correctly
integrates those engines.

### D2 — Golden legal scenarios

Maintain authoritative fixtures with the factual scenario, the applicable legal
rule, expected fractions, expected monetary result, and date/rule version. Do
not rely merely on "verified during an audit".

### D3 — Boundary-date tests

Test every legal/tax change at the day before the change, the effective date,
and the day after.

### D4 — Monetary precision

Review JavaScript number usage. Monetary calculations must not rely on
uncontrolled binary floating-point rounding. Prefer controlled integer cents,
decimal arithmetic, or exact fractions where appropriate.

### D5 — Fraction invariants

Test invariants including: ownership cannot be negative; ownership cannot exceed
100%; relevant ownership totals equal 100%; a transfer cannot exceed the
transferor's interest; no share disappears merely through calculation; results
are deterministic; rounding is consistent.

### D6 — Property-based testing

Generate large numbers of valid and invalid family structures. Test multiple
marriages, deceased descendants, missing descendants, half relationships,
complex representation, many heirs, chained successions, unusual ownership
fractions, contradictory relationships, malformed dates and cycles.

### D7 — Legal rule versioning

Calculations depending on historical law should be capable of identifying the
rule/version applied. Do not make later legislative updates silently reinterpret
an old saved calculation unless that is explicitly intended.

---

## 05 — P0: Stripe and entitlement security

### E1 — Webhook signature verification

An automated test must prove a valid Stripe webhook is accepted, an invalid
signature is rejected, and an unsigned payload is rejected.

### E2 — Idempotency

Repeated delivery of the same event must not create duplicate entitlements,
credits or payments.

### E3 — Out-of-order events

Webhook processing must not assume Stripe sends all events in chronological
order.

### E4 — Browser manipulation

Prove a user cannot grant himself a subscription or paid entitlement through
local-storage modification, JavaScript modification, a direct PostgREST call, a
modified Stripe price ID, direct Edge Function invocation, or a manipulated
client request. Paid status must ultimately be determined by trusted
server/database state.

### E5 — Payment reconciliation

Add a periodic reconciliation mechanism comparing successful Stripe
transactions/subscriptions with local entitlements. Webhook monitoring alone is
insufficient.

### E6 — Webhook failure alerts

Alert when Stripe delivery repeatedly fails.

---

## 06 — P0: Browser and application security

### F1 — Content Security Policy

Create an explicit CSP allowing only resources genuinely required by the
application, Supabase and Stripe. Avoid unsafe script execution wherever
practical.

### F2 — Security headers

Review and configure `Content-Security-Policy`, `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and CSP
`frame-ancestors`.

### F3 — XSS tests

Store malicious-looking values as fictional names/descriptions: `<script>`,
HTML, SVG-like strings, quotes and event-handler-like strings. Prove they are
always rendered as data rather than executed.

Test family cards, property descriptions, searches, dialogs, exports, error
messages, and backups/import.

### F4 — `/env.js`

Only public client configuration may appear there. Never service-role keys,
database password, Stripe secret key, deployment secrets or backup credentials.

### F5 — CORS

Review explicitly for Supabase Edge Functions and any custom API. Only required
origins should be allowed.

### F6 — Redirect validation

Validate authentication redirects, Stripe success and cancellation URLs, and
password reset redirects. Prevent open redirects.

---

## 07 — P0: Backup and disaster recovery

Backups are only useful if restoration has been proven.

### G1 — Determine RPO

Explicitly decide acceptable maximum data loss, for example one hour. A nightly
backup alone permits potentially almost 24 hours of data loss.

### G2 — Determine RTO

Explicitly decide how long the application may remain unavailable after
catastrophic failure, for example four hours. Backup architecture should derive
from RPO/RTO rather than arbitrary schedules.

### G3 — Supabase provider backups

Verify in the actual project: plan, automatic backup status, backup retention,
PITR availability, PITR enabled/disabled, compute requirements. Do not infer
PITR merely from having Supabase Pro.

### G4 — Independent offsite backup

Maintain an encrypted offsite database backup independently of the production
Supabase project. Before implementing the final command, verify the supported
Supabase backup/restore mechanism against the chosen connection type. Do not
assume generic `pg_dump` against an arbitrary pooler configuration is
sufficient.

### G5 — Public-key encryption

Encrypt CI-created backups with a public key. CI must not possess the
corresponding private decryption key.

### G6 — Backup integrity

For every backup: verify command success, record size, record relevant counts,
create a checksum, verify the encrypted file, record the timestamp.

### G7 — Backup immutability

Where practical use object versioning, retention protection, and credentials
separate from production. Production compromise should not automatically permit
deletion of every historical backup.

### G8 — Full recovery inventory

A database dump alone is not disaster recovery. Recovery documentation must
include PostgreSQL data, Supabase Auth, RLS policies, database functions, Edge
Functions, Edge Function secrets, Stripe webhook configuration, Stripe
product/price IDs, entitlement configuration, authentication configuration,
allowed redirect URLs, Railway configuration, DNS, custom domain, GitHub
deployment and monitoring configuration.

### G9 — Restore drill

Quarterly restore into an isolated non-production environment. The drill must
prove: the database restores; known test users can authenticate; a known tree
loads; Alice/Bob RLS isolation still works; functions exist; entitlement data
works; the application starts against restored data.

Record date, duration, failures and corrective actions.

---

## 08 — P0/P1: Staging

Create genuine staging with a separate Railway environment, separate Supabase
project, separate Stripe test configuration and separate secrets.

Never connect staging to the production database. Never copy identifiable
production family-tree data into staging by default. Use fictional/synthetic
data.

---

## 09 — Deployment pipeline

### PR pipeline

Required checks: format; lint; unit tests; calculation tests; RLS/security
tests; migration tests; build; dependency/security checks; Playwright E2E.

A failed required check must block merge.

### Main

After required CI passes:

1. produce an immutable build;
2. deploy the same build/artifact to staging;
3. confirm the expected commit/build ID;
4. run smoke tests;
5. promote the exact same build to production;
6. verify production health;
7. run production-safe smoke tests.

Do not rebuild separate production output after staging passed.

### Database migrations

Migrations reach staging first. The production migration must be the same
reviewed migration. Prevent concurrent migration jobs.

### Rollback

Application rollback must be supported. Database changes must remain backward
compatible across the deployment window. Use expand/contract migrations: add;
deploy compatible application; backfill; switch; only later remove obsolete
fields.

A bad migration is normally corrected with a new forward migration. Database
backups/PITR remain the emergency recovery mechanism for catastrophic changes.

---

## 10 — Schema versioning

`supabase/migrations/` is the authoritative database history.

Rules: every schema change is a new timestamped migration; never silently edit
an applied migration; RLS included with table creation; grants included;
destructive migrations staged carefully.

`schema.sql` may remain only as a generated snapshot, marked clearly:

```
GENERATED FILE — DO NOT EDIT MANUALLY
```

CI should verify that migrations create the expected schema. Also periodically
check remote production schema drift, because local migration consistency does
not prove production has not been manually modified.

---

## 11 — E2E suite

Use Playwright.

**boot** — app starts; terms gate; correct terms version persistence; expected
commit; security headers; no unexpected console errors.

**tenant-security** — Alice/Bob isolation. Mandatory even if database-level
tests already exist.

**family** — create; edit; relationships; rename; delete; restore; reopen;
reload persistence.

**tree** — select; drag; pan; zoom; fit; search; keyboard navigation.

**property** — ownership; tree selection; outside owners; relevant navigation.

**transfers** — sale; donation; edit; delete; exhausted ownership.

**tax** — UI-level validation against a selected group of golden scenarios.

**backup** — export; import; round-trip; wrong version; corrupted file;
oversized file; malicious content.

**concurrency** — open the same tree in two browser contexts; verify a stale
save does not overwrite newer changes silently.

**failure** — simulate failed save/network loss and verify the UI does not claim
data was saved.

**large tree** — a realistic stress fixture significantly larger than the normal
case.

---

## 12 — Browser support

Define the supported browser policy. If iPads are supported, WebKit testing is
required because iPad browsers use Apple's browser engine.

Recommended CI: Chromium full suite; WebKit important smoke/workflow suite.
Firefox optional unless supported formally.

---

## 13 — Observability

**Server logging** — log timestamp, status, request/correlation ID,
release/commit and error category. Do not log tokens, personal data, sensitive
query strings or secrets.

**Client error monitoring** — capture browser exceptions. Any external service
must be configured to avoid sending names, family-tree payloads, property
descriptions, tax data or tokens.

**Supabase monitoring** — failed database/API requests; authentication problems;
Edge Function failures; database resource use; slow queries.

---

## 14 — Health and uptime monitoring

Separate **liveness** (is the web process responding?), **readiness** (is the
expected build correctly deployed?) and a **synthetic application test** (can a
safe test workflow communicate with the required backend?).

External monitoring should alert a named responder. Define the alert destination
and escalation path.

---

## 15 — Dependency and supply-chain security

Dependabot; npm updates; GitHub Actions updates; third-party Actions pinned by
full commit SHA; lockfile committed; reproducible `npm ci`; Node version pinned;
Supabase CLI version pinned; minimal GitHub Actions permissions; production
secrets restricted to the production deployment environment.

Review licences before commercial launch.

---

## 16 — GitHub controls

Protect `main`: require a pull request, required CI, no force push, required
review, and CODEOWNERS where useful.

CODEOWNERS alone does not require code-owner approval — repository rules must
enforce it.

Production deployment credentials must not be available to ordinary PR jobs.

---

## 17 — Abuse and rate controls

No application-level rate limiting is necessary merely for static assets.
Rate/abuse protection must nevertheless be reviewed for login, password reset,
signup, Edge Functions, Stripe checkout creation and expensive Supabase
operations.

---

## 18 — Performance

Performance comes after correctness and security.

**P1 — Split tree listing.** The home/library query should fetch only the
metadata required to display the list. Do not download every `tree_data` blob.
Load the full tree only on opening it.

**P2 — Compression.** Compress static assets using deployment/edge compression
or build-time Brotli/gzip. Ensure `Vary: Accept-Encoding` and suitable immutable
caching for hashed assets. Worthwhile but not a launch-blocking security issue.

**P3 — Static server.** No need for PM2, clustering, Redis, workers, read
replicas or Kubernetes.

---

## 19 — Graceful shutdown

Handle `SIGTERM` and `SIGINT`. Stop accepting new requests and allow active
responses a short bounded period to complete.

---

## 20 — Large-tree performance

Benchmark 25, 100, 250 persons and a larger realistic stress case. Measure
opening, editing, layout, calculations, save and memory use. Set sensible
performance budgets.

---

## 21 — Privacy/GDPR engineering

Obtain legal review before commercial launch. Engineering must support the
resulting policy.

Prepare a data-flow map; controller/processor analysis; processor/subprocessor
register; DPA requirements; retention policy; account deletion policy; backup
deletion treatment; DSAR procedure; breach response; data-location assessment;
DPIA assessment where appropriate.

Map the actual data sent to Supabase, Railway, Stripe, the monitoring provider
and the backup provider. Do not merely assume each vendor receives every
category of data.

---

## 22 — Local-only mode

Document exactly what is stored locally. Provide a clear delete/reset function,
import validation, schema versioning and corruption handling.

Sensitive local information must not accidentally remain after the user believes
it has been removed.

---

## 23 — Terms and legal versioning

Record terms version, acceptance timestamp and user ID. If Terms materially
change, support requiring acceptance of the new version. Do not treat Terms
acceptance as interchangeable with GDPR consent.

---

## 24 — Operational security

Maintain an inventory of persons with privileged access to GitHub, Supabase,
Railway, Stripe, DNS/domain, backups and monitoring. Review access periodically.
Immediately revoke access when no longer required.

---

## 25 — Incident response

Document response to suspected account compromise; cross-tenant exposure; leaked
secret; data corruption; accidental deletion; failed Stripe entitlement; broken
deployment; database outage; total Supabase project loss.

Include named responsibility and escalation.

---

## 26 — Pre-launch security review

Before commercial launch perform a focused security review/penetration test of
Supabase authentication; RLS; direct API access; service-role exposure; Edge
Functions; the Stripe entitlement flow; XSS/input handling; account recovery;
and backup restore.

---

## 27 — Release priorities

### P0 — BLOCKS COMMERCIAL LAUNCH

threat/security-boundary review; RLS cross-tenant tests; direct API
authorisation tests; service-key/secret audit; authentication review;
infrastructure MFA; Stripe signature/idempotency/entitlement security; tree
validation/schema versioning; concurrency protection; save failure behaviour;
calculation precision and golden cases; backup recovery design; proven restore;
staging isolation; CI required before production; security headers/CSP; external
uptime alerts; privacy/legal review.

### P1 — SHOULD BE DONE AT OR IMMEDIATELY AFTER LAUNCH

Trash/restore; audit trail; client error monitoring; database performance
monitoring; Dependabot; supply-chain controls; remote schema-drift checking;
property/fuzz testing; WebKit testing; large-tree benchmarks; payment
reconciliation.

### P2 — OPTIMISATION

Brotli/gzip; CDN if useful; additional visual regression; broader browser
matrix; additional performance optimisation.

---

## 28 — Explicitly unnecessary at current scale

Do not add without evidence that it is needed: Kubernetes; microservices; Redis;
message queues; worker clusters; read replicas; multi-region database;
percentage traffic canary infrastructure; standing high-volume load testing;
Elasticsearch; a bespoke observability platform.

The system should remain deliberately simple.

---

## 29 — Definition of production ready

Commercial launch is permitted only when all P0 items are either completed and
tested, or consciously accepted as a documented risk by the owner.

A feature is not considered hardened merely because code exists. For critical
controls there must be evidence: an automated test; configuration verification;
a restore drill; a monitoring result; a documented operational procedure.

The key production question is not "Does it work?" It is:

> Can we prove that it remains secure, correct and recoverable when users,
> browsers, deployments, payments and infrastructure behave unexpectedly?
