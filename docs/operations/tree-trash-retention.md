# Family-tree Trash and retention

Deleting a family from the Home page is recoverable. The family moves to
**Trash** and cannot be opened, edited or returned by the ordinary family-list
query while it remains there.

## User actions

- **Move to Trash** records the deletion time without refunding or consuming a
  tree credit.
- **Restore** returns the same family, data and generation history to the
  active list. Restore is available for 30 days from the recorded deletion
  time.
- **Delete permanently** is a separate destructive action inside Trash. It
  requires a second confirmation and cannot be undone through the application.

Cloud transitions are owner-checked and revision-checked database operations.
A stale browser receives a conflict instead of overwriting a newer save, and a
missing tree produces the same response as a tree belonging to another account.
Browser roles cannot directly update or delete a `family_trees` row.

Local-only workspaces store active and trashed families in the versioned browser
workspace. An older application treats the newer workspace envelope as
unsupported and preserves it for recovery instead of dropping the Trash list.
Expired local Trash entries are removed when the workspace is next loaded and
saved.

## Thirty-day boundary

The database clock is authoritative for cloud data. Restore is refused once
`deleted_at + 30 days` has been reached. The UI may explain the date, but it
must not be treated as the security or retention boundary.

The application exposes explicit permanent deletion for every trashed cloud
family, including an entry whose restore window has expired. Automatic cloud
purging is not scheduled by the application migration in this tranche. Before
claiming automatic retention enforcement, configure and monitor a daily
Supabase Cron job that invokes a reviewed, bounded server-side purge operation,
then record staging and production evidence. Never rely on a browser timer for
cloud deletion.

Account deletion remains a separate verified operator procedure. Deleting the
Supabase Auth user cascades through active and trashed family rows according to
the existing foreign keys.
