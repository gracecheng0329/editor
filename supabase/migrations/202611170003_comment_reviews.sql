-- Product identities are derived from document grants or a verified share read.
create table private.document_comment_participants (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_hash bytea not null,
  primary key (document_id, user_id)
);
alter table private.document_comment_participants enable row level security;
revoke all on private.document_comment_participants from public, anon, authenticated;
alter table private.document_comment_threads
  add column status text not null default 'open' check (status in ('open', 'resolved')),
  add column resolved_by uuid references auth.users(id) on delete set null,
  add column resolved_at timestamptz;
alter table private.document_comment_messages add column mentions jsonb not null default '[]';

create function private.comment_participants(target_doc uuid) returns table(id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),
    nullif(u.raw_user_meta_data->>'name',''), nullif(u.raw_user_meta_data->>'user_name',''),
    nullif(u.raw_user_meta_data->>'preferred_username',''), 'GitHub 使用者'),80)
  from auth.users u where u.id in (
    select owner_id from public.documents where id = target_doc
    union select user_id from private.document_editors where document_id = target_doc
    union select p.user_id from private.document_comment_participants p
      join private.document_shares s on s.document_id = p.document_id and s.token_hash = p.share_hash
      where p.document_id = target_doc
  );
$$;
revoke all on function private.comment_participants(uuid) from public, anon, authenticated;

-- Keep the proven anchor/message serializer private and enrich its public response.
alter function public.get_document_comments(uuid,text) set schema private;
create function public.get_document_comments(target_doc uuid, share_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb; enriched jsonb; people jsonb;
begin
  result := private.get_document_comments(target_doc, share_token);
  if result->>'role' = 'viewer' and auth.uid() is not null and public.document_session_active() then
    insert into private.document_comment_participants values (target_doc, auth.uid(), sha256(convert_to(share_token,'UTF8')))
    on conflict (document_id,user_id) do update set share_hash = excluded.share_hash;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name,p.id),'[]')
    into people from private.comment_participants(target_doc) p where (result->>'canWrite')::boolean;
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'createdBy',t.created_by,'status',t.status,'resolvedBy',t.resolved_by,'resolvedAt',t.resolved_at,
    'canResolve', (result->>'canWrite')::boolean and ((result->>'role') in ('owner','editor') or t.created_by = auth.uid()),
    'messages', coalesce((select jsonb_agg(msg || jsonb_build_object('mentions',m.mentions) order by m.created_at,m.id)
      from jsonb_array_elements(item->'messages') msg
      join private.document_comment_messages m on m.id = (msg->>'id')::uuid),'[]')
    ) order by t.created_at desc,t.id),'[]') into enriched
    from jsonb_array_elements(result->'threads') item
    join private.document_comment_threads t on t.id = (item->>'id')::uuid;
  return result || jsonb_build_object('participants',people,'threads',enriched);
end;
$$;
revoke all on function private.get_document_comments(uuid,text) from public, anon, authenticated;
revoke all on function public.get_document_comments(uuid,text) from public;
grant execute on function public.get_document_comments(uuid,text) to anon, authenticated;

create function public.set_document_comment_status(target_doc uuid,target_thread uuid,next_status text,share_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare access_role text; creator uuid; next_revision bigint;
begin
  access_role := private.document_comment_access_role(target_doc,share_token);
  if auth.uid() is null or not public.document_session_active() or access_role is null then
    raise exception using errcode='42501', message='authenticated_document_access_required';
  end if;
  if next_status is null or next_status not in ('open','resolved') then
    raise exception using errcode='22023', message='comment_status_invalid';
  end if;
  select created_by into creator from private.document_comment_threads
    where id = target_thread and document_id = target_doc for update;
  if not found then raise exception using errcode='P0002', message='comment_thread_not_found'; end if;
  if access_role = 'viewer' and creator is distinct from auth.uid() then
    raise exception using errcode='42501', message='comment_status_denied';
  end if;
  update private.document_comment_threads t set status = next_status,
    resolved_by = case when next_status='resolved' then auth.uid() else null end,
    resolved_at = case when next_status='resolved' then now() else null end,
    revision = t.revision + 1
    where id = target_thread and status <> next_status returning revision into next_revision;
  if next_revision is not null then
    perform realtime.send(jsonb_build_object('id',target_thread,'revision',next_revision),
      'comment_changed','document-comments:'||target_doc::text,true);
  end if;
  return jsonb_build_object('id',target_thread,'status',next_status);
end;
$$;
revoke all on function public.set_document_comment_status(uuid,uuid,text,text) from public,anon;
grant execute on function public.set_document_comment_status(uuid,uuid,text,text) to authenticated;

-- A single transactional writer validates current eligibility before persisting IDs and names.
create function public.write_document_comment(target_doc uuid, body text, anchor jsonb default null,
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
  select m.id into message_id from private.document_comment_messages m
    where m.thread_id=(result->>'id')::uuid order by m.created_at desc,m.id desc limit 1;
  update private.document_comment_messages set mentions=mentioned where id=message_id;
  return result;
end;
$$;
revoke all on function public.write_document_comment(uuid,text,jsonb,uuid,uuid[],text) from public,anon;
grant execute on function public.write_document_comment(uuid,text,jsonb,uuid,uuid[],text) to authenticated;
notify pgrst, 'reload schema';
