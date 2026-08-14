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
