# Production Governance Decisions

Apply these decisions to the Family Tree Generator, adapting legal wording and
data descriptions to its Maltese family-tree, succession, property-ownership
and indicative tax-calculation purpose. Do not claim that infrastructure
controls are active unless they have been verified.

## 1. Terms, Privacy and Disclaimer

- Provide public Terms and Privacy Notice pages accessible before sign-in.
- Add a versioned clickwrap gate that fails closed.
- Record acceptance against the authenticated user, notice version and
  timestamp.
- Acceptance records must be append-only: users may read and insert their own
  records but not edit or delete them.
- Include a prominent project-specific disclaimer wherever calculations,
  succession conclusions, ownership estimates, tax estimates or other
  professional outputs appear.
- Changing material wording must change the Terms version and require fresh
  acceptance.
- Treat all wording as a working template requiring appropriate legal and
  data-protection review before commercial launch.

## 2. Backups and Account Deletion

- Allow users to download a versioned workspace backup.
- Warn that exported files may contain confidential personal or financial data
  and are not automatically encrypted.
- Do not describe user exports as a substitute for database disaster recovery.
- Provider backups depend on the actual Supabase plan and must be verified.
- Do not claim that an offsite backup exists unless it is configured,
  encrypted, monitored and restore-tested.
- Account deletion must be a verified, operator-assisted procedure.
- Revoke active sessions before deleting the Auth user.
- Explain that active database records can be deleted immediately, but provider
  backups expire according to provider retention schedules.
- Retain payment, fraud, tax or accounting records only where legally required.
- Rehearse restoration in a non-production environment.

## 3. Incident Response

Document procedures for:

- Application outage
- Failed deployment and rollback
- Database corruption or accidental deletion
- Supabase outage
- Failed Stripe webhook
- Leaked credentials
- Compromised user account
- Suspected personal-data incident

The `/healthz` endpoint should identify the deployed commit. Preserve evidence
during incidents and do not weaken authentication to bypass an outage.

## 4. Error and Uptime Monitoring

- Error monitoring is optional and inactive unless a DSN is configured.
- Remove personal data, user details, request information, breadcrumbs,
  messages and sensitive page context before sending monitoring events.
- Do not enable session replay by default.
- Provide a user-friendly application error boundary.
- Provide `/healthz` for deployment and uptime checks.
- Independent external uptime monitoring remains outstanding until configured.
- Agree who receives alerts and who responds to them.

## 5. Password Protection

- Keep registration invitation-only unless public signup is deliberately
  approved.
- Require a sensible minimum password length, currently at least 10 characters.
- Support secure password recovery.
- Make TOTP MFA available where appropriate.
- Supabase leaked-password protection requires an eligible plan, currently Pro
  or higher.
- Do not state that leaked-password protection is enabled until verified in the
  Supabase Dashboard.
- Configure Auth rate limits, custom SMTP and CAPTCHA where appropriate.

## 6. Browser Sessions and HttpOnly Cookies

The current application remains a browser SPA using Supabase's supported
browser-session persistence.

Do not create a custom HttpOnly-cookie arrangement merely as a "hardening
toggle". Supabase's browser client needs access to the refresh token to
maintain the browser session.

Reconsider the architecture only if authenticated rendering and data access
move behind a first-party server. A future server/SSR implementation should:

- Use `@supabase/ssr` and PKCE
- Validate authentication server-side
- Prevent caching of authenticated responses and `Set-Cookie` headers
- Initialise Supabase clients per request
- Threat-model CSRF as well as XSS
- Test logout, refresh-token rotation and concurrent sessions

## 7. Row Level Security

- Enable RLS on every table in an exposed schema.
- Policies must enforce the actual user or organisation ownership model.
- `TO authenticated` alone is not authorisation.
- Grant only the operations each role needs.
- UPDATE policies require suitable SELECT access and should use both `USING`
  and `WITH CHECK`.
- Never expose a service-role or secret key in browser code.
- Review every `SECURITY DEFINER` function and revoke default PUBLIC execution.
- Apply migrations to staging first where possible.
- Run Supabase Security and Performance Advisors after deployment.
- Verify RLS using two separate accounts and confirm that neither can access the
  other's records.

## 8. Remaining Production Checklist

Do not mark these complete without checking the actual Supabase project:

- Security and Performance Advisors
- SSL enforcement
- Database network restrictions
- MFA for Supabase/GitHub owners
- A second organisation owner for recovery
- Custom SMTP
- Auth rate limits and OTP expiry
- CAPTCHA where appropriate
- Actual backup retention and PITR availability
- Restore rehearsal
- Independent uptime monitoring
- Load testing
- Production migration verification

## Official Supabase Guidance

- [Server-side authentication](https://supabase.com/docs/guides/auth/server-side)
- [Advanced sessions and cookies](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Password security](https://supabase.com/docs/guides/auth/password-security)
- [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
