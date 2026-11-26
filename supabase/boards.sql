-- منارة — لوحات السبورة الذكية
-- نفّذ هذا الملف من: Supabase Dashboard > SQL Editor > New query
-- آمن لإعادة التنفيذ (idempotent).

create table if not exists public.boards (
  owner      text primary key,              -- 'teacher' أو معرّف الطالب
  strokes    jsonb not null default '[]'::jsonb,
  color      text not null default '#12292e',
  width      integer not null default 4 check (width between 2 and 28),
  tool       text not null default 'pen' check (tool in ('pen', 'erase')),
  grid       boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;

-- المعلّم يرى كل اللوحات، والطالب يرى لوحته فقط.
drop policy if exists "boards_select" on public.boards;
create policy "boards_select" on public.boards
  for select to authenticated
  using (public.is_teacher() or owner = public.my_student_id());

-- المعلّم يكتب لوحته الخاصة فقط، والطالب يكتب لوحته فقط.
drop policy if exists "boards_insert" on public.boards;
create policy "boards_insert" on public.boards
  for insert to authenticated
  with check (
    (public.is_teacher() and owner = 'teacher') or
    (not public.is_teacher() and owner = public.my_student_id())
  );

drop policy if exists "boards_update" on public.boards;
create policy "boards_update" on public.boards
  for update to authenticated
  using (
    (public.is_teacher() and owner = 'teacher') or
    (not public.is_teacher() and owner = public.my_student_id())
  )
  with check (
    (public.is_teacher() and owner = 'teacher') or
    (not public.is_teacher() and owner = public.my_student_id())
  );

revoke all on public.boards from anon;
grant select, insert, update on public.boards to authenticated;
