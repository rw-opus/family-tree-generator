# Backup, restore and account deletion

## User workspace backup

The Home page's **Download workspace backup** action exports every tree the
user can currently see into a versioned JSON file. The export includes family,
will, declaration, property, ownership and tax-working data. It is not
encrypted; treat it as confidential client material and store it in an
approved encrypted location.

The current export is an independent recovery copy, not a public bulk-import
route. Operator-assisted restoration must validate the backup format and the
account owner before writing any rows. It must not consume or manufacture tree
credits accidentally.

## Database recovery

Recovery order:

1. Use the Supabase project's provider backup or point-in-time recovery if the
   subscribed plan supplies it.
2. For one account, validate the user's most recent workspace JSON export and
   restore it into a non-production project first.
3. Verify tree counts, several people and relationships, property values,
   ownership totals and tax reports before restoring production data.

Before launch, confirm the actual Supabase backup retention, rehearse a
non-production restore, record who may authorise one and record where restore
credentials are held. Do not add an offsite database dump until encryption,
secret ownership, storage region, retention and deletion are agreed.

## Verified account-deletion procedure

Account deletion is destructive and is performed by the operator after a
verified written request. It is not delegated to browser code.

1. Verify the request through the account's registered email and, where risk
   warrants it, a second agreed identity check. Record the request outside the
   workspace that will be deleted.
2. Explain the scope: active Supabase records will be deleted; immutable
   provider backups expire under the provider's retention schedule; Stripe or
   accounting records may need separate lawful retention.
3. Offer a reasonable period to download the workspace backup and confirm the
   user understands that deletion is irreversible in the active database.
4. Revoke the user's Supabase sessions before deleting the user. Deleting an
   Auth user alone does not immediately invalidate every already-issued access
   token.
5. Delete the user in Supabase Authentication. The schema's foreign keys
   cascade deletion through `family_trees`, `tree_accounts`,
   `tree_credit_orders`, `tree_generations` and `terms_acceptances`.
6. Using an authorised server-side/admin check, confirm that no rows remain in
   those tables for the deleted user. Never expose the secret key to a browser.
7. Review the related Stripe customer and payment records separately. Delete
   what may lawfully be deleted and retain only records required for payment,
   fraud, tax or accounting obligations.
8. Confirm completion to the requester without sending their deleted data or
   internal credentials.

If the request concerns a person recorded inside somebody else's tree, the
tree owner is the controller for that matter. Assist the owner with a targeted
rectification or erasure rather than deleting a different user's account.
