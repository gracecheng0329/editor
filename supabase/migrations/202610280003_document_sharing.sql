create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.document_shares (
  document_id uuid primary key references public.documents(id) on delete cascade,
  token_hash bytea not null unique,
  enabled_at timestamptz not null default now()
);
revoke all on private.document_shares from public, anon, authenticated;

create function public.set_document_share(target_id uuid, share_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.document_session_active() or not exists (
    select 1 from public.documents where id = target_id and owner_id = auth.uid()
  ) then raise no_data_found; end if;
  if share_token is null then
    delete from private.document_shares where document_id = target_id;
    return jsonb_build_object('enabled', false);
  end if;
  if share_token !~ '^[A-Za-z0-9_-]{43}$' then raise invalid_parameter_value; end if;
  insert into private.document_shares(document_id, token_hash)
  values (target_id, sha256(convert_to(share_token, 'UTF8')))
  on conflict (document_id) do update set token_hash = excluded.token_hash, enabled_at = now();
  return jsonb_build_object('enabled', true);
end;
$$;
revoke all on function public.set_document_share(uuid,text) from public, anon;
grant execute on function public.set_document_share(uuid,text) to authenticated;

create function public.resolve_document_share(share_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'title', d.title, 'role', 'viewer')
  from private.document_shares s join public.documents d on d.id = s.document_id
  where length(share_token) = 43 and s.token_hash = sha256(convert_to(share_token, 'UTF8'));
$$;
revoke all on function public.resolve_document_share(text) from public;
grant execute on function public.resolve_document_share(text) to anon, authenticated;
