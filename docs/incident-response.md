# Incident response

Use this page when the service, data or credentials may be at risk. Preserve
evidence and avoid speculative database edits during an outage.

## Site is down

1. Check `https://family-tree-generator-production.up.railway.app/healthz`.
   A healthy response identifies the deployed commit; if it responds, inspect
   Supabase status and browser errors next.
2. If it does not respond, inspect the Railway deployment and service logs.
   Railway is configured to restart failed services using `/healthz`.
3. If a deployment caused the outage, redeploy the last known-good Railway
   deployment or revert the faulty Git commit and push the revert to `main`.
4. Verify the recovered `/healthz` commit and run a signed-in read/write smoke
   test without using real client data.

## Database corruption or deletion

1. Stop destructive writes if possible and preserve logs.
2. Prefer a Supabase provider restore or point-in-time recovery when the plan
   supports it.
3. Restore into a non-production project first, then spot-check tree counts,
   relationships, values, ownership and the migration history.
4. For an isolated account, use a validated user workspace export only under
   the procedure in [backup-and-account-deletion.md](backup-and-account-deletion.md).

There is currently no repository-managed offsite database-backup workflow.

## Supabase outage

Do not rewrite data or weaken authentication during a provider outage. The app
must surface load/save failures and refuse new sign-ins until Supabase
recovers. Monitor <https://status.supabase.com/> and verify a saved change
after recovery.

## Failed Stripe webhook

Inspect the Stripe event and the Supabase Edge Function logs. Stripe retries
failed webhook deliveries; the event ledger makes successful duplicates
no-ops. Resend only the failed event after correcting the cause, then confirm
that exactly one credit was granted and that the order status matches Stripe.

## Leaked secret or compromised account

- Revoke affected user sessions before deleting or disabling an account.
- Rotate a Supabase secret/service key in Supabase, update Edge Function and
  deployment secrets, then redeploy. A publishable key is public by design but
  may still be rotated after abuse or configuration exposure.
- Rotate Stripe API and webhook secrets in Stripe, update Supabase Edge
  Function secrets and redeploy the functions.
- Never place a replacement secret in a `VITE_` variable, browser code, Git
  history, an issue or an error-monitoring event.
- Review Supabase Auth logs, database logs, Stripe events and Sentry events for
  the affected period.

## Suspected personal-data incident

Contain access, preserve evidence, identify the affected accounts and data,
and obtain data-protection advice promptly. Assess the operator's and each
User/controller's notification duties under the GDPR and Maltese law; do not
delay that assessment while waiting for a perfect technical root-cause report.
Use only verified facts in communications and do not put additional personal
data into tickets or monitoring systems.
