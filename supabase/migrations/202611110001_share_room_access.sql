create or replace function public.resolve_document_share_room(share_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'room_id', d.room_id)
  from private.document_shares s join public.documents d on d.id = s.document_id
  where share_token ~ '^[A-Za-z0-9_-]{43}$'
    and s.token_hash = sha256(convert_to(share_token, 'UTF8'));
$$;
revoke all on function public.resolve_document_share_room(text) from public;
grant execute on function public.resolve_document_share_room(text) to anon, authenticated;
