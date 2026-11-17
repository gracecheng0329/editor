create or replace function private.document_comment_access_role(
  target_doc uuid,
  share_token text
) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is not null
      and public.document_session_active()
      and exists (
        select 1 from public.documents d
        where d.id = target_doc and d.owner_id = auth.uid()
      ) then 'owner'
    when auth.uid() is not null
      and public.document_session_active()
      and public.is_document_editor(target_doc) then 'editor'
    when share_token ~ '^[A-Za-z0-9_-]{43}$'
      and exists (
        select 1 from private.document_shares s
        where s.document_id = target_doc
          and s.token_hash = sha256(convert_to(share_token, 'UTF8'))
      ) then 'viewer'
    else null
  end;
$$;
revoke all on function private.document_comment_access_role(uuid, text) from public, anon, authenticated;

create or replace function public.update_document_comment_anchors(
  target_doc uuid,
  updates jsonb,
  share_token text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  access_role text;
  item jsonb;
  thread_id uuid;
  wanted_exists boolean;
  previous_exists boolean;
  world_x numeric;
  world_y numeric;
  next_revision bigint;
  changed boolean;
  changed_count integer := 0;
begin
  access_role := private.document_comment_access_role(target_doc, share_token);
  if auth.uid() is null or not public.document_session_active() or access_role is null then
    raise exception using errcode = '42501', message = 'authenticated_document_access_required';
  end if;
  if updates is null or jsonb_typeof(updates) <> 'array' then
    raise exception using errcode = '22023', message = 'comment_anchors_invalid';
  end if;
  if jsonb_array_length(updates) > 100 then
    raise exception using errcode = '22023', message = 'comment_anchors_invalid';
  end if;

  for item in select value from jsonb_array_elements(updates) loop
    thread_id := (item ->> 'threadId')::uuid;
    wanted_exists := (item ->> 'exists')::boolean;
    world_x := (item ->> 'worldX')::numeric;
    world_y := (item ->> 'worldY')::numeric;
    if greatest(abs(world_x), abs(world_y)) > 100000000 then
      raise exception using errcode = '22023', message = 'comment_anchors_invalid';
    end if;

    select t.object_exists into previous_exists
    from private.document_comment_threads t
    where t.id = thread_id and t.document_id = target_doc and t.anchor_type = 'object'
    for update;
    if not found then
      continue;
    end if;
    changed := previous_exists is distinct from wanted_exists;

    update private.document_comment_threads t
    set last_world_x = world_x,
        last_world_y = world_y,
        object_exists = wanted_exists,
        revision = t.revision + case when changed then 1 else 0 end
    where t.id = thread_id and t.document_id = target_doc and t.anchor_type = 'object'
    returning revision into next_revision;

    changed_count := changed_count + 1;
    if changed then
      perform realtime.send(
        payload => jsonb_build_object('id', thread_id, 'revision', next_revision),
        event => 'comment_changed',
        topic => 'document-comments:' || target_doc::text,
        private => true
      );
    end if;
  end loop;

  return jsonb_build_object('updated', changed_count);
end;
$$;
revoke all on function public.update_document_comment_anchors(uuid, jsonb, text) from public;
grant execute on function public.update_document_comment_anchors(uuid, jsonb, text) to anon, authenticated;
