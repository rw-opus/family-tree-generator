# Family Tree Generator — Property Succession Calculator

A commercial Maltese property ownership and succession workspace. It combines a family tree with intestate and testamentary inheritance modelling, causa mortis declarations, fractional ownership transfers, and indicative property-tax calculations.

## Commercial model

- Every registered account receives five lifetime tree generations free of charge.
- Every later new tree or GEDCOM import consumes one paid tree credit costing €30.
- Editing, renaming and reopening an existing tree does not consume another credit.
- Deleting a tree does not restore its free or paid generation credit.
- The database trigger is the authority for the allowance; the browser cannot bypass it.

## Start locally

1. Run `npm install` then `npm run dev` for a local-only development workspace.
2. To exercise authentication and billing, copy `.env.example` to `.env`, set `VITE_COMMERCIAL_MODE=true`, and add a dedicated Supabase project URL and publishable key.
3. Apply the migrations, configure Stripe and deploy the two Edge Functions as described in [`docs/commercial-setup.md`](docs/commercial-setup.md).

Until commercial mode is deliberately enabled, the app retains trees in the browser so an existing deployment remains usable during rollout. A configured commercial build requires sign-in and stores each account's trees in Supabase. Row Level Security isolates accounts, while a private database trigger atomically enforces the free and paid tree allowances.

## Deployment readiness

The project is Vite-ready for Railway or another Node host. Railway builds with `npm run build` and serves the generated SPA with `npm start`. Set `VITE_COMMERCIAL_MODE=true` only after the Supabase migration, Edge Functions and browser variables are ready. Commercial mode deliberately stops at a configuration screen if either Supabase browser variable is absent.

Stripe secrets and the Supabase secret/service key belong only in Supabase Edge Function secrets. They must never use the `VITE_` prefix or be added to Railway's browser build variables.
