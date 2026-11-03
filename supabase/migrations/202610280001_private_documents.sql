create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null check (length(btrim(title)) > 0),
  room_id uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public.touch_document_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents for each row execute function public.touch_document_updated_at();
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant select on public.documents to authenticated;
grant insert (owner_id, title) on public.documents to authenticated;
grant update (title) on public.documents to authenticated;
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
