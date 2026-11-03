-- Access JWTs outlive logout. Verify the JWT's own live Auth session at the
-- database boundary as well, so direct REST cannot replay a revoked session.
create function public.document_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions
    where id::text = (select auth.jwt() ->> 'session_id')
      and user_id = (select auth.uid())
      and (not_after is null or not_after > now())
  );
$$;
revoke all on function public.document_session_active() from public, anon;
grant execute on function public.document_session_active() to authenticated;

alter policy documents_select on public.documents
  using (owner_id = (select auth.uid()) and (select public.document_session_active()));
alter policy documents_insert on public.documents
  with check (owner_id = (select auth.uid()) and (select public.document_session_active()));
alter policy documents_update on public.documents
  using (owner_id = (select auth.uid()) and (select public.document_session_active()))
  with check (owner_id = (select auth.uid()) and (select public.document_session_active()));
