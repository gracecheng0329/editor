-- The exposed database operation must own token generation too: an owner
-- calling PostgREST directly cannot substitute a predictable capability.
drop function public.set_document_share(uuid, text);
create function public.set_document_share(target_id uuid, enable boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare token text;
begin
  if not public.document_session_active() or not exists (
    select 1 from public.documents where id = target_id and owner_id = auth.uid()
  ) then raise no_data_found; end if;
  if enable is not true then
    delete from private.document_shares where document_id = target_id;
    return jsonb_build_object('enabled', false);
  end if;
  token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into private.document_shares(document_id, token_hash)
  values (target_id, sha256(convert_to(token, 'UTF8')))
  on conflict (document_id) do update set token_hash = excluded.token_hash, enabled_at = now();
  return jsonb_build_object('enabled', true, 'token', token);
end;
$$;
revoke all on function public.set_document_share(uuid,boolean) from public, anon;
grant execute on function public.set_document_share(uuid,boolean) to authenticated;
