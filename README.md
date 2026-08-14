# Family Tree Generator — Property Succession Calculator

A commercial Maltese property ownership and succession workspace. It combines a family tree with intestate and testamentary inheritance modelling, causa mortis declarations, fractional ownership transfers, and indicative property-tax calculations.

## Commercial model

- Every registered account receives five lifetime tree generations free of charge.
- Every later new tree or GEDCOM import consumes one paid tree credit costing €30, unless an operator has granted that account unlimited tree creation.
- Editing, renaming and reopening an existing tree does not consume another credit.
- Deleting a tree does not restore its free or paid generation credit.
- The database trigger is the authority for the allowance; the browser cannot bypass it.

## Start locally

Use Node.js `24.19.0` and npm `11.17.0`, as pinned by `.nvmrc` and
`package.json`.

1. Run `npm ci` then `npm run dev` for a local-only development workspace.
2. To exercise authentication and billing, copy `.env.example` to `.env`, set `VITE_COMMERCIAL_MODE=true`, and add a dedicated Supabase project URL and publishable key.
3. Apply the migrations, configure Stripe and deploy the two Edge Functions as described in [`docs/commercial-setup.md`](docs/commercial-setup.md).

Until commercial mode is deliberately enabled, the app retains trees in the browser so an existing deployment remains usable during rollout. A configured commercial build requires sign-in and stores each account's trees in Supabase. Row Level Security isolates accounts, while a private database trigger atomically enforces the free and paid tree allowances.

## Deployment readiness

The project is Vite-ready for Railway or another Node host. Railway builds with `npm run build` and serves the generated SPA with `npm start`. Production builds always require the Supabase browser variables and stop at a configuration screen rather than falling back to unencrypted browser-local storage. New accounts are invitation-only; keep public signup disabled in the hosted Supabase Auth settings as well as `supabase/config.toml`.

Stripe secrets and the Supabase secret/service key belong only in Supabase Edge Function secrets. They must never use the `VITE_` prefix or be added to Railway's browser build variables.

## Legal and operations

- [`docs/production-governance-decisions.md`](docs/production-governance-decisions.md) is the canonical production-governance brief and distinguishes required controls from controls actually verified as active.
- [`docs/production-readiness-status.md`](docs/production-readiness-status.md) records current evidence, launch blockers and provider-side checks that still require an operator.
- [`SECURITY.md`](SECURITY.md) records the copied File Tracker decisions on clickwrap, monitoring, leaked-password protection and browser session storage.
- [`docs/backup-and-account-deletion.md`](docs/backup-and-account-deletion.md) records backup, restoration and verified deletion procedures.
- [`docs/incident-response.md`](docs/incident-response.md) is the production incident runbook.

The in-app Terms, Privacy Notice and tax disclaimer are product templates and still require final Maltese legal review before a public commercial launch.
