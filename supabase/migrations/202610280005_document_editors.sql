create table private.document_editors (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (document_id, user_id)
);
revoke all on private.document_editors from public, anon, authenticated;
create index document_editors_user on private.document_editors(user_id);

-- No recursive policies: this predicate can only answer whether the caller is
-- an editor, and never accepts a caller-supplied identity.
create function public.is_document_editor(target_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.document_session_active() and exists (
    select 1 from private.document_editors where document_id = target_id and user_id = auth.uid()
  );
$$;
revoke all on function public.is_document_editor(uuid) from public, anon;
grant execute on function public.is_document_editor(uuid) to authenticated;
alter policy documents_select on public.documents
  using ((select public.document_session_active()) and (
    owner_id = (select auth.uid()) or public.is_document_editor(id)
  ));

create function public.set_document_editor(target_id uuid, editor_id uuid, enable boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner uuid;
begin
  if not public.document_session_active() then raise no_data_found; end if;
  select owner_id into owner from public.documents where id = target_id and owner_id = auth.uid();
  if owner is null then raise no_data_found; end if;
  if enable then
    if editor_id = owner or not exists (
      select 1 from auth.identities where user_id = editor_id and provider = 'github'
    ) then raise invalid_parameter_value; end if;
    insert into private.document_editors(document_id,user_id) values (target_id,editor_id)
    on conflict do nothing;
  else
    delete from private.document_editors where document_id = target_id and user_id = editor_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_document_editor(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_document_editor(uuid,uuid,boolean) to authenticated;

create function public.document_access_settings(target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.document_session_active() or not exists (
    select 1 from public.documents where id = target_id and owner_id = auth.uid()
  ) then raise no_data_found; end if;
  return jsonb_build_object(
    'enabled', exists(select 1 from private.document_shares where document_id = target_id),
    'editors', coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id) order by granted_at,user_id)
      from private.document_editors where document_id = target_id), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.document_access_settings(uuid) from public, anon;
grant execute on function public.document_access_settings(uuid) to authenticated;
