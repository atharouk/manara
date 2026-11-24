-- منارة — مخطط Supabase
-- نفّذ هذا الملف مرة واحدة من: Supabase Dashboard > SQL Editor > New query

create extension if not exists pgcrypto;

-- الطلاب
create table if not exists public.students (
  id    text primary key,
  name  text not null,
  level text not null check (level in ('مبتدئ', 'متوسط', 'متقدم')),
  created_at timestamptz not null default now()
);

-- الدروس المُنجزة لكل طالب
create table if not exists public.completions (
  student_id text not null references public.students(id) on delete cascade,
  lesson_id  text not null,
  created_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

-- المهام المسندة؛ target إما 'all' أو معرّف طالب
create table if not exists public.assignments (
  id         bigint generated always as identity primary key,
  lesson_id  text not null,
  target     text not null,
  due        text,
  created_at timestamptz not null default now(),
  unique (lesson_id, target)
);

-- الأمان: السماح للمستخدمين المسجّلين فقط (المعلّم)، ومنع الوصول المجهول
alter table public.students    enable row level security;
alter table public.completions enable row level security;
alter table public.assignments enable row level security;

drop policy if exists "authenticated_full" on public.students;
drop policy if exists "authenticated_full" on public.completions;
drop policy if exists "authenticated_full" on public.assignments;

create policy "authenticated_full" on public.students
  for all to authenticated using (true) with check (true);
create policy "authenticated_full" on public.completions
  for all to authenticated using (true) with check (true);
create policy "authenticated_full" on public.assignments
  for all to authenticated using (true) with check (true);

revoke all on public.students    from anon;
revoke all on public.completions from anon;
revoke all on public.assignments from anon;

grant select, insert, update, delete on public.students    to authenticated;
grant select, insert, update, delete on public.completions to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

-- بيانات تجريبية اختيارية (يمكن حذف هذا القسم في الإنتاج)
insert into public.students (id, name, level) values
  ('s1', 'أحمد', 'مبتدئ'),
  ('s2', 'مريم', 'متوسط'),
  ('s3', 'سلمى', 'مبتدئ'),
  ('s4', 'زياد', 'متقدم'),
  ('s5', 'ريم', 'مبتدئ'),
  ('s6', 'هدى', 'مبتدئ')
on conflict (id) do nothing;

insert into public.completions (student_id, lesson_id) values
  ('s1', 't-intro'), ('s1', 'a-salam'), ('s1', 'l-0'),
  ('s2', 't-ghunna'), ('s2', 's-hira'),
  ('s3', 'a-food'),
  ('s4', 't-madd-lazim'),
  ('s6', 'l-1'), ('s6', 'l-2')
on conflict (student_id, lesson_id) do nothing;

insert into public.assignments (lesson_id, target, due) values
  ('s-hira', 'all', 'الخميس'),
  ('t-noon-tanween', 's1', 'السبت')
on conflict (lesson_id, target) do nothing;
