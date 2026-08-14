# Backup and restore operations

## Current control boundary

The repository contains a **synthetic-only** backup and restore proof. It does
not create, schedule, download or upload a production backup. It uses no hosted
project, external storage provider or real account data.

The Security workflow creates fictional Alice and Bob accounts in a disposable
local Supabase stack. It then uses the current official logical-backup pattern:

1. `supabase db dump --role-only` for roles;
2. `supabase db dump` for schema;
3. `supabase db dump --use-copy --data-only` for data;
4. separate schema and data dumps for `supabase_migrations`;
5. `psql --single-transaction --variable ON_ERROR_STOP=1` for the main restore
   and the separately documented migration-history restore.

The plaintext files receive a manifest containing byte lengths, SHA-256
checksums, tool/database versions and aggregate record counts. The archive is
then protected with an ephemeral RSA-OAEP-wrapped AES-256-GCM key and receives
a detached checksum. CI deletes the original plaintext, verifies the encrypted
artifact, decrypts it and restores it into a fresh local stack.

The ephemeral private key exists only to prove the fictional CI round trip. A
future production backup job must have only a public encryption key. Its private
key must remain outside CI, GitHub, Railway and Supabase.

## Safety properties

`scripts/backup/run-synthetic-restore-drill.sh` runs only when all of these are
true:

- GitHub Actions and CI identify themselves;
- a deliberate synthetic-destruction token is present;
- both API URLs use plain HTTP on localhost and both database URLs use a local
  PostgreSQL connection to the disposable `postgres` database;
- source and target have different IDs containing `synthetic`;
- the restore work directory is below the GitHub runner or OS temp directory
  and outside the repository worktree.

The workflow has read-only repository permission, no GitHub Environment, no
provider secrets, no schedule and no production URL. A target guard runs before
the first destructive target SQL statement.

## Evidence produced by CI

The harness proves, using fictional data, that:

- every required dump component is non-empty and checksummed;
- encrypted-file corruption and use of the wrong private key fail closed;
- a fresh database accepts the main logical restore transaction and the
  separate migration-history transaction;
- two known restored users can authenticate with their restored passwords;
- each user can load their restored tree and cannot read the other's exact UUID;
- tree-account, generation-entitlement and terms records survive;
- the restored `save_family_tree` and Stripe-event RPCs execute with their
  intended roles;
- pgTAP catalog, RLS and grant assertions still pass;
- the built application reports a healthy commit and receives only the local
  publishable runtime configuration, never the service-role key.

It cannot prove any of the following:

- that a production backup exists, is recent or meets an RPO;
- provider daily-backup or PITR availability;
- real offsite upload, object versioning, immutability or retention;
- custody or recoverability of an offline production private key;
- restoration time for production volume;
- hosted Auth, SMTP, redirect, API-key, Edge Function, Stripe, Railway, DNS or
  monitoring reconfiguration;
- a signed-in browser workflow against a hosted restored environment;
- deletion of the isolated restore environment after a real drill.

A green job is therefore implementation evidence, not completion of G1-G9.

## Decisions required before production automation

The owner must approve and record these decisions before any scheduled job or
provider credential is added:

| Decision                        | Recommended launch target                                              | Approved value |
| ------------------------------- | ---------------------------------------------------------------------- | -------------- |
| Recovery point objective        | No more than 1 hour                                                    | Pending        |
| Recovery time objective         | No more than 4 hours                                                   | Pending        |
| Supabase plan                   | Pro minimum, or dated risk acceptance                                  | Pending        |
| PITR                            | Decide from the approved RPO and budget                                | Pending        |
| Offsite provider and EU region  | Separate encrypted object store                                        | Pending        |
| Immutability and retention      | Versioning/object lock plus legally reviewed retention                 | Pending        |
| Encryption recipient            | Public key in automation; private key held offline by named custodians | Pending        |
| Backup database connection      | Test the supported Session pooler/direct route in non-production       | Pending        |
| Alert destination and responder | Named primary and escalation contact                                   | Pending        |
| Restore environment             | Temporary isolated DR project, never ordinary staging                  | Pending        |

The production project was verified on 14 August 2026 as a Free project.
Supabase currently provides no automatic backups or PITR on Free and recommends
regular offsite CLI dumps. Pro currently includes seven days of daily backups;
PITR is a separate paid add-on and requires at least Small compute. Verify the
dashboard and current pricing again at approval time.

## Recovery inventory

Source control is authoritative for:

- `supabase/migrations/` and the generated schema review snapshot;
- Edge Function sources, import maps and lockfiles;
- application/server source and dependency locks;
- local Supabase defaults and Railway health configuration.

The private operational evidence store must separately record, without putting
secret values in Git:

- hosted Supabase Auth settings, redirect URLs, SMTP, rate limits and MFA;
- current API-key identities and rotation procedure;
- Edge Function deployment versions and secret names/custodians;
- Stripe mode, product, price, webhook endpoint and signing-secret custody;
- Railway environment variables, release ID and rollback procedure;
- DNS/domain settings;
- monitoring and alert routing;
- offsite bucket region, versioning/object-lock policy, credentials and
  retention;
- the current migration head and expected public tables/functions;
- whether any Storage objects, Vault secrets, cron jobs or external extensions
  exist.

Database backups do not restore Storage objects. The current application has no
source-controlled Storage bucket, but every real backup must fail or invoke a
separate object-backup path if the provider inventory reports any objects.

## Real quarterly drill boundary

A real drill is a controlled exception to the rule against copying production
data into test systems. Restore only into a temporary access-restricted DR
project in the same approved region. Do not use ordinary staging. Do not deploy
live Stripe secrets or enable external side effects. Record the evidence using
[`restore-drill-template.md`](restore-drill-template.md), then destroy the DR
project under a second-person check.

Latest official references reviewed on 14 August 2026:

- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Managing environments](https://supabase.com/docs/guides/deployment/managing-environments)
