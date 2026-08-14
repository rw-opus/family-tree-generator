# Restore drill evidence template

Keep detailed evidence in the approved private operational store. Commit only
an evidence ID and non-sensitive outcome; never commit database dumps, user
identifiers, credentials, exact client record counts or screenshots containing
client data.

## Authorisation

- Evidence ID:
- Drill date and timezone:
- Authorising owner:
- Operator:
- Independent observer:
- Approved source-backup timestamp:
- Encrypted-artifact SHA-256:
- Public-key fingerprint:
- Temporary DR environment reference:
- Confirmation that the target is not production or ordinary staging:

## Timings

- Incident/restore-point assumption:
- Restore started:
- Database available:
- Application verification completed:
- Target destroyed:
- Measured data age (RPO evidence):
- Measured recovery duration (RTO evidence):

## Results

| Check                                                 | Pass/fail | Private evidence reference | Notes/action |
| ----------------------------------------------------- | --------- | -------------------------- | ------------ |
| Encrypted checksum matches                            |           |                            |              |
| Offline key decrypts the archive                      |           |                            |              |
| Manifest file checksums and sizes match               |           |                            |              |
| Main and migration-history restore transactions pass  |           |                            |              |
| Aggregate counts match without logging client data    |           |                            |              |
| Known DR canary users authenticate                    |           |                            |              |
| Known synthetic canary tree loads                     |           |                            |              |
| Alice cannot list/read/update/delete Bob's tree       |           |                            |              |
| Bob cannot list/read/update/delete Alice's tree       |           |                            |              |
| Anonymous and invalid credentials are denied          |           |                            |              |
| Required tables, constraints, RLS and functions exist |           |                            |              |
| Entitlement data and service-role boundary work       |           |                            |              |
| Edge Functions deploy with test-only secrets          |           |                            |              |
| Stripe remains in test mode with no live webhook      |           |                            |              |
| Hosted Auth/redirect/SMTP settings are reconciled     |           |                            |              |
| Application starts against the restored project       |           |                            |              |
| `/healthz` reports the expected immutable build       |           |                            |              |
| Supabase credentials work after restore               |           |                            |              |
| External side effects remain disabled                 |           |                            |              |
| Temporary DR project and plaintext are destroyed      |           |                            |              |

## Exceptions and follow-up

- Failed or skipped checks:
- Data exposure or operational concerns:
- Corrective actions, owner and due date:
- Re-test date:
- Explicit residual-risk acceptance, if any:

The drill is successful only when all required checks pass and the measured RPO
and RTO meet the owner's approved targets. A database-only restore without Auth,
RLS, entitlements, functions and application verification is not a successful
drill.
