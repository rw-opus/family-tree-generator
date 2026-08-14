-- GENERATED SNAPSHOT — DO NOT EDIT MANUALLY.
-- supabase/migrations/ is the authoritative database history.
-- Family Tree Generator commercial schema.
-- Run this only in the Family Tree Generator's own Supabase project.
-- Commercial rule: the first five lifetime tree generations are free;
-- every later creation or GEDCOM import consumes one paid EUR 30 credit,
-- unless an operator has granted the account unlimited tree creation.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.family_trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default 'Untitled family tree' check (char_length(title) <= 200),
  people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
  tree_data jsonb not null default '{}'::jsonb check (jsonb_typeof(tree_data) = 'object'),
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.family_trees
  add column if not exists tree_data jsonb not null default '{}'::jsonb;

alter table public.family_trees
  add column if not exists revision bigint not null default 1;

alter table public.family_trees
  add column if not exists deleted_at timestamptz;

comment on column public.family_trees.deleted_at
is 'Soft-deletion timestamp; null rows are active and non-null rows are in Trash.';

alter table public.family_trees
  drop constraint if exists family_trees_revision_positive;

alter table public.family_trees
  add constraint family_trees_revision_positive check (revision > 0);

create index if not exists family_trees_owner_active_updated_idx
  on public.family_trees (owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists family_trees_owner_trash_deleted_idx
  on public.family_trees (owner_id, deleted_at desc)
  where deleted_at is not null;

create table if not exists public.tree_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  free_tree_limit smallint not null default 5 check (free_tree_limit between 0 and 100),
  free_trees_used smallint not null default 0 check (free_trees_used >= 0),
  paid_tree_credits integer not null default 0 check (paid_tree_credits >= 0),
  unlimited_trees boolean not null default false,
  total_trees_created integer not null default 0 check (total_trees_created >= 0),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (free_trees_used <= free_tree_limit)
);

alter table public.tree_accounts
  add column if not exists unlimited_trees boolean not null default false;

create table if not exists public.tree_credit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quantity integer not null default 1 check (quantity = 1),
  unit_amount_cents integer not null default 3000 check (unit_amount_cents = 3000),
  currency text not null default 'eur' check (currency = 'eur'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'refunded', 'disputed')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

create index if not exists tree_credit_orders_user_created_idx
  on public.tree_credit_orders (user_id, created_at desc);

create table if not exists public.tree_generations (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid unique references public.family_trees(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entitlement_source text not null
    check (entitlement_source in ('free', 'paid', 'legacy', 'admin')),
  order_id uuid references public.tree_credit_orders(id) on delete set null,
  tree_title text not null default 'Untitled family tree',
  created_at timestamptz not null default now()
);

create index if not exists tree_generations_owner_created_idx
  on public.tree_generations (owner_id, created_at desc);

create index if not exists tree_generations_order_idx
  on public.tree_generations (order_id)
  where order_id is not null;

-- No anon or authenticated policy is created for this idempotency ledger.
-- Only the Stripe webhook's secret-key client may read or write it.
create table if not exists public.stripe_tree_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists family_trees_set_updated_at on public.family_trees;
drop function if exists public.set_family_tree_updated_at();
create trigger family_trees_set_updated_at
before update on public.family_trees
for each row execute function private.set_updated_at();

create or replace function private.increment_family_tree_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke all on function private.increment_family_tree_revision() from public, anon, authenticated;

drop trigger if exists family_trees_increment_revision on public.family_trees;
create trigger family_trees_increment_revision
before update on public.family_trees
for each row execute function private.increment_family_tree_revision();

-- Persisted tree payloads are an API boundary. The browser is not trusted to
-- supply well-formed JSON merely because the application normally does so.
--
-- Version 1 is a marker for rows saved before this contract existed. It is a
-- read-only compatibility state: every insert or update must satisfy the
-- strict version-2 contract and is persisted as version 2. Missing markers are
-- accepted only when the same strict validator succeeds, which keeps an
-- already-open copy of the previously deployed SPA able to save safely.

-- This is storage-envelope metadata, not a user edit. Suppress the two known
-- BEFORE UPDATE bookkeeping triggers so deployment does not reorder every
-- family or invalidate every open editor solely because the marker was added.
alter table public.family_trees disable trigger family_trees_set_updated_at;
alter table public.family_trees disable trigger family_trees_increment_revision;

update public.family_trees
set tree_data = pg_catalog.jsonb_set(
  tree_data,
  '{tree_schema_version}',
  '1'::jsonb,
  true
)
where not (tree_data ? 'tree_schema_version');

alter table public.family_trees enable trigger family_trees_increment_revision;
alter table public.family_trees enable trigger family_trees_set_updated_at;

create or replace function private.validate_family_tree_payload()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_tree_bytes constant integer := 8388608;
  max_people constant integer := 2000;
  max_family_groups constant integer := 500;
  max_outside_parties constant integer := 2000;
  max_properties constant integer := 100;
  max_json_nodes constant integer := 100000;
  max_json_depth constant integer := 20;
  max_array_items constant integer := 20000;
  max_object_keys constant integer := 2000;
  max_string_bytes constant integer := 50000;
  max_key_bytes constant integer := 200;
  max_id_bytes constant integer := 200;
  max_ancestry_pairs constant integer := 100000;
  requested_marker text;
  person_ids text[];
  outside_party_ids text[];
  property_ids text[];
  family_group_ids text[];
  party_ids text[];
  node_count integer;
  deepest_node integer;
  array_too_wide boolean;
  object_too_wide boolean;
  string_too_long boolean;
  number_out_of_range boolean;
  key_too_long boolean;
  unsafe_key boolean;
  invalid_record boolean;
  relationship_reference_count bigint;
  owner_count bigint;
  transfer_count bigint;
  declaration_count bigint;
  sale_lot_count bigint;
  ancestry_pair_count integer;
  ancestry_cycle boolean;
begin
  if new.tree_data is null or pg_catalog.jsonb_typeof(new.tree_data) <> 'object' then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_DATA_OBJECT_REQUIRED';
  end if;

  -- Reject an oversized document before inspecting even its version marker.
  -- The second check below accounts for the canonical marker added on write.
  if pg_catalog.octet_length(new.tree_data::text) > max_tree_bytes then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_DATA_BYTES_EXCEEDED';
  end if;

  if new.tree_data ? 'tree_schema_version' then
    if pg_catalog.jsonb_typeof(new.tree_data -> 'tree_schema_version') <> 'number' then
      raise sqlstate 'PT422' using
        message = 'TREE_PAYLOAD_INVALID',
        detail = 'TREE_SCHEMA_VERSION_INVALID';
    end if;
    requested_marker := new.tree_data ->> 'tree_schema_version';
  else
    requested_marker := '';
  end if;

  if requested_marker = '1'
    or requested_marker = '2'
    or requested_marker = '' then
    null;
  elsif requested_marker ~ '^[0-9]+$' then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_SCHEMA_VERSION_UNSUPPORTED';
  else
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_SCHEMA_VERSION_INVALID';
  end if;

  -- Missing and legacy markers reach storage only after passing the exact same
  -- strict contract as an explicit current-version payload.
  new.tree_data := pg_catalog.jsonb_set(
    new.tree_data,
    '{tree_schema_version}',
    '2'::jsonb,
    true
  );

  if pg_catalog.octet_length(new.tree_data::text) > max_tree_bytes then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_DATA_BYTES_EXCEEDED';
  end if;

  if new.people is null or pg_catalog.jsonb_typeof(new.people) <> 'array' then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PEOPLE_ARRAY_REQUIRED';
  end if;
  if pg_catalog.octet_length(new.people::text) > max_tree_bytes then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_PEOPLE_BYTES_EXCEEDED';
  end if;

  if not (new.tree_data ? 'schemaVersion')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'schemaVersion') <> 'number'
    or new.tree_data ->> 'schemaVersion' <> '2' then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_CASE_SCHEMA_VERSION_INVALID';
  end if;

  if new.id is null
    or not (new.tree_data ? 'id')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'id') <> 'string'
    or new.tree_data ->> 'id' <> new.id::text then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_ID_MIRROR_MISMATCH';
  end if;

  if new.title is not null
    and (
      pg_catalog.btrim(new.title) = ''
      or pg_catalog.char_length(new.title) > 200
    ) then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_TITLE_LENGTH_INVALID';
  end if;

  if new.title is null
    or not (new.tree_data ? 'title')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'title') <> 'string'
    or new.tree_data ->> 'title' <> new.title then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_TITLE_MIRROR_MISMATCH';
  end if;

  if not (new.tree_data ? 'people')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'people') <> 'array'
    or new.tree_data -> 'people' <> new.people then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PEOPLE_MIRROR_MISMATCH';
  end if;

  if not (new.tree_data ? 'familyGroups')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'familyGroups') <> 'array'
    or not (new.tree_data ? 'outsideParties')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'outsideParties') <> 'array'
    or not (new.tree_data ? 'properties')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'properties') <> 'array'
    or not (new.tree_data ? 'settings')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'settings') <> 'object'
    or not (new.tree_data ? 'activeFamilyGroupId')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'activeFamilyGroupId') <> 'string' then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_CORE_STRUCTURE_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(new.people) < 1 then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PERSON_REQUIRED';
  end if;

  if pg_catalog.jsonb_array_length(new.people) > max_people
    or pg_catalog.jsonb_array_length(new.tree_data -> 'familyGroups') > max_family_groups
    or pg_catalog.jsonb_array_length(new.tree_data -> 'outsideParties') > max_outside_parties
    or pg_catalog.jsonb_array_length(new.tree_data -> 'properties') > max_properties then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_COLLECTION_LIMIT_EXCEEDED';
  end if;

  if pg_catalog.jsonb_array_length(new.tree_data -> 'familyGroups') < 1
    or pg_catalog.jsonb_array_length(new.tree_data -> 'properties') < 1 then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_CORE_COLLECTION_EMPTY';
  end if;

  -- Traverse at most max_json_nodes + 1 nodes and at most one level beyond
  -- max_json_depth. Oversized hostile documents fail without an unbounded
  -- recursive walk.
  with recursive walk(value, depth, object_key) as (
    select new.tree_data, 0, null::text
    union all
    select child.value, walk.depth + 1, child.object_key
    from walk
    cross join lateral (
      select object_entry.value, object_entry.key
      from pg_catalog.jsonb_each(
        case
          when pg_catalog.jsonb_typeof(walk.value) = 'object' then walk.value
          else '{}'::jsonb
        end
      ) as object_entry
      union all
      select array_entry.value, null::text
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(walk.value) = 'array' then walk.value
          else '[]'::jsonb
        end
      ) as array_entry
    ) as child(value, object_key)
    where walk.depth < max_json_depth + 1
  ),
  bounded as materialized (
    select value, depth, object_key
    from walk
    limit 100001
  )
  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.max(depth), 0),
    coalesce(
      pg_catalog.bool_or(
        case
          when pg_catalog.jsonb_typeof(value) = 'array'
            then pg_catalog.jsonb_array_length(value) > max_array_items
          else false
        end
      ),
      false
    ),
    coalesce(
      pg_catalog.bool_or(
        case
          when pg_catalog.jsonb_typeof(value) = 'number' then
            pg_catalog.abs((value #>> array[]::text[])::numeric)
              > 1.7976931348623157e308::numeric
          else false
        end
      ),
      false
    ),
    coalesce(
      pg_catalog.bool_or(
        case
          when pg_catalog.jsonb_typeof(value) = 'object' then (
            select pg_catalog.count(*) > max_object_keys
            from pg_catalog.jsonb_object_keys(value)
          )
          else false
        end
      ),
      false
    ),
    coalesce(
      pg_catalog.bool_or(
        case
          when pg_catalog.jsonb_typeof(value) = 'string'
            then pg_catalog.octet_length(value #>> array[]::text[]) > max_string_bytes
          else false
        end
      ),
      false
    ),
    coalesce(
      pg_catalog.bool_or(
        object_key is not null and pg_catalog.octet_length(object_key) > max_key_bytes
      ),
      false
    ),
    coalesce(
      pg_catalog.bool_or(
        object_key in ('__proto__', 'prototype', 'constructor')
      ),
      false
    )
  into
    node_count,
    deepest_node,
    array_too_wide,
    number_out_of_range,
    object_too_wide,
    string_too_long,
    key_too_long,
    unsafe_key
  from bounded;

  if node_count > max_json_nodes then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_JSON_NODE_LIMIT_EXCEEDED';
  end if;
  if deepest_node > max_json_depth then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_JSON_DEPTH_EXCEEDED';
  end if;
  if array_too_wide then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_JSON_ARRAY_LIMIT_EXCEEDED';
  end if;
  if object_too_wide then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_JSON_OBJECT_LIMIT_EXCEEDED';
  end if;
  if string_too_long then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_JSON_STRING_LIMIT_EXCEEDED';
  end if;
  if number_out_of_range then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_JSON_NUMBER_OUT_OF_RANGE';
  end if;
  if key_too_long then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_JSON_KEY_LIMIT_EXCEEDED';
  end if;
  if unsafe_key then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_JSON_KEY_FORBIDDEN';
  end if;

  -- Canonical identity records must be objects with unique, bounded IDs.
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or not (item.value ? 'id')
      or pg_catalog.jsonb_typeof(item.value -> 'id') <> 'string'
      or pg_catalog.btrim(item.value ->> 'id') = ''
      or pg_catalog.octet_length(item.value ->> 'id') > max_id_bytes
      or item.value ->> 'id' ~ '[[:cntrl:]]'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PERSON_ID_INVALID';
  end if;

  select coalesce(pg_catalog.array_agg(item.value ->> 'id'), array[]::text[])
  into person_ids
  from pg_catalog.jsonb_array_elements(new.people) as item(value);

  select pg_catalog.count(*) <> pg_catalog.count(distinct item.value ->> 'id')
  into invalid_record
  from pg_catalog.jsonb_array_elements(new.people) as item(value);
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PERSON_ID_DUPLICATE';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'outsideParties') as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or not (item.value ? 'id')
      or pg_catalog.jsonb_typeof(item.value -> 'id') <> 'string'
      or pg_catalog.btrim(item.value ->> 'id') = ''
      or pg_catalog.octet_length(item.value ->> 'id') > max_id_bytes
      or item.value ->> 'id' ~ '[[:cntrl:]]'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_OUTSIDE_PARTY_ID_INVALID';
  end if;

  select coalesce(pg_catalog.array_agg(item.value ->> 'id'), array[]::text[])
  into outside_party_ids
  from pg_catalog.jsonb_array_elements(new.tree_data -> 'outsideParties') as item(value);

  select pg_catalog.count(*) <> pg_catalog.count(distinct item.value ->> 'id')
  into invalid_record
  from pg_catalog.jsonb_array_elements(new.tree_data -> 'outsideParties') as item(value);
  if invalid_record or person_ids && outside_party_ids then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PARTY_ID_DUPLICATE';
  end if;
  party_ids := person_ids || outside_party_ids;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or not (item.value ? 'id')
      or pg_catalog.jsonb_typeof(item.value -> 'id') <> 'string'
      or pg_catalog.btrim(item.value ->> 'id') = ''
      or pg_catalog.octet_length(item.value ->> 'id') > max_id_bytes
      or item.value ->> 'id' ~ '[[:cntrl:]]'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PROPERTY_ID_INVALID';
  end if;

  select coalesce(pg_catalog.array_agg(item.value ->> 'id'), array[]::text[])
  into property_ids
  from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as item(value);

  select pg_catalog.count(*) <> pg_catalog.count(distinct item.value ->> 'id')
  into invalid_record
  from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as item(value);
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PROPERTY_ID_DUPLICATE';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'familyGroups') as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or not (item.value ? 'id')
      or pg_catalog.jsonb_typeof(item.value -> 'id') <> 'string'
      or pg_catalog.btrim(item.value ->> 'id') = ''
      or pg_catalog.octet_length(item.value ->> 'id') > max_id_bytes
      or item.value ->> 'id' ~ '[[:cntrl:]]'
      or not (item.value ? 'rootPersonId')
      or pg_catalog.jsonb_typeof(item.value -> 'rootPersonId') <> 'string'
      or not (item.value ? 'personIds')
      or pg_catalog.jsonb_typeof(item.value -> 'personIds') <> 'array'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_FAMILY_GROUP_INVALID';
  end if;

  select coalesce(pg_catalog.array_agg(item.value ->> 'id'), array[]::text[])
  into family_group_ids
  from pg_catalog.jsonb_array_elements(new.tree_data -> 'familyGroups') as item(value);

  select pg_catalog.count(*) <> pg_catalog.count(distinct item.value ->> 'id')
  into invalid_record
  from pg_catalog.jsonb_array_elements(new.tree_data -> 'familyGroups') as item(value);
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_FAMILY_GROUP_ID_DUPLICATE';
  end if;

  -- Known collection fields may be absent while a user is working on an old
  -- or incomplete record, but when present they must have the right shape.
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    where (person.value ? 'fatherId'
        and pg_catalog.jsonb_typeof(person.value -> 'fatherId') <> 'string')
      or (person.value ? 'motherId'
        and pg_catalog.jsonb_typeof(person.value -> 'motherId') <> 'string')
      or (person.value ? 'survivalStatusReferencePersonId'
        and pg_catalog.jsonb_typeof(person.value -> 'survivalStatusReferencePersonId') <> 'string')
      or (person.value ? 'spouseIds'
        and pg_catalog.jsonb_typeof(person.value -> 'spouseIds') <> 'array')
      or (person.value ? 'siblingIds'
        and pg_catalog.jsonb_typeof(person.value -> 'siblingIds') <> 'array')
      or (person.value ? 'partnerRelationships'
        and pg_catalog.jsonb_typeof(person.value -> 'partnerRelationships') <> 'array')
      or (person.value ? 'wills'
        and pg_catalog.jsonb_typeof(person.value -> 'wills') <> 'array')
      or (person.value ? 'willHeirs'
        and pg_catalog.jsonb_typeof(person.value -> 'willHeirs') <> 'array')
      or (person.value ? 'intestateHeirs'
        and pg_catalog.jsonb_typeof(person.value -> 'intestateHeirs') <> 'array')
      or (person.value ? 'causaMortisDeclarations'
        and pg_catalog.jsonb_typeof(person.value -> 'causaMortisDeclarations') <> 'array')
      or (person.value ? 'designations'
        and pg_catalog.jsonb_typeof(person.value -> 'designations') <> 'array')
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PERSON_COLLECTION_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'spouseIds', '[]'::jsonb)
    ) as reference(value)
    where pg_catalog.jsonb_typeof(reference.value) <> 'string'
      or pg_catalog.btrim(reference.value #>> array[]::text[]) = ''
      or pg_catalog.octet_length(reference.value #>> array[]::text[]) > max_id_bytes
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'siblingIds', '[]'::jsonb)
    ) as reference(value)
    where pg_catalog.jsonb_typeof(reference.value) <> 'string'
      or pg_catalog.btrim(reference.value #>> array[]::text[]) = ''
      or pg_catalog.octet_length(reference.value #>> array[]::text[]) > max_id_bytes
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'designations', '[]'::jsonb)
    ) as designation(value)
    where pg_catalog.jsonb_typeof(designation.value) <> 'string'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PERSON_REFERENCE_ARRAY_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'partnerRelationships', '[]'::jsonb)
    ) as relationship(value)
    where pg_catalog.jsonb_typeof(relationship.value) <> 'object'
      or not (relationship.value ? 'personId')
      or pg_catalog.jsonb_typeof(relationship.value -> 'personId') <> 'string'
      or pg_catalog.btrim(relationship.value ->> 'personId') = ''
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'wills', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'willHeirs', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'personId'
        and pg_catalog.jsonb_typeof(record.value -> 'personId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'intestateHeirs', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'personId'
        and pg_catalog.jsonb_typeof(record.value -> 'personId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'causaMortisDeclarations', '[]'::jsonb)
    ) as declaration(value)
    where pg_catalog.jsonb_typeof(declaration.value) <> 'object'
      or (declaration.value ? 'propertyId'
        and pg_catalog.jsonb_typeof(declaration.value -> 'propertyId') <> 'string')
      or (declaration.value ? 'declarantPersonIds'
        and pg_catalog.jsonb_typeof(declaration.value -> 'declarantPersonIds') <> 'array')
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PERSON_NESTED_RECORD_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'causaMortisDeclarations', '[]'::jsonb)
    ) as declaration(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(declaration.value -> 'declarantPersonIds', '[]'::jsonb)
    ) as reference(value)
    where pg_catalog.jsonb_typeof(reference.value) <> 'string'
      or pg_catalog.btrim(reference.value #>> array[]::text[]) = ''
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_CM_DECLARANT_ARRAY_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    where (property.value ? 'owners'
        and pg_catalog.jsonb_typeof(property.value -> 'owners') <> 'array')
      or (property.value ? 'transfers'
        and pg_catalog.jsonb_typeof(property.value -> 'transfers') <> 'array')
      or (property.value ? 'declarations'
        and pg_catalog.jsonb_typeof(property.value -> 'declarations') <> 'array')
      or (property.value ? 'saleLots'
        and pg_catalog.jsonb_typeof(property.value -> 'saleLots') <> 'array')
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PROPERTY_COLLECTION_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(property.value -> 'owners', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'personId'
        and pg_catalog.jsonb_typeof(record.value -> 'personId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(property.value -> 'transfers', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'sellerId'
        and pg_catalog.jsonb_typeof(record.value -> 'sellerId') <> 'string')
      or (record.value ? 'buyerId'
        and pg_catalog.jsonb_typeof(record.value -> 'buyerId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(property.value -> 'declarations', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(property.value -> 'saleLots', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'ownerId'
        and pg_catalog.jsonb_typeof(record.value -> 'ownerId') <> 'string')
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PROPERTY_NESTED_RECORD_INVALID';
  end if;

  if (new.tree_data ? 'transfers'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'transfers') <> 'array')
    or (new.tree_data ? 'declarations'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'declarations') <> 'array')
    or (new.tree_data ? 'saleLots'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'saleLots') <> 'array')
    or (new.tree_data ? 'heirs'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'heirs') <> 'array')
    or (new.tree_data ? 'statusToggleSessions'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'statusToggleSessions') <> 'array')
    or (new.tree_data ? 'succession'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'succession') <> 'object')
    or (new.tree_data -> 'succession' ? 'heirs'
      and pg_catalog.jsonb_typeof(new.tree_data -> 'succession' -> 'heirs') <> 'array') then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_ROOT_COLLECTION_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'transfers', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'sellerId'
        and pg_catalog.jsonb_typeof(record.value -> 'sellerId') <> 'string')
      or (record.value ? 'buyerId'
        and pg_catalog.jsonb_typeof(record.value -> 'buyerId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'declarations', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'saleLots', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'ownerId'
        and pg_catalog.jsonb_typeof(record.value -> 'ownerId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'heirs', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'personId'
        and pg_catalog.jsonb_typeof(record.value -> 'personId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'succession' -> 'heirs', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or (record.value ? 'personId'
        and pg_catalog.jsonb_typeof(record.value -> 'personId') <> 'string')
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'statusToggleSessions', '[]'::jsonb)
    ) as record(value)
    where pg_catalog.jsonb_typeof(record.value) <> 'object'
      or not (record.value ? 'personId')
      or pg_catalog.jsonb_typeof(record.value -> 'personId') <> 'string'
      or pg_catalog.btrim(record.value ->> 'personId') = ''
      or (record.value ? 'propertyId'
        and pg_catalog.jsonb_typeof(record.value -> 'propertyId') <> 'string')
      or (record.value ? 'activeFamilyGroupId'
        and pg_catalog.jsonb_typeof(record.value -> 'activeFamilyGroupId') <> 'string')
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_ROOT_NESTED_RECORD_INVALID';
  end if;

  -- Family-group membership is allowed to be empty for a preserved legacy tab,
  -- but every non-empty root/member must identify a canonical person.
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'familyGroups') as family_group(value)
    cross join lateral pg_catalog.jsonb_array_elements(family_group.value -> 'personIds')
      as member(value)
    where pg_catalog.jsonb_typeof(member.value) <> 'string'
      or pg_catalog.btrim(member.value #>> array[]::text[]) = ''
      or not ((member.value #>> array[]::text[]) = any(person_ids))
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'familyGroups') as family_group(value)
    where coalesce(family_group.value ->> 'rootPersonId', '') <> ''
      and (
        not ((family_group.value ->> 'rootPersonId') = any(person_ids))
        or not ((family_group.value -> 'personIds') ? (family_group.value ->> 'rootPersonId'))
      )
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_FAMILY_GROUP_REFERENCE_INVALID';
  end if;

  if pg_catalog.btrim(new.tree_data ->> 'activeFamilyGroupId') = ''
    or not ((new.tree_data ->> 'activeFamilyGroupId') = any(family_group_ids)) then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_ACTIVE_FAMILY_GROUP_INVALID';
  end if;

  if not (new.tree_data -> 'settings' ? 'activePropertyId')
    or pg_catalog.jsonb_typeof(new.tree_data -> 'settings' -> 'activePropertyId') <> 'string'
    or pg_catalog.btrim(new.tree_data -> 'settings' ->> 'activePropertyId') = ''
    or not ((new.tree_data -> 'settings' ->> 'activePropertyId') = any(property_ids)) then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_ACTIVE_PROPERTY_INVALID';
  end if;

  -- Empty scalar references are retained because draft heir, owner and transfer
  -- rows are valid autosave states. Any non-empty reference must resolve.
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral (
      values
        (person.value ->> 'fatherId'),
        (person.value ->> 'motherId'),
        (person.value ->> 'survivalStatusReferencePersonId')
    ) as reference(person_id)
    where coalesce(reference.person_id, '') <> ''
      and not (reference.person_id = any(person_ids))
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral (
      select reference.value #>> array[]::text[] as person_id
      from pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'spouseIds', '[]'::jsonb)
      ) as reference(value)
      union all
      select reference.value #>> array[]::text[]
      from pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'siblingIds', '[]'::jsonb)
      ) as reference(value)
      union all
      select relationship.value ->> 'personId'
      from pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'partnerRelationships', '[]'::jsonb)
      ) as relationship(value)
    ) as reference
    where not (reference.person_id = any(person_ids))
      or reference.person_id = person.value ->> 'id'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_RELATIONSHIP_REFERENCE_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    where coalesce(person.value ->> 'fatherId', '') <> ''
      and person.value ->> 'fatherId' = person.value ->> 'motherId'
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PARENT_REFERENCE_CONTRADICTORY';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral (
      select heir.value ->> 'personId' as person_id
      from pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'willHeirs', '[]'::jsonb)
      ) as heir(value)
      union all
      select heir.value ->> 'personId'
      from pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'intestateHeirs', '[]'::jsonb)
      ) as heir(value)
      union all
      select declarant.value #>> array[]::text[]
      from pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'causaMortisDeclarations', '[]'::jsonb)
      ) as declaration(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(declaration.value -> 'declarantPersonIds', '[]'::jsonb)
      ) as declarant(value)
    ) as reference
    where coalesce(reference.person_id, '') <> ''
      and not (reference.person_id = any(party_ids))
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_LEGAL_PARTY_REFERENCE_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(person.value -> 'causaMortisDeclarations', '[]'::jsonb)
    ) as declaration(value)
    where coalesce(declaration.value ->> 'propertyId', '') <> ''
      and not ((declaration.value ->> 'propertyId') = any(property_ids))
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_CM_PROPERTY_REFERENCE_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    cross join lateral (
      select owner.value ->> 'personId' as person_id
      from pg_catalog.jsonb_array_elements(
        coalesce(property.value -> 'owners', '[]'::jsonb)
      ) as owner(value)
      union all
      select transfer.value ->> 'sellerId'
      from pg_catalog.jsonb_array_elements(
        coalesce(property.value -> 'transfers', '[]'::jsonb)
      ) as transfer(value)
      union all
      select transfer.value ->> 'buyerId'
      from pg_catalog.jsonb_array_elements(
        coalesce(property.value -> 'transfers', '[]'::jsonb)
      ) as transfer(value)
      union all
      select lot.value ->> 'ownerId'
      from pg_catalog.jsonb_array_elements(
        coalesce(property.value -> 'saleLots', '[]'::jsonb)
      ) as lot(value)
    ) as reference
    where coalesce(reference.person_id, '') <> ''
      and not (reference.person_id = any(party_ids))
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PROPERTY_PARTY_REFERENCE_INVALID';
  end if;

  select exists (
    select 1
    from (
      select transfer.value ->> 'sellerId' as person_id
      from pg_catalog.jsonb_array_elements(
        coalesce(new.tree_data -> 'transfers', '[]'::jsonb)
      ) as transfer(value)
      union all
      select transfer.value ->> 'buyerId'
      from pg_catalog.jsonb_array_elements(
        coalesce(new.tree_data -> 'transfers', '[]'::jsonb)
      ) as transfer(value)
      union all
      select lot.value ->> 'ownerId'
      from pg_catalog.jsonb_array_elements(
        coalesce(new.tree_data -> 'saleLots', '[]'::jsonb)
      ) as lot(value)
      union all
      select heir.value ->> 'personId'
      from pg_catalog.jsonb_array_elements(
        coalesce(new.tree_data -> 'heirs', '[]'::jsonb)
      ) as heir(value)
      union all
      select heir.value ->> 'personId'
      from pg_catalog.jsonb_array_elements(
        coalesce(new.tree_data -> 'succession' -> 'heirs', '[]'::jsonb)
      ) as heir(value)
    ) as reference
    where coalesce(reference.person_id, '') <> ''
      and not (reference.person_id = any(party_ids))
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_ROOT_PARTY_REFERENCE_INVALID';
  end if;

  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(new.tree_data -> 'statusToggleSessions', '[]'::jsonb)
    ) as session(value)
    where not ((session.value ->> 'personId') = any(person_ids))
      or (
        coalesce(session.value ->> 'propertyId', '') <> ''
        and not ((session.value ->> 'propertyId') = any(property_ids))
      )
      or (
        coalesce(session.value ->> 'activeFamilyGroupId', '') <> ''
        and not ((session.value ->> 'activeFamilyGroupId') = any(family_group_ids))
      )
  ) into invalid_record;
  if invalid_record then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_STATUS_SESSION_REFERENCE_INVALID';
  end if;

  select
    coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(coalesce(person.value -> 'spouseIds', '[]'::jsonb))
        + pg_catalog.jsonb_array_length(coalesce(person.value -> 'siblingIds', '[]'::jsonb))
        + pg_catalog.jsonb_array_length(
          coalesce(person.value -> 'partnerRelationships', '[]'::jsonb)
        )
      )
      from pg_catalog.jsonb_array_elements(new.people) as person(value)
    ), 0)
    + coalesce((
      select pg_catalog.sum(pg_catalog.jsonb_array_length(family_group.value -> 'personIds'))
      from pg_catalog.jsonb_array_elements(
        new.tree_data -> 'familyGroups'
      ) as family_group(value)
    ), 0)
    + coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(
          coalesce(declaration.value -> 'declarantPersonIds', '[]'::jsonb)
        )
      )
      from pg_catalog.jsonb_array_elements(new.people) as person(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(person.value -> 'causaMortisDeclarations', '[]'::jsonb)
      ) as declaration(value)
    ), 0),
    coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(coalesce(property.value -> 'owners', '[]'::jsonb))
      )
      from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    ), 0),
    pg_catalog.jsonb_array_length(coalesce(new.tree_data -> 'transfers', '[]'::jsonb))
    + coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(coalesce(property.value -> 'transfers', '[]'::jsonb))
      )
      from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    ), 0),
    pg_catalog.jsonb_array_length(coalesce(new.tree_data -> 'declarations', '[]'::jsonb))
    + coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(
          coalesce(person.value -> 'causaMortisDeclarations', '[]'::jsonb)
        )
      )
      from pg_catalog.jsonb_array_elements(new.people) as person(value)
    ), 0)
    + coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(coalesce(property.value -> 'declarations', '[]'::jsonb))
      )
      from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    ), 0),
    pg_catalog.jsonb_array_length(coalesce(new.tree_data -> 'saleLots', '[]'::jsonb))
    + coalesce((
      select pg_catalog.sum(
        pg_catalog.jsonb_array_length(coalesce(property.value -> 'saleLots', '[]'::jsonb))
      )
      from pg_catalog.jsonb_array_elements(new.tree_data -> 'properties') as property(value)
    ), 0)
  into
    relationship_reference_count,
    owner_count,
    transfer_count,
    declaration_count,
    sale_lot_count;

  if relationship_reference_count > 50000 then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_RELATIONSHIP_REFERENCE_LIMIT_EXCEEDED';
  end if;
  if owner_count > 20000
    or transfer_count > 20000
    or declaration_count > 20000
    or sale_lot_count > 20000 then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_RECORD_COUNT_LIMIT_EXCEEDED';
  end if;

  -- Detect ancestry cycles through the two parent links. UNION deduplicates
  -- reachability pairs; the bounded consumer prevents a hostile graph from
  -- demanding unbounded work.
  with recursive parent_edges(child_id, parent_id) as (
    select person.value ->> 'id', person.value ->> 'fatherId'
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    where coalesce(person.value ->> 'fatherId', '') <> ''
    union all
    select person.value ->> 'id', person.value ->> 'motherId'
    from pg_catalog.jsonb_array_elements(new.people) as person(value)
    where coalesce(person.value ->> 'motherId', '') <> ''
  ),
  reach(origin_id, ancestor_id) as (
    select child_id, parent_id from parent_edges
    union
    select reach.origin_id, parent_edges.parent_id
    from reach
    join parent_edges on parent_edges.child_id = reach.ancestor_id
  ),
  bounded_reach as materialized (
    select origin_id, ancestor_id
    from reach
    limit 100001
  )
  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.bool_or(origin_id = ancestor_id), false)
  into ancestry_pair_count, ancestry_cycle
  from bounded_reach;

  if ancestry_pair_count > max_ancestry_pairs then
    raise sqlstate 'PT413' using
      message = 'TREE_PAYLOAD_TOO_LARGE',
      detail = 'TREE_RELATIONSHIP_GRAPH_LIMIT_EXCEEDED';
  end if;
  if ancestry_cycle then
    raise sqlstate 'PT422' using
      message = 'TREE_PAYLOAD_INVALID',
      detail = 'TREE_PARENT_CYCLE_DETECTED';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_family_tree_payload()
from public, anon, authenticated;

drop trigger if exists family_trees_00_validate_payload on public.family_trees;
create trigger family_trees_00_validate_payload
before insert or update of id, title, people, tree_data on public.family_trees
for each row execute function private.validate_family_tree_payload();

comment on function private.validate_family_tree_payload()
is 'Fail-closed structural and resource validation for every persisted family-tree payload.';


create or replace function public.save_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_people jsonb,
  p_tree_data jsonb
)
returns setof public.family_trees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_SAVE_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_SAVE_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is not null then
    raise sqlstate 'PT409' using
      message = 'TREE_SAVE_CONFLICT';
  end if;

  return query
  update public.family_trees as tree
  set
    title = p_title,
    people = p_people,
    tree_data = p_tree_data
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  returning tree.*;
end;
$$;

revoke all on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)
to authenticated;

comment on function public.save_family_tree(uuid, bigint, text, jsonb, jsonb)
is 'Owner-checked compare-and-swap save for active family_trees; raises TREE_SAVE_CONFLICT on a stale revision or trashed row.';

create or replace function public.trash_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint
)
returns setof public.family_trees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_TRASH_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_TRASH_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is not null then
    raise sqlstate 'PT409' using
      message = 'TREE_TRASH_CONFLICT';
  end if;

  return query
  update public.family_trees as tree
  set deleted_at = now()
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  returning tree.*;
end;
$$;

revoke all on function public.trash_family_tree(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.trash_family_tree(uuid, bigint)
to authenticated;

comment on function public.trash_family_tree(uuid, bigint)
is 'Owner-checked compare-and-swap soft delete for an active family tree.';

create or replace function public.restore_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint
)
returns setof public.family_trees
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_RESTORE_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_RESTORE_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is null then
    raise sqlstate 'PT409' using
      message = 'TREE_RESTORE_CONFLICT';
  end if;

  if current_deleted_at <= now() - interval '30 days' then
    raise sqlstate 'PT410' using
      message = 'TREE_RESTORE_EXPIRED';
  end if;

  return query
  update public.family_trees as tree
  set deleted_at = null
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  returning tree.*;
end;
$$;

revoke all on function public.restore_family_tree(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.restore_family_tree(uuid, bigint)
to authenticated;

comment on function public.restore_family_tree(uuid, bigint)
is 'Owner-checked compare-and-swap restore within 30 days of soft deletion.';

create or replace function public.permanently_delete_family_tree(
  p_tree_id uuid,
  p_expected_revision bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_deleted_at timestamptz;
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_PERMANENT_DELETE_AUTH_REQUIRED';
  end if;

  select tree.revision, tree.deleted_at
  into current_revision, current_deleted_at
  from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'TREE_PERMANENT_DELETE_FORBIDDEN';
  end if;

  if p_expected_revision is null
    or p_expected_revision <= 0
    or current_revision <> p_expected_revision
    or current_deleted_at is null then
    raise sqlstate 'PT409' using
      message = 'TREE_PERMANENT_DELETE_CONFLICT';
  end if;

  delete from public.family_trees as tree
  where tree.id = p_tree_id
    and tree.owner_id = caller_id;

  return p_tree_id;
end;
$$;

revoke all on function public.permanently_delete_family_tree(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.permanently_delete_family_tree(uuid, bigint)
to authenticated;

comment on function public.permanently_delete_family_tree(uuid, bigint)
is 'Owner-checked compare-and-swap permanent deletion of an already trashed family tree.';

create or replace function public.list_trashed_family_trees()
returns setof public.family_trees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception using
      errcode = '42501',
      message = 'TREE_TRASH_LIST_AUTH_REQUIRED';
  end if;

  return query
  select tree.*
  from public.family_trees as tree
  where tree.owner_id = caller_id
    and tree.deleted_at is not null
  order by tree.deleted_at desc, tree.id;
end;
$$;

revoke all on function public.list_trashed_family_trees()
from public, anon, authenticated;
grant execute on function public.list_trashed_family_trees()
to authenticated;

comment on function public.list_trashed_family_trees()
is 'Lists every trashed family tree owned by the authenticated caller, including rows past the restore window.';

drop trigger if exists tree_accounts_set_updated_at on public.tree_accounts;
create trigger tree_accounts_set_updated_at
before update on public.tree_accounts
for each row execute function private.set_updated_at();

drop trigger if exists tree_credit_orders_set_updated_at on public.tree_credit_orders;
create trigger tree_credit_orders_set_updated_at
before update on public.tree_credit_orders
for each row execute function private.set_updated_at();

-- Existing pre-commercial trees count towards lifetime use, but are never
-- charged retroactively. Rows after the first five are recorded as legacy.
insert into public.tree_accounts (user_id, free_trees_used, total_trees_created)
select
  owner_id,
  least(count(*), 5)::smallint,
  count(*)::integer
from public.family_trees
group by owner_id
on conflict (user_id) do update
set
  free_trees_used = greatest(public.tree_accounts.free_trees_used, excluded.free_trees_used),
  total_trees_created = greatest(
    public.tree_accounts.total_trees_created,
    excluded.total_trees_created
  );

with ranked_trees as (
  select
    tree.id,
    tree.owner_id,
    tree.title,
    tree.created_at,
    row_number() over (
      partition by tree.owner_id
      order by tree.created_at, tree.id
    ) as lifetime_number
  from public.family_trees tree
)
insert into public.tree_generations (
  tree_id,
  owner_id,
  entitlement_source,
  tree_title,
  created_at
)
select
  id,
  owner_id,
  case when lifetime_number <= 5 then 'free' else 'legacy' end,
  title,
  created_at
from ranked_trees
on conflict (tree_id) do nothing;

create or replace function private.consume_tree_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  account public.tree_accounts%rowtype;
  allocation_source text;
begin
  if caller_id is null or new.owner_id <> caller_id then
    raise exception using
      errcode = '42501',
      message = 'TREE_OWNER_REQUIRED';
  end if;

  insert into public.tree_accounts (user_id)
  values (caller_id)
  on conflict (user_id) do nothing;

  select * into account
  from public.tree_accounts
  where user_id = caller_id
  for update;

  if account.unlimited_trees then
    allocation_source := 'admin';
    update public.tree_accounts
    set total_trees_created = total_trees_created + 1
    where user_id = caller_id;
  elsif account.free_trees_used < account.free_tree_limit then
    allocation_source := 'free';
    update public.tree_accounts
    set
      free_trees_used = free_trees_used + 1,
      total_trees_created = total_trees_created + 1
    where user_id = caller_id;
  elsif account.paid_tree_credits > 0 then
    allocation_source := 'paid';
    update public.tree_accounts
    set
      paid_tree_credits = paid_tree_credits - 1,
      total_trees_created = total_trees_created + 1
    where user_id = caller_id;
  else
    raise exception using
      errcode = 'P0001',
      message = 'TREE_PAYMENT_REQUIRED',
      detail = 'The five free tree generations have been used. Purchase one EUR 30 tree credit.';
  end if;

  insert into public.tree_generations (
    tree_id,
    owner_id,
    entitlement_source,
    tree_title
  ) values (
    new.id,
    caller_id,
    allocation_source,
    new.title
  );

  return new;
end;
$$;

revoke all on function private.consume_tree_entitlement() from public, anon, authenticated;

drop trigger if exists family_trees_consume_entitlement on public.family_trees;
create trigger family_trees_consume_entitlement
after insert on public.family_trees
for each row execute function private.consume_tree_entitlement();

create or replace function private.grant_paid_tree_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    insert into public.tree_accounts (user_id)
    values (new.user_id)
    on conflict (user_id) do nothing;

    update public.tree_accounts
    set paid_tree_credits = paid_tree_credits + new.quantity
    where user_id = new.user_id;

    new.fulfilled_at := coalesce(new.fulfilled_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.grant_paid_tree_credit() from public, anon, authenticated;

drop trigger if exists tree_credit_orders_grant_paid_credit on public.tree_credit_orders;
create trigger tree_credit_orders_grant_paid_credit
before insert or update of status on public.tree_credit_orders
for each row execute function private.grant_paid_tree_credit();

-- Process each verified Stripe event and its entitlement change in one
-- PostgreSQL transaction. The public location makes the RPC reachable through
-- PostgREST, but only the service_role used by the Edge Function may execute it.
create or replace function public.process_stripe_tree_event(
  p_event_id text,
  p_event_type text,
  p_order_id uuid,
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_status text,
  p_amount_total integer,
  p_currency text,
  p_payment_intent_id text,
  p_customer_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
  tree_order public.tree_credit_orders%rowtype;
begin
  if nullif(btrim(p_event_id), '') is null or char_length(p_event_id) > 255 then
    raise exception using errcode = '22023', message = 'INVALID_STRIPE_EVENT_ID';
  end if;
  if nullif(btrim(p_event_type), '') is null or char_length(p_event_type) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_STRIPE_EVENT_TYPE';
  end if;

  insert into public.stripe_tree_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing
  returning true into claimed;

  if not coalesce(claimed, false) then
    return 'duplicate';
  end if;

  if p_event_type not in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.expired',
    'checkout.session.async_payment_failed'
  ) then
    return 'ignored';
  end if;

  if p_order_id is null or p_user_id is null or nullif(btrim(p_checkout_session_id), '') is null then
    raise exception using errcode = '22023', message = 'INCOMPLETE_TREE_CHECKOUT_REFERENCE';
  end if;

  select orders.* into tree_order
  from public.tree_credit_orders orders
  where orders.id = p_order_id
    and orders.user_id = p_user_id
    and orders.unit_amount_cents = 3000
    and orders.currency = 'eur'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TREE_CREDIT_ORDER_NOT_FOUND';
  end if;

  if tree_order.stripe_checkout_session_id is distinct from p_checkout_session_id then
    raise exception using errcode = 'P0001', message = 'TREE_CHECKOUT_SESSION_MISMATCH';
  end if;

  -- Checkout can complete before a delayed payment method settles. Record the
  -- event idempotently but leave the order pending for the later success/fail
  -- event.
  if p_event_type = 'checkout.session.completed'
    and p_payment_status is distinct from 'paid' then
    return 'awaiting_payment';
  end if;

  if p_event_type in ('checkout.session.expired', 'checkout.session.async_payment_failed') then
    if tree_order.status = 'pending' then
      update public.tree_credit_orders
      set status = 'expired'
      where id = tree_order.id;
      return 'expired';
    end if;

    -- A stale failure must never undo a successful, refunded or disputed
    -- payment state.
    return 'already_final';
  end if;

  if p_payment_status is distinct from 'paid'
    or p_amount_total is distinct from 3000
    or lower(coalesce(p_currency, '')) <> 'eur'
    or nullif(btrim(p_payment_intent_id), '') is null then
    raise exception using errcode = '22023', message = 'INVALID_PAID_TREE_CHECKOUT';
  end if;

  if tree_order.status in ('pending', 'expired') then
    update public.tree_credit_orders
    set
      status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id
    where id = tree_order.id;
  elsif tree_order.status = 'paid' then
    if tree_order.stripe_payment_intent_id is distinct from p_payment_intent_id then
      raise exception using errcode = 'P0001', message = 'TREE_PAYMENT_INTENT_MISMATCH';
    end if;
  else
    -- Do not let an out-of-order paid event reverse a later refund/dispute.
    return 'already_final';
  end if;

  if nullif(btrim(p_customer_id), '') is not null then
    update public.tree_accounts
    set stripe_customer_id = p_customer_id
    where user_id = p_user_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'TREE_ACCOUNT_NOT_FOUND';
    end if;
  end if;

  return case when tree_order.status = 'paid' then 'already_paid' else 'paid' end;
end;
$$;

revoke all on function public.process_stripe_tree_event(
  text, text, uuid, uuid, text, text, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.process_stripe_tree_event(
  text, text, uuid, uuid, text, text, integer, text, text, text
) to service_role;

comment on function public.process_stripe_tree_event(
  text, text, uuid, uuid, text, text, integer, text, text, text
) is 'Atomically processes a signature-verified Stripe tree-credit event; service_role only.';

alter table public.family_trees enable row level security;
alter table public.tree_accounts enable row level security;
alter table public.tree_credit_orders enable row level security;
alter table public.tree_generations enable row level security;
alter table public.stripe_tree_events enable row level security;

drop policy if exists "family tree owner access" on public.family_trees;
drop policy if exists "family trees select own" on public.family_trees;
drop policy if exists "family trees insert own" on public.family_trees;
drop policy if exists "family trees update own" on public.family_trees;
drop policy if exists "family trees delete own" on public.family_trees;
drop policy if exists "family trees select active own" on public.family_trees;
drop policy if exists "family trees insert active own" on public.family_trees;

create policy "family trees select active own"
on public.family_trees for select to authenticated
using (
  (select auth.uid()) = owner_id
  and deleted_at is null
);

create policy "family trees insert active own"
on public.family_trees for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and deleted_at is null
);

drop policy if exists "tree accounts select own" on public.tree_accounts;
create policy "tree accounts select own"
on public.tree_accounts for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tree credit orders select own" on public.tree_credit_orders;
create policy "tree credit orders select own"
on public.tree_credit_orders for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "tree generations select own" on public.tree_generations;
create policy "tree generations select own"
on public.tree_generations for select to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.family_trees from anon, authenticated;
revoke all on table public.tree_accounts from anon, authenticated;
revoke all on table public.tree_credit_orders from anon, authenticated;
revoke all on table public.tree_generations from anon, authenticated;
revoke all on table public.stripe_tree_events from anon, authenticated;

grant select, insert on table public.family_trees to authenticated;
grant select on table public.tree_accounts to authenticated;
grant select on table public.tree_credit_orders to authenticated;
grant select on table public.tree_generations to authenticated;

-- Minimum Data API privileges used by create-tree-checkout. Stripe webhook
-- fulfilment remains isolated behind process_stripe_tree_event.
grant select on table public.tree_accounts to service_role;
grant select, insert, update on table public.tree_credit_orders to service_role;

-- Versioned, append-only clickwrap audit trail. Users may read and insert
-- their own acceptance rows, but cannot update or delete them.
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 200),
  accepted_at timestamptz not null default now(),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500)
);

create unique index if not exists terms_acceptances_user_version_idx
  on public.terms_acceptances (user_id, version);

alter table public.terms_acceptances enable row level security;

drop policy if exists "terms acceptances select own" on public.terms_acceptances;
drop policy if exists "terms acceptances insert own" on public.terms_acceptances;

create policy "terms acceptances select own"
on public.terms_acceptances for select to authenticated
using ((select auth.uid()) = user_id);

create policy "terms acceptances insert own"
on public.terms_acceptances for insert to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table public.terms_acceptances from anon, authenticated;
grant select, insert on table public.terms_acceptances to authenticated;
