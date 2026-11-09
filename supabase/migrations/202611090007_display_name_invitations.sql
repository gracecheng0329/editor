-- Names are labels only; membership remains keyed by the verified GitHub user's UUID.
create function private.github_display_name(metadata jsonb) returns text
language sql immutable set search_path = '' as $$
  select left(coalesce(
    nullif(btrim(metadata->>'full_name'), ''),
    nullif(btrim(metadata->>'name'), ''),
    nullif(btrim(metadata->>'user_name'), ''),
    nullif(btrim(metadata->>'preferred_username'), '')
  ), 80);
$$;
revoke all on function private.github_display_name(jsonb) from public, anon, authenticated;

create function public.invite_document_editor(target_id uuid, display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare matches uuid[];
begin
  -- Check ownership before resolving a name, so this is not a user directory.
  if not public.document_session_active() or not exists (
    select 1 from public.documents where id = target_id and owner_id = auth.uid()
  ) then raise no_data_found; end if;
  if display_name is null or length(btrim(display_name)) not between 1 and 80 then
    raise invalid_parameter_value;
  end if;
  select array_agg(u.id) into matches from auth.users u
  where private.github_display_name(u.raw_user_meta_data) = btrim(display_name)
    and exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'github');
  if coalesce(cardinality(matches), 0) <> 1 then raise invalid_parameter_value; end if;
  return public.set_document_editor(target_id, matches[1], true);
end;
$$;
revoke all on function public.invite_document_editor(uuid,text) from public, anon;
grant execute on function public.invite_document_editor(uuid,text) to authenticated;

create or replace function public.document_access_settings(target_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.document_session_active() or not exists (
    select 1 from public.documents where id = target_id and owner_id = auth.uid()
  ) then raise no_data_found; end if;
  return jsonb_build_object(
    'enabled', exists(select 1 from private.document_shares where document_id = target_id),
    'editors', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', e.user_id,
      'display_name', coalesce(private.github_display_name(u.raw_user_meta_data), 'GitHub 使用者')
    ) order by e.granted_at,e.user_id)
      from private.document_editors e join auth.users u on u.id = e.user_id
      where e.document_id = target_id), '[]'::jsonb)
  );
end;
$$;
