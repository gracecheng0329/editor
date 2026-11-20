-- Return the exact inserted message ID even when concurrent transaction timestamps differ.
create or replace function public.create_document_comment_thread(
  target_doc uuid,
  anchor jsonb,
  body text,
  share_token text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  access_role text;
  actor_name text;
  new_message_id uuid;
  new_thread_id uuid;
  anchor_type text;
  object_id text;
  offset_x numeric;
  offset_y numeric;
  world_x numeric;
  world_y numeric;
begin
  access_role := private.document_comment_access_role(target_doc, share_token);
  if auth.uid() is null or not public.document_session_active() or access_role is null then
    raise exception using errcode = '42501', message = 'authenticated_document_access_required';
  end if;
  if length(btrim(body)) not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'comment_body_invalid';
  end if;
  if jsonb_typeof(anchor) <> 'object' then
    raise exception using errcode = '22023', message = 'comment_anchor_invalid';
  end if;

  anchor_type := anchor ->> 'type';
  if anchor_type = 'object' then
    object_id := anchor ->> 'objectId';
    offset_x := (anchor #>> '{offset,x}')::numeric;
    offset_y := (anchor #>> '{offset,y}')::numeric;
    world_x := (anchor #>> '{world,x}')::numeric;
    world_y := (anchor #>> '{world,y}')::numeric;
    if object_id is null or length(object_id) not between 1 and 256 then
      raise exception using errcode = '22023', message = 'comment_anchor_invalid';
    end if;
  elsif anchor_type = 'world' then
    world_x := (anchor ->> 'x')::numeric;
    world_y := (anchor ->> 'y')::numeric;
  else
    raise exception using errcode = '22023', message = 'comment_anchor_invalid';
  end if;

  if greatest(abs(world_x), abs(world_y), abs(coalesce(offset_x, 0)), abs(coalesce(offset_y, 0))) > 100000000 then
    raise exception using errcode = '22023', message = 'comment_anchor_invalid';
  end if;

  select left(coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(u.raw_user_meta_data ->> 'user_name', ''),
    nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
    'GitHub 使用者'
  ), 80) into actor_name
  from auth.users u where u.id = auth.uid();

  insert into private.document_comment_threads(
    document_id, anchor_type, object_id, offset_x, offset_y,
    last_world_x, last_world_y, object_exists, created_by
  ) values (
    target_doc, anchor_type, object_id, offset_x, offset_y,
    world_x, world_y, case when anchor_type = 'object' then true else null end, auth.uid()
  ) returning id into new_thread_id;

  insert into private.document_comment_messages(thread_id, author_id, author_name, body)
  values (new_thread_id, auth.uid(), coalesce(actor_name, 'GitHub 使用者'), btrim(body)) returning id into new_message_id;

  perform realtime.send(
    payload => jsonb_build_object('id', new_thread_id, 'revision', 1),
    event => 'comment_changed',
    topic => 'document-comments:' || target_doc::text,
    private => true
  );
  return jsonb_build_object('id', new_thread_id, 'revision', 1, 'messageId', new_message_id);
end;
$$;
revoke all on function public.create_document_comment_thread(uuid, jsonb, text, text) from public;
grant execute on function public.create_document_comment_thread(uuid, jsonb, text, text) to authenticated;

create or replace function public.reply_document_comment_thread(
  target_doc uuid,
  target_thread uuid,
  body text,
  share_token text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  access_role text;
  actor_name text;
  new_message_id uuid;
  next_revision bigint;
begin
  access_role := private.document_comment_access_role(target_doc, share_token);
  if auth.uid() is null or not public.document_session_active() or access_role is null then
    raise exception using errcode = '42501', message = 'authenticated_document_access_required';
  end if;
  if length(btrim(body)) not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'comment_body_invalid';
  end if;

  select left(coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(u.raw_user_meta_data ->> 'user_name', ''),
    nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
    'GitHub 使用者'
  ), 80) into actor_name
  from auth.users u where u.id = auth.uid();

  update private.document_comment_threads t
  set revision = t.revision + 1
  where t.id = target_thread and t.document_id = target_doc
  returning revision into next_revision;
  if next_revision is null then
    raise exception using errcode = 'P0002', message = 'comment_thread_not_found';
  end if;

  insert into private.document_comment_messages(thread_id, author_id, author_name, body)
  values (target_thread, auth.uid(), coalesce(actor_name, 'GitHub 使用者'), btrim(body)) returning id into new_message_id;

  perform realtime.send(
    payload => jsonb_build_object('id', target_thread, 'revision', next_revision),
    event => 'comment_changed',
    topic => 'document-comments:' || target_doc::text,
    private => true
  );
  return jsonb_build_object('id', target_thread, 'revision', next_revision, 'messageId', new_message_id);
end;
$$;
revoke all on function public.reply_document_comment_thread(uuid, uuid, text, text) from public;
grant execute on function public.reply_document_comment_thread(uuid, uuid, text, text) to authenticated;

create or replace function public.write_document_comment(target_doc uuid, body text, anchor jsonb default null,
  target_thread uuid default null, mention_ids uuid[] default '{}', share_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; mentioned jsonb; message_id uuid;
begin
  if auth.uid() is null or not public.document_session_active()
    or private.document_comment_access_role(target_doc,share_token) is null then
    raise exception using errcode='42501', message='authenticated_document_access_required';
  end if;
  if mention_ids is null or cardinality(mention_ids) > 20 or exists (
    select 1 from unnest(mention_ids) x where x is null or not exists (
      select 1 from private.comment_participants(target_doc) p where p.id=x
    )
  ) then raise exception using errcode='22023', message='comment_mentions_invalid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.id),'[]') into mentioned
    from private.comment_participants(target_doc) p where p.id = any(mention_ids);
  if target_thread is null then
    result := public.create_document_comment_thread(target_doc,anchor,body,share_token);
  else
    result := public.reply_document_comment_thread(target_doc,target_thread,body,share_token);
  end if;
  message_id := (result->>'messageId')::uuid;
  update private.document_comment_messages set mentions=mentioned where id=message_id;
  return result;
end;
$$;
revoke all on function public.write_document_comment(uuid,text,jsonb,uuid,uuid[],text) from public,anon;
grant execute on function public.write_document_comment(uuid,text,jsonb,uuid,uuid[],text) to authenticated;
notify pgrst, 'reload schema';
