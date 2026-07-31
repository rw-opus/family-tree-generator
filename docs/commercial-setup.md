# Commercial deployment setup

This application uses Supabase for authentication, row-isolated tree storage and lifetime tree allowances. Stripe Checkout sells one additional tree credit for €30 after the first five free generations have been used.

## Commercial rule

The database is authoritative:

- creations 1–5 are allocated from the free lifetime allowance;
- creation 6 and later consumes one paid credit;
- creating from a blank tree and importing a GEDCOM are treated identically;
- updates never consume a new credit;
- deletion never refunds a credit.

The `family_trees_consume_entitlement` trigger enforces this even if someone calls the Data API directly instead of using the application interface.

## 1. Supabase project

Use a dedicated Supabase project for this product. Do not share the File Tracker database or reuse its client tables.

Apply `supabase/migrations/20260731124716_commercial_tree_credits.sql`, or run `supabase/schema.sql` in the SQL Editor for a new project. Then confirm:

- RLS is enabled on every public table;
- authenticated users can select, update and delete only their own `family_trees`;
- `tree_accounts`, `tree_credit_orders` and `tree_generations` expose only each user's own rows;
- `stripe_tree_events` has no anon or authenticated policy;
- the private quota and credit functions are not exposed through the Data API.

In Auth settings, configure the production Site URL and permitted redirect URLs. Email confirmation should remain enabled for public signup.

## 2. Stripe product

Create one Stripe product and one one-time Price:

- amount: **€30.00**;
- currency: **EUR**;
- type: **one-time**.

The application accepts only the server-side Price ID stored in `STRIPE_TREE_PRICE_ID`. The webhook also rejects a completed session unless its total is exactly 3000 cents in EUR.

Create a webhook endpoint pointing to:

`https://<project-ref>.supabase.co/functions/v1/stripe-tree-webhook`

Subscribe it to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

## 3. Edge Function secrets

Configure these only in Supabase Edge Function secrets:

- `STRIPE_SECRET_KEY`
- `STRIPE_TREE_PRICE_ID`
- `STRIPE_TREE_WEBHOOK_SECRET`
- `APP_URL` — the exact Railway production origin, without a path

Supabase supplies its own publishable and secret keys to Edge Functions. Never copy a secret/service-role key into a `VITE_` variable, browser code or GitHub.

Deploy:

```text
npx supabase functions deploy create-tree-checkout
npx supabase functions deploy stripe-tree-webhook
```

The generated `supabase/config.toml` keeps JWT verification enabled for checkout and disabled only for the externally signed Stripe webhook. The webhook verifies Stripe's signature before doing any work.

## 4. Railway variables

Set these before the Vite build:

- `VITE_COMMERCIAL_MODE=true`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Leave `VITE_COMMERCIAL_MODE` unset or `false` during rollout to keep the existing browser-saved application available. Turn it on only after the database migration and both Edge Functions are deployed.

Do not add Stripe secrets or a Supabase secret/service-role key to Railway's client build variables.

## 5. Pre-launch operational work

Before accepting live payments:

- obtain final Maltese legal wording for Terms, Privacy and the tax-calculation disclaimer;
- decide the refund and chargeback policy and add the corresponding support procedure;
- test Stripe's card, delayed-payment, expiry and duplicate-webhook scenarios in test mode;
- configure transactional email branding and delivery;
- establish database backup, incident-response and account-deletion procedures;
- confirm VAT, invoice and receipt requirements with the business's accountant;
- complete a data-protection review because family, property and succession information is personal and potentially sensitive client data.

This code provides the secure commercial foundation, but those business and legal decisions remain required before a public live launch.
