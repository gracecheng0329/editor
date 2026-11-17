create table private.document_comment_threads (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  anchor_type text not null check (anchor_type in ('object', 'world')),
  object_id text,
  offset_x numeric,
  offset_y numeric,
  last_world_x numeric not null,
  last_world_y numeric not null,
  object_exists boolean,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revision bigint not null default 1,
  check (
    (anchor_type = 'object' and object_id is not null and length(object_id) between 1 and 256
      and offset_x is not null and offset_y is not null and object_exists is not null)
    or
    (anchor_type = 'world' and object_id is null and offset_x is null and offset_y is null
      and object_exists is null)
  )
);
create index document_comment_threads_document_created
  on private.document_comment_threads(document_id, created_at desc);
create index document_comment_threads_object
  on private.document_comment_threads(document_id, object_id)
  where anchor_type = 'object';

create table private.document_comment_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references private.document_comment_threads(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index document_comment_messages_thread_created
  on private.document_comment_messages(thread_id, created_at);

alter table private.document_comment_threads enable row level security;
alter table private.document_comment_messages enable row level security;
revoke all on private.document_comment_threads, private.document_comment_messages
  from public, anon, authenticated;

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
    when auth.uid() is not null and public.is_document_editor(target_doc) then 'editor'
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

create function public.get_document_comments(target_doc uuid, share_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  access_role text;
  result jsonb;
begin
  access_role := private.document_comment_access_role(target_doc, share_token);
  if access_role is null then
    raise exception using errcode = '42501', message = 'document_access_denied';
  end if;

  select jsonb_build_object(
    'role', access_role,
    'canWrite', (
      access_role in ('owner', 'editor')
      or (access_role = 'viewer' and auth.uid() is not null and public.document_session_active())
    ),
    'threads', coalesce(jsonb_agg(thread_json order by created_at desc), '[]'::jsonb)
  ) into result
  from (
    select t.created_at,
      jsonb_build_object(
        'id', t.id,
        'revision', t.revision,
        'createdAt', t.created_at,
        'anchor', case t.anchor_type
          when 'object' then jsonb_build_object(
            'type', 'object',
            'objectId', t.object_id,
            'offset', jsonb_build_object('x', t.offset_x, 'y', t.offset_y),
            'world', jsonb_build_object('x', t.last_world_x, 'y', t.last_world_y),
            'exists', t.object_exists
          )
          else jsonb_build_object(
            'type', 'world',
            'x', t.last_world_x,
            'y', t.last_world_y
          )
        end,
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id,
            'authorId', m.author_id,
            'author', m.author_name,
            'body', m.body,
            'createdAt', m.created_at
          ) order by m.created_at)
          from private.document_comment_messages m
          where m.thread_id = t.id
        ), '[]'::jsonb)
      ) as thread_json
    from private.document_comment_threads t
    where t.document_id = target_doc
  ) threads;

  return result;
end;
$$;
revoke all on function public.get_document_comments(uuid, text) from public;
grant execute on function public.get_document_comments(uuid, text) to anon, authenticated;

create function public.create_document_comment_thread(
  target_doc uuid,
  anchor jsonb,
  body text,
  share_token text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  access_role text;
  actor_name text;
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
  values (new_thread_id, auth.uid(), coalesce(actor_name, 'GitHub 使用者'), btrim(body));

  perform realtime.send(
    payload => jsonb_build_object('id', new_thread_id, 'revision', 1),
    event => 'comment_changed',
    topic => 'document-comments:' || target_doc::text,
    private => true
  );
  return jsonb_build_object('id', new_thread_id, 'revision', 1);
end;
$$;
revoke all on function public.create_document_comment_thread(uuid, jsonb, text, text) from public;
grant execute on function public.create_document_comment_thread(uuid, jsonb, text, text) to authenticated;

create function public.reply_document_comment_thread(
  target_doc uuid,
  target_thread uuid,
  body text,
  share_token text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  access_role text;
  actor_name text;
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
  values (target_thread, auth.uid(), coalesce(actor_name, 'GitHub 使用者'), btrim(body));

  perform realtime.send(
    payload => jsonb_build_object('id', target_thread, 'revision', next_revision),
    event => 'comment_changed',
    topic => 'document-comments:' || target_doc::text,
    private => true
  );
  return jsonb_build_object('id', target_thread, 'revision', next_revision);
end;
$$;
revoke all on function public.reply_document_comment_thread(uuid, uuid, text, text) from public;
grant execute on function public.reply_document_comment_thread(uuid, uuid, text, text) to authenticated;

create function public.update_document_comment_anchors(
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
  if access_role is null then
    raise exception using errcode = '42501', message = 'document_access_denied';
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

create function public.can_receive_document_comment_broadcast() returns boolean
language sql stable security definer set search_path = '' as $$
  select case (select auth.jwt() ->> 'document_role')
    when 'owner' then public.document_session_active() and exists (
      select 1 from public.documents d
      where d.id::text = (select auth.jwt() ->> 'document_id')
        and d.owner_id = (select auth.uid())
    )
    when 'editor' then public.document_session_active()
      and public.is_document_editor(((select auth.jwt()) ->> 'document_id')::uuid)
    when 'viewer' then exists (
      select 1 from private.document_shares s
      where s.document_id::text = (select auth.jwt() ->> 'document_id')
        and encode(s.token_hash, 'hex') = (select auth.jwt() ->> 'share_hash')
    )
    else false
  end;
$$;
revoke all on function public.can_receive_document_comment_broadcast() from public, anon;
grant execute on function public.can_receive_document_comment_broadcast() to authenticated;

drop policy if exists document_comment_broadcast on realtime.messages;
create policy document_comment_broadcast on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'document-comments:' || ((select auth.jwt()) ->> 'document_id')
    and (select public.can_receive_document_comment_broadcast())
  );

notify pgrst, 'reload schema';
