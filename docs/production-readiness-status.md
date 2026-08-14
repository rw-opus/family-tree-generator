# Production readiness status

This is the evidence register for the controls in
[`production-hardening-plan.md`](production-hardening-plan.md). It is not a
launch approval. A control is **verified** only when the repository or the
named operator record contains repeatable evidence.

Baseline reviewed: 14 August 2026, commit `b676991`.

The first hardening tranche is implemented in
[pull request 57](https://github.com/rw-opus/family-tree-generator/pull/57).
Its required Quality, E2E and Security checks have passed against a fresh
checkout and disposable Supabase instance. The pull request still requires the
independent approval enforced by the `main` branch protection rule; none of its
migrations or application changes is recorded here as deployed production state.

## Launch-blocking controls

| Control                                    | Status                                      | Evidence                                                                                                                                                                                                                                                          | Required next evidence                                                                                                              |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Cross-account RLS and direct API denial    | Verified in required CI                     | `tests/security/rls.test.js`; the Security workflow starts a clean Supabase instance and makes direct Alice/Bob/anonymous PostgREST requests. PR 57 also passes correctly signed expired-token denial, direct RPC denial and pgTAP catalog/grant invariants       | Repeat the direct tests against isolated staging, then record the result                                                            |
| Browser cannot grant paid entitlement      | Verified locally                            | Database grants/RLS tests and Stripe entitlement tests                                                                                                                                                                                                            | Invoke deployed staging checkout directly with manipulated requests                                                                 |
| Service-role/secret exclusion              | Verified in required CI                     | `scripts/scan-secrets.mjs` scans source, the production bundle, `.env.*`, key/certificate files and GitHub token patterns with fail-closed size handling. GitHub secret scanning and push protection are enabled                                                  | Review repository history and record GitHub validity-check availability                                                             |
| Tree schema/version and payload validation | In progress                                 | A separate stacked branch adds a persisted serialization version, strict client validation, local/cloud quarantine, GEDCOM limits and a database trigger for direct writes                                                                                        | Complete review, pass the fresh Supabase Security workflow, then deploy through staging after a production aggregate-only preflight |
| Concurrent-edit protection                 | Verified in required CI; deployment pending | PR 57 adds a database-owned revision, database-enforced compare-and-swap RPC, typed conflict, conflict-safe queue pause and direct competing-write regression                                                                                                     | Add browser-level conflict resolution/reload coverage and deploy through staging                                                    |
| Save state and failure behaviour           | Verified in required CI; deployment pending | Saving, Saved, Save failed and Conflict are globally visible on Home, Tree and Property & Tax; failed/conflicting work stays open and dirty                                                                                                                       | Exercise offline failure and two-browser conflict recovery in staging E2E                                                           |
| Calculation correctness                    | Partial                                     | Extensive domain tests, exact fractions and cent reconciliation                                                                                                                                                                                                   | Independently approve golden legal scenarios, persist the legal ruleset version and add boundary/fuzz tests                         |
| Stripe signature, idempotency and ordering | Verified in DB CI; staging pending          | PR 57 processes event claim and entitlement atomically through a service-role-only RPC; required Security CI covers duplicate/concurrent delivery, rollback/retry, expired-before-paid and stale failure events                                                   | Configure a staging webhook and prove valid/invalid signatures against the deployed handler; configure production webhook           |
| CSP and security headers                   | Verified for current live origin            | Header tests and live response inspection                                                                                                                                                                                                                         | Retest after every server/CSP dependency change                                                                                     |
| Edge Function CORS                         | Implemented, deployment pending             | Checkout now uses the environment's exact `APP_URL`; webhook browser CORS is disabled                                                                                                                                                                             | Deploy to isolated staging and prove approved-origin acceptance plus unapproved-origin denial before production deployment          |
| Authentication/session review              | Partial                                     | Invitation-only local config, reset UI and TOTP configuration                                                                                                                                                                                                     | Record hosted settings; test enumeration, reset reuse/expiry, revocation, suspension and MFA enrolment/challenge                    |
| Backup and restore                         | Missing                                     | User JSON export and recovery procedure only                                                                                                                                                                                                                      | Decide RPO/RTO, verify provider/PITR settings, configure encrypted independent backup and complete a timed isolated restore drill   |
| Staging isolation                          | Unverified                                  | No repository-linked environment record                                                                                                                                                                                                                           | Record separate Supabase, Railway and Stripe-test environments using synthetic data                                                 |
| Deployment gate and rollback               | Partial                                     | `main` requires a pull request, one independent approval and strict `verify`, `browser` and `tenant-isolation` checks; stale approvals are dismissed, the last push requires separate approval, force pushes/deletion are blocked and administrators are included | Prove immutable staging-to-production promotion, deploy-after-CI ordering and Railway rollback                                      |
| Browser support                            | Verified smoke subset in required CI        | PR 57 retains full Chromium E2E and passes iPhone/iPad WebKit boot, edit-persistence and Property & Tax navigation smoke tests with traces/screenshots                                                                                                            | Expand WebKit coverage only where the supported-browser policy requires it                                                          |
| Dependency and supply-chain controls       | Verified in required CI                     | Node/npm and Supabase CLI are pinned; Actions use immutable SHAs; compatible current dependencies and the lockfile remove the known high advisory; the full high-severity audit reports no vulnerability                                                          | Continue automated update review and separately assess breaking major upgrades                                                      |
| External uptime/error alerts               | Missing                                     | `/healthz` and optional privacy-reduced Sentry integration                                                                                                                                                                                                        | Configure named alert destinations and run an alert-delivery exercise                                                               |
| Privacy/legal review                       | Missing                                     | Draft Terms, Privacy Notice, deletion and incident procedures                                                                                                                                                                                                     | Obtain and record Maltese legal/GDPR approval and the processor/retention/DSAR decisions                                            |

## Provider-side verification record

The following cannot be inferred from source code. Record the verifier, date,
environment and a link or screenshot kept in the approved operational evidence
store; do not commit credentials or client data.

- GitHub (recorded 14 August 2026): `main` requires a pull request and strict
  `verify`, `browser` and `tenant-isolation` checks; administrators are
  included; force pushes and deletion are blocked; linear history and resolved
  conversations are required. One independent approval is required, stale
  approvals are dismissed, and the last push needs approval by someone other
  than its author. Secret scanning, push protection and Dependabot security
  updates are enabled. Secret-validity checks still report disabled, and
  privileged-owner MFA remains operator evidence.
- Supabase plan, region, backup retention, PITR, Security/Performance Advisors,
  network restrictions, hosted Auth settings, SMTP, CAPTCHA, MFA and recovery
  owners.
  - Read-only provider verification on 14 August 2026 found the production
    project healthy in `eu-west-1` on PostgreSQL `17.6`, but the organization is
    on the **Free** plan. [Supabase's current backup guidance](https://supabase.com/docs/guides/platform/backups)
    recommends regular off-site CLI dumps for Free projects; paid
    scheduled-backup and PITR evidence is therefore absent.
  - The same provider check reported leaked-password protection disabled. The
    information-only RLS advisory for `stripe_tree_events` is expected because
    browser roles have no table policy or grant and the service-role-only RPC is
    the intended boundary.
  - An aggregate-only tree preflight found three production rows, all currently
    missing the new serialization marker, with no ID/title/people mirror or core
    envelope mismatch. The largest payload was 40,101 bytes and the largest tree
    had 67 people. No names, identifiers or payload contents were read or logged.
- Railway staging/production separation, immutable promotion, health checks,
  rollback and deploy-after-CI behaviour.
- Stripe test/live separation, webhook endpoint health, retry alerts,
  reconciliation and administrator MFA.
- DNS/domain registrar, monitoring and backup-provider access/MFA/recovery.

## Version review — 14 August 2026

The hardening branch pins the current Node 24 LTS patch (`24.19.0`) and its npm
11 line (`11.17.0`). It also updates the security- and delivery-sensitive
dependencies reviewed in this tranche: Supabase JS/Functions `2.112.3`,
Supabase CLI `2.114.0`, Stripe `22.5.0`, Playwright `1.62.1`, Sentry `10.70.0`
and ESLint `10.8.1`. The lockfile has no known high-severity advisory under the
full production-and-development audit.

React 19, Vite 8/plugin-react 6, jsdom 30, lucide-react 1 and globals 17 are
available as breaking major upgrades. They are deliberately not mixed into
this security/data-integrity tranche. Each should be assessed in a separate
upgrade pull request with the full unit, Chromium and WebKit matrix; none is a
launch blocker while the current lockfile audit remains clean.

## Release rule

Commercial launch remains blocked while any launch-blocking row is **Missing**
or **In progress**, unless the owner records a dated, explicit risk acceptance
with scope, mitigation, responsible person and review date. A passing build or
the existence of a control in source code is not, by itself, production proof.
