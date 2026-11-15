drop index if exists public.conversation_notes_timeline_idx;

create index conversation_notes_company_timeline_idx
  on public.conversation_notes (company_id, conversation_id, created_at, id);
