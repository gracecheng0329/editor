drop function public.store_document_version(text,text,text);
create function private.store_document_version_internal(
  target_key_id text,
  payload_text text,
  signature_hex text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb;
  signing_secret text;
  target_id uuid;
  target_document uuid;
  target_creator uuid;
  target_created_at timestamptz;
  target_generation bigint;
  target_revision bigint;
  existing private.document_versions%rowtype;
  inserted_count integer;
  is_duplicate boolean := false;
begin
  if target_key_id is null or target_key_id not in ('local', 'acceptance', 'production')
    or signature_hex is null or signature_hex !~ '^[0-9a-f]{64}$'
    or payload_text is null then
    raise insufficient_privilege;
  end if;
  select secret into signing_secret
    from private.document_version_signing_keys where key_id = target_key_id;
  if signing_secret is null or encode(
    extensions.hmac(convert_to(payload_text, 'UTF8'), convert_to(signing_secret, 'UTF8'), 'sha256'),
    'hex'
  ) <> signature_hex then
    raise insufficient_privilege;
  end if;

  payload := payload_text::jsonb;
  if jsonb_typeof(payload) <> 'object'
    or (select count(*) from jsonb_object_keys(payload)) <> 11
    or not (payload ?& array['id','documentId','kind','name','createdBy','createdAt','schema','sdkVersion','generation','revision','snapshot'])
    or jsonb_typeof(payload->'snapshot') is distinct from 'object'
    or jsonb_typeof(payload->'schema') is distinct from 'object'
    or payload->'schema' is distinct from payload->'snapshot'->'schema'
    or payload->>'kind' <> 'milestone'
    or payload->>'sdkVersion' <> '5.5.2'
    or length(btrim(payload->>'name')) not between 1 and 120
    or payload->>'name' <> btrim(payload->>'name')
    or jsonb_typeof(payload->'generation') <> 'number'
    or jsonb_typeof(payload->'revision') <> 'number'
    or (payload->>'generation') !~ '^[0-9]+$'
    or (payload->>'revision') !~ '^[0-9]+$' then
    raise invalid_parameter_value;
  end if;

  target_id := (payload->>'id')::uuid;
  target_document := (payload->>'documentId')::uuid;
  target_creator := (payload->>'createdBy')::uuid;
  target_created_at := (payload->>'createdAt')::timestamptz;
  target_generation := (payload->>'generation')::bigint;
  target_revision := (payload->>'revision')::bigint;
  if target_creator is distinct from auth.uid()
    or target_generation < 0 or target_revision < 0
    or not public.document_session_active()
    or not exists (
      select 1 from public.documents d
      where d.id = target_document and (
        d.owner_id = auth.uid() or exists (
          select 1 from private.document_editors e
          where e.document_id = d.id and e.user_id = auth.uid()
        )
      )
    ) then
    raise insufficient_privilege;
  end if;

  insert into private.document_versions(
    id, document_id, kind, name, created_by, created_at,
    schema_json, sdk_version, generation, revision, snapshot_json
  ) values (
    target_id, target_document, 'milestone', payload->>'name', target_creator,
    target_created_at, payload->'schema', payload->>'sdkVersion',
    target_generation, target_revision, payload->'snapshot'
  ) on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    select * into existing from private.document_versions where id = target_id;
    if not found
      or existing.document_id is distinct from target_document
      or existing.kind is distinct from payload->>'kind'
      or existing.name is distinct from payload->>'name'
      or existing.created_by is distinct from target_creator
      or existing.created_at is distinct from target_created_at
      or existing.schema_json is distinct from payload->'schema'
      or existing.sdk_version is distinct from payload->>'sdkVersion'
      or existing.generation is distinct from target_generation
      or existing.revision is distinct from target_revision
      or existing.snapshot_json is distinct from payload->'snapshot' then
      raise exception using errcode = 'P0001', message = 'VERSION_OPERATION_CONFLICT';
    end if;
    is_duplicate := true;
  end if;

  return jsonb_build_object(
    'id', target_id,
    'documentId', target_document,
    'kind', 'milestone',
    'name', payload->>'name',
    'createdBy', target_creator,
    'createdAt', target_created_at,
    'schema', payload->'schema',
    'sdkVersion', payload->>'sdkVersion',
    'generation', target_generation,
    'revision', target_revision,
    'snapshot', payload->'snapshot',
    'duplicate', is_duplicate
  );
end;
$$;
revoke all on function private.store_document_version_internal(text,text,text) from public, anon, authenticated;
create function public.store_document_version(
  target_key_id text,
  payload_text text,
  signature_hex text
) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.store_document_version_internal(target_key_id, payload_text, signature_hex);
$$;
revoke all on function public.store_document_version(text,text,text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.store_document_version_internal(text,text,text) to authenticated;
grant execute on function public.store_document_version(text,text,text) to authenticated;

drop function public.read_document_versions(uuid,uuid,text);
create function private.read_document_versions_internal(
  target_doc uuid,
  version_id uuid default null,
  share_token text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  allowed boolean;
  result jsonb;
begin
  select (
    public.document_session_active() and exists (
      select 1 from public.documents d where d.id = target_doc and (
        d.owner_id = auth.uid() or exists (
          select 1 from private.document_editors e
          where e.document_id = d.id and e.user_id = auth.uid()
        )
      )
    )
  ) or (
    share_token ~ '^[A-Za-z0-9_-]{43}$' and exists (
      select 1 from private.document_shares s
      where s.document_id = target_doc
        and s.token_hash = sha256(convert_to(share_token, 'UTF8'))
    )
  ) into allowed;
  if not coalesce(allowed, false) then raise no_data_found; end if;

  if version_id is null then
    select jsonb_build_object('versions', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id, 'documentId', document_id, 'kind', kind, 'name', name,
        'createdBy', created_by, 'createdAt', created_at, 'sdkVersion', sdk_version,
        'generation', generation, 'revision', revision
      ) order by created_at desc, id
    ), '[]'::jsonb)) into result
    from private.document_versions where document_id = target_doc;
    return result;
  end if;

  select jsonb_build_object(
    'id', id,
    'documentId', document_id,
    'kind', kind,
    'name', name,
    'createdBy', created_by,
    'createdAt', created_at,
    'schema', schema_json,
    'sdkVersion', sdk_version,
    'generation', generation,
    'revision', revision,
    'snapshot', snapshot_json
  ) into result
  from private.document_versions where document_id = target_doc and id = version_id;
  if result is null then return jsonb_build_object('error', 'VERSION_NOT_FOUND'); end if;
  return result;
end;
$$;
revoke all on function private.read_document_versions_internal(uuid,uuid,text) from public, anon, authenticated;
create function public.read_document_versions(
  target_doc uuid,
  version_id uuid default null,
  share_token text default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.read_document_versions_internal(target_doc, version_id, share_token);
$$;
revoke all on function public.read_document_versions(uuid,uuid,text) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.read_document_versions_internal(uuid,uuid,text) to anon, authenticated;
grant execute on function public.read_document_versions(uuid,uuid,text) to anon, authenticated;

create index document_versions_created_by on private.document_versions(created_by);
