-- Invitations use the stable UUID again; names remain presentation only.
drop function if exists public.invite_document_editor(uuid, text);
