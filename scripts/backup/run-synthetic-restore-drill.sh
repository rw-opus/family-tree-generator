#!/usr/bin/env bash
set -euo pipefail

# This is a destructive integration test for disposable local Supabase stacks.
# It cannot run on a workstation or against a hosted URL.
readonly confirmation="${FTG_SYNTHETIC_RESTORE_CONFIRMATION:-}"
readonly required_confirmation="DESTROY_ONLY_A_DISPOSABLE_LOCAL_SYNTHETIC_TARGET"
if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" || -z "${RUNNER_TEMP:-}" ]]; then
  echo "The synthetic restore drill runs only on a GitHub-hosted CI runner." >&2
  exit 1
fi
if [[ "$confirmation" != "$required_confirmation" ]]; then
  echo "The synthetic restore confirmation token is missing or incorrect." >&2
  exit 1
fi

umask 077
readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly work_root="$(mktemp -d "${RUNNER_TEMP%/}/ftg-synthetic-restore-XXXXXX")"
readonly source_workdir="$work_root/source-project"
readonly target_workdir="$work_root/restore-project"
readonly dump_directory="$work_root/plaintext-dump"
readonly recovered_directory="$work_root/recovered-dump"
readonly state_path="$work_root/synthetic-state.json"
readonly counts_path="$work_root/counts.json"
readonly archive_path="$work_root/plaintext-backup.tar.gz"
readonly encrypted_path="$work_root/synthetic-backup.ftgbackup"
readonly checksum_path="$work_root/synthetic-backup.ftgbackup.sha256.json"
readonly recovered_archive_path="$work_root/recovered-backup.tar.gz"
readonly public_key_path="$work_root/ephemeral-public.pem"
readonly private_key_path="$work_root/ephemeral-private.pem"
readonly source_project_id="ftg-synthetic-backup-source"
readonly target_project_id="ftg-synthetic-restore-target"
app_pid=""

cleanup() {
  set +e
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" >/dev/null 2>&1
    wait "$app_pid" >/dev/null 2>&1
  fi
  supabase --workdir "$source_workdir" stop --no-backup >/dev/null 2>&1
  supabase --workdir "$target_workdir" stop --no-backup >/dev/null 2>&1
  rm -rf -- "$work_root"
}
trap cleanup EXIT INT TERM

prepare_workdir() {
  local destination="$1"
  local project_id="$2"
  local include_migrations="$3"
  mkdir -p "$destination/supabase"
  {
    printf 'project_id = "%s"\n\n' "$project_id"
    cat "$repository_root/supabase/config.toml"
  } > "$destination/supabase/config.toml"
  sed -i \
    -e 's|^site_url = .*|site_url = "http://127.0.0.1:4199"|' \
    -e 's|^additional_redirect_urls = .*|additional_redirect_urls = ["http://127.0.0.1:4199/**"]|' \
    "$destination/supabase/config.toml"
  # The CLI validates every function referenced by config.toml while starting
  # a stack, even though this drill does not invoke those functions directly.
  # Copy the complete source-controlled function tree, including deno.json and
  # lockfiles; generated supabase/.temp state is deliberately never copied.
  cp -R "$repository_root/supabase/functions" "$destination/supabase/functions"
  cp -R "$repository_root/supabase/tests" "$destination/supabase/tests"
  if [[ "$include_migrations" == "yes" ]]; then
    cp -R "$repository_root/supabase/migrations" "$destination/supabase/migrations"
  fi
}

load_stack_environment() {
  local workdir="$1"
  local status_json api anon service db_url
  status_json="$(supabase --workdir "$workdir" status -o json)"
  api="$(jq -r '.API_URL // empty' <<<"$status_json")"
  anon="$(jq -r '.ANON_KEY // empty' <<<"$status_json")"
  service="$(jq -r '.SERVICE_ROLE_KEY // empty' <<<"$status_json")"
  db_url="$(jq -r '.DB_URL // empty' <<<"$status_json")"
  for value in "$anon" "$service" "$db_url"; do
    [[ -n "$value" ]] && echo "::add-mask::$value"
  done
  if [[ -z "$api" || -z "$anon" || -z "$service" || -z "$db_url" ]]; then
    echo "Could not read the disposable local Supabase credentials." >&2
    exit 1
  fi
  export SUPABASE_URL="$api"
  export SUPABASE_ANON_KEY="$anon"
  export SUPABASE_SERVICE_ROLE_KEY="$service"
  export SUPABASE_DB_URL="$db_url"
}

prepare_workdir "$source_workdir" "$source_project_id" yes
prepare_workdir "$target_workdir" "$target_project_id" no
mkdir -p "$dump_directory" "$recovered_directory"

supabase --workdir "$source_workdir" start
load_stack_environment "$source_workdir"
readonly source_api_url="$SUPABASE_URL"
readonly source_db_url="$SUPABASE_DB_URL"

node "$repository_root/scripts/backup/synthetic-fixture.js" seed "$state_path"
jq '.counts' "$state_path" > "$counts_path"

# These are the current official Supabase CLI logical-backup components:
# roles, schema, data and a separately preserved migration history.
supabase db dump --db-url "$source_db_url" --file "$dump_directory/roles.sql" --role-only
supabase db dump --db-url "$source_db_url" --file "$dump_directory/schema.sql"
supabase db dump \
  --db-url "$source_db_url" \
  --file "$dump_directory/data.sql" \
  --use-copy \
  --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes"
supabase db dump \
  --db-url "$source_db_url" \
  --file "$dump_directory/migration-history-schema.sql" \
  --schema supabase_migrations
supabase db dump \
  --db-url "$source_db_url" \
  --file "$dump_directory/migration-history-data.sql" \
  --use-copy \
  --data-only \
  --schema supabase_migrations

database_version="$(psql "$source_db_url" --tuples-only --no-align --command 'show server_version')"
supabase_cli_version="$(supabase --version)"
created_at="$(node -p 'new Date().toISOString()')"
node "$repository_root/scripts/backup/evidence-cli.js" create-manifest \
  --dump-directory "$dump_directory" \
  --counts "$counts_path" \
  --output "$dump_directory/manifest.json" \
  --source-kind synthetic-local \
  --created-at "$created_at" \
  --supabase-cli-version "$supabase_cli_version" \
  --database-version "$database_version" \
  --source-commit "${GITHUB_SHA:-unknown}"
node "$repository_root/scripts/backup/evidence-cli.js" verify-manifest \
  --dump-directory "$dump_directory" \
  --manifest "$dump_directory/manifest.json"

tar -czf "$archive_path" -C "$dump_directory" \
  roles.sql schema.sql data.sql \
  migration-history-schema.sql migration-history-data.sql manifest.json
node "$repository_root/scripts/backup/evidence-cli.js" generate-ephemeral-key \
  --public-key "$public_key_path" \
  --private-key "$private_key_path"
node "$repository_root/scripts/backup/evidence-cli.js" encrypt \
  --input "$archive_path" \
  --output "$encrypted_path" \
  --public-key "$public_key_path"
node "$repository_root/scripts/backup/evidence-cli.js" write-checksum \
  --input "$encrypted_path" \
  --output "$checksum_path"

# Prove recovery uses only the encrypted artifact, not the original plaintext.
rm -rf -- "$dump_directory" "$archive_path"
node "$repository_root/scripts/backup/evidence-cli.js" verify-checksum \
  --input "$encrypted_path" \
  --checksum "$checksum_path"
node "$repository_root/scripts/backup/evidence-cli.js" decrypt \
  --input "$encrypted_path" \
  --output "$recovered_archive_path" \
  --private-key "$private_key_path"
tar -xzf "$recovered_archive_path" -C "$recovered_directory"
node "$repository_root/scripts/backup/evidence-cli.js" verify-manifest \
  --dump-directory "$recovered_directory" \
  --manifest "$recovered_directory/manifest.json"

supabase --workdir "$source_workdir" stop --no-backup
supabase --workdir "$target_workdir" start
load_stack_environment "$target_workdir"

node "$repository_root/scripts/backup/evidence-cli.js" assert-synthetic-target \
  --source-kind synthetic-local \
  --source-project-id "$source_project_id" \
  --target-project-id "$target_project_id" \
  --source-url "$source_api_url" \
  --target-url "$SUPABASE_URL" \
  --source-db-url "$source_db_url" \
  --target-db-url "$SUPABASE_DB_URL" \
  --confirmation "$confirmation" \
  --target-workdir "$target_workdir"

# Restore the application database and its separately preserved migration
# history using the two current Supabase-documented transactions.
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$recovered_directory/roles.sql" \
  --file "$recovered_directory/schema.sql" \
  --command 'set session_replication_role = replica' \
  --file "$recovered_directory/data.sql" \
  --dbname "$SUPABASE_DB_URL"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$recovered_directory/migration-history-schema.sql" \
  --file "$recovered_directory/migration-history-data.sql" \
  --dbname "$SUPABASE_DB_URL"
psql "$SUPABASE_DB_URL" --variable ON_ERROR_STOP=1 --command "notify pgrst, 'reload schema'"

# The restored schema must retain the catalog and grant invariants as well as
# the application-visible behavior checked below.
supabase --workdir "$target_workdir" test db

npm --prefix "$repository_root" run build
readonly app_port=4199
PORT="$app_port" \
VITE_SUPABASE_URL="$SUPABASE_URL" \
VITE_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_ANON_KEY" \
RAILWAY_GIT_COMMIT_SHA="${GITHUB_SHA:-synthetic-restore}" \
  node "$repository_root/server.mjs" >"$work_root/app.log" 2>&1 &
app_pid="$!"
for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:$app_port/healthz" >/dev/null; then
    break
  fi
  sleep 1
done

node "$repository_root/scripts/backup/synthetic-fixture.js" verify \
  "$state_path" \
  "$recovered_directory/manifest.json" \
  "$recovered_directory" \
  "http://127.0.0.1:$app_port"

echo "Synthetic backup and restore evidence passed; no hosted project, Railway deployment or Stripe endpoint was targeted."
