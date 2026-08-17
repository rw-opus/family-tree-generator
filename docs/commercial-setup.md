# Commercial deployment setup

This application uses Supabase for authentication, row-isolated tree storage and lifetime tree allowances. Stripe Checkout sells one additional tree credit for €30 after the first three free generations have been used.

## Commercial rule

The database is authoritative:

- creations 1–3 are allocated from the free lifetime allowance;
- creation 4 and later consumes one paid credit;
- an operator may grant a specific account unlimited tree creation without consuming free or paid credits;
- creating from a blank tree and importing a GEDCOM are treated identically;
- updates never consume a new credit;
- deletion never refunds a credit.

The `family_trees_consume_entitlement` trigger enforces this even if someone calls the Data API directly instead of using the application interface.

Unlimited access is an operator-managed value in `tree_accounts.unlimited_trees`. Users have read-only access to their own allowance row and cannot grant this entitlement to themselves. Set it through an authenticated administrative database operation using the account's immutable Auth user ID; do not implement email-based privilege checks in browser code.

## 1. Supabase project

Use a dedicated Supabase project for this product. Do not share the File Tracker database or reuse its client tables.

Treat `supabase/migrations/` as the authoritative database history. Apply every
pending migration, in timestamp order, to an isolated staging project first and
then apply the same reviewed migrations to production. For example, from a
project linked to the intended Supabase environment:

```text
npx supabase db push
```

Do not initialise or upgrade an environment by running one selected migration
or by pasting `supabase/schema.sql` into the SQL Editor. That file is a generated
review snapshot only and may not describe the migration state of an existing
project. After applying migrations, confirm:

- RLS is enabled on every public table;
- authenticated users can select, insert and delete only their own `family_trees`;
- direct table updates are denied and `save_family_tree` accepts only the
  caller's matching expected revision;
- `tree_accounts`, `tree_credit_orders` and `tree_generations` expose only each user's own rows;
- `stripe_tree_events` has no anon or authenticated policy;
- the private quota and credit functions are not exposed through the Data API.

In Auth settings, configure the production Site URL and permitted redirect URLs. Keep direct public signup disabled; accounts are invitation-only. Keep the email provider and confirmation flow enabled for invited accounts.

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

Deploy to the isolated staging project first. Exercise checkout, signed webhook
delivery, duplicate delivery, delayed payment, expiry and a later successful
payment before deploying the exact reviewed function sources to production.

The generated `supabase/config.toml` keeps JWT verification enabled for checkout and disabled only for the externally signed Stripe webhook. The webhook verifies Stripe's signature before doing any work.

## 4. Railway variables

Set these before the Vite build:

- `VITE_COMMERCIAL_MODE=true`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SENTRY_DSN` (optional; omit until the monitoring project is approved)

Leave `VITE_COMMERCIAL_MODE` unset or `false` during rollout to keep the existing browser-saved application available. Turn it on only after the database migration and both Edge Functions are deployed.

Do not add Stripe secrets or a Supabase secret/service-role key to Railway's client build variables.

## 5. Pre-launch operational work

Before accepting live payments:

- verify that the production webhook is configured and a signed Stripe test
  event reaches the deployed function successfully;
- verify that the configured Edge Function CORS allow-list contains only the
  production origin, approved staging origin and deliberate local-development
  origins;
- obtain final Maltese legal approval of the in-app Terms, Privacy Notice and tax-calculation disclaimer template;
- decide the refund and chargeback policy and add the corresponding support procedure;
- test Stripe's card, delayed-payment, expiry and duplicate-webhook scenarios in test mode;
- configure transactional email branding and delivery;
- confirm the provider backup tier and rehearse the procedures in `backup-and-account-deletion.md` and `incident-response.md`;
- configure a privacy-reduced Sentry project and an independent uptime monitor, or explicitly accept their deferral;
- enable Supabase leaked-password protection when the project is moved to an eligible plan;
- confirm VAT, invoice and receipt requirements with the business's accountant;
- complete a data-protection review because family, property and succession information is personal and potentially sensitive client data.

The browser Supabase session architecture is retained deliberately. Any future move to a server-cookie architecture requires a separate application redesign and security review; it is not part of the current rollout.
