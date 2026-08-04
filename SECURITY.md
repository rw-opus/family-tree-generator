# Security and product decisions

This file records the settled decisions copied from the File Tracker and
adapted to the Family Tree Generator. It is deliberately explicit about which
controls are implemented and which still depend on a provider plan or an
external service.

The canonical requirements are recorded in
[`docs/production-governance-decisions.md`](docs/production-governance-decisions.md).
This file records their current implementation status and must not describe a
control as active unless it has been verified.

## Architecture

- The production application is a React browser client backed by a dedicated
  Supabase project. It exposes only a Supabase publishable key; secret and
  service-role keys remain server-side.
- Row Level Security is the authority for tree access. Every `family_trees`
  row is scoped to its `owner_id`; browser checks are only user-interface
  safeguards.
- New registrations are invitation-only. Hosted Supabase signup and the local
  configuration both fail closed.
- Acceptance of the current Terms and tax disclaimer is recorded in
  `terms_acceptances`. The gate fails closed, and users can select or insert
  their own versioned acceptance record but cannot alter or delete it.

## Settled decisions

### Terms, Privacy Notice and tax disclaimer

The app includes public Terms and Privacy pages, an explicit tax-calculation
warning on the Tax Calculation screen, and a versioned clickwrap gate. A
change to the notice must also change `TERMS_VERSION`, requiring acceptance of
the new version. The text is an operational template, not final legal advice;
it must receive Maltese legal and data-protection review before a public
commercial launch.

### Backups and account deletion

Users can download all current trees as one JSON workspace backup. The file is
not encrypted and may contain family, testamentary, property and financial
information, so the user is warned to store it securely. Provider database
backups and this user export are the current recovery paths. There is no
repository-managed offsite database copy until storage ownership, encryption,
retention and restore testing are agreed.

Account deletion is a verified, operator-assisted procedure rather than a
single client-side button. The procedure is documented in
[`docs/backup-and-account-deletion.md`](docs/backup-and-account-deletion.md).

### Error and uptime monitoring

Client error monitoring is optional and inactive unless `VITE_SENTRY_DSN` is
configured. The integration disables default PII and strips messages,
breadcrumbs, user information, request data and browser context before an
event leaves the browser. Session replay and analytics are not enabled.

`/healthz` reports service health and the deployed commit; Railway uses it as
its deployment health check. No independent external uptime monitor is
configured in this repository. Configure one against `/healthz` before launch
and agree who receives alerts and who is on call.

### Leaked-password protection

Supabase leaked-password protection remains disabled while the project is on
a plan that does not include it. This is an explicit plan-dependent deferral,
not a claim that the control is active. On an eligible plan, enable the hosted
Auth setting and verify rejection of a known compromised test password. The
current compensating controls are invitation-only signup, a ten-character
minimum, secure password changes, hosted rate limits and available TOTP MFA.

Supabase documents that leaked-password checks use the Pwned Passwords service
and are available on Pro and above:
<https://supabase.com/docs/guides/auth/password-security>.

### Browser Supabase sessions and HttpOnly cookies

The application remains a browser SPA using Supabase's supported browser
session persistence. It is **not** being moved to a custom HttpOnly cookie
scheme. Supabase's browser client needs access to the refresh token to maintain
the session, and Supabase states that making these cookies HttpOnly is not
necessary. A cookie/SSR migration would be an application-architecture change,
not a hardening toggle; revisit it only if authenticated rendering and data
access move behind a first-party server layer.

If that architecture changes, use the current `@supabase/ssr` PKCE guidance,
validate claims server-side, prevent authenticated responses and `Set-Cookie`
headers from being cached, and threat-model CSRF as well as XSS:
<https://supabase.com/docs/guides/auth/server-side/advanced-guide>.

## Operational references

- [Production governance decisions](docs/production-governance-decisions.md)
- [Backup and account deletion](docs/backup-and-account-deletion.md)
- [Incident response](docs/incident-response.md)
- [Commercial deployment](docs/commercial-setup.md)
