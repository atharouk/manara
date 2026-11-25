-- منارة — مخطط Supabase
-- نفّذ هذا الملف من: Supabase Dashboard > SQL Editor > New query
-- آمن لإعادة التنفيذ (idempotent).

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
-- الموعد الحقيقي للتذكير؛ `due` يبقى نصاً حراً (مثلاً اسم يوم عربي متكرر)
alter table public.assignments add column if not exists due_date date;

-- أدوار المستخدمين: teacher أو student (مرتبط بسجل طالب)
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('teacher', 'student')),
  student_id text references public.students(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.user_roles add column if not exists email text;
create unique index if not exists user_roles_student_uidx
  on public.user_roles (student_id) where student_id is not null;

-- ---------- دوال مساعدة للسياسات (تتجاوز RLS لتجنّب التكرار) ----------
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.role = 'teacher'
  );
$$;

create or replace function public.my_student_id()
returns text language sql stable security definer set search_path = public as $$
  select r.student_id from public.user_roles r
  where r.user_id = auth.uid() and r.role = 'student'
  limit 1;
$$;

-- ---------- إدارة حسابات الطلاب (تنفّذ من الخادم، لا مفتاح سري في المتصفح) ----------
create or replace function public.create_student_account(
  p_student_id text, p_email text, p_password text
) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_uid uuid;
  v_email text;
begin
  -- عند التنفيذ من SQL Editor يكون auth.uid() فارغاً؛ من المتصفح يجب أن يكون معلّماً
  if auth.uid() is not null and not public.is_teacher() then
    raise exception 'غير مسموح بإنشاء حسابات';
  end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'الطالب غير موجود';
  end if;
  if exists (select 1 from public.user_roles where student_id = p_student_id) then
    raise exception 'هذا الطالب مرتبط بحساب بالفعل';
  end if;

  v_email := lower(trim(p_email));
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'البريد الإلكتروني غير صالح';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'هذا البريد مستخدم بالفعل';
  end if;

  v_uid := gen_random_uuid();

  -- الحقول النصية الفارغة ضرورية ليتمكن GoTrue من قراءة المستخدم لاحقاً
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token, email_change_token_new,
    email_change_token_current, reauthentication_token, phone_change_token,
    email_change, phone_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')), now(), now(), now(),
    jsonb_build_object('role', 'student', 'student_id', p_student_id),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '', '', '', '', '', '', '', ''
  );

  -- email في auth.identities عمود مُولَّد من identity_data في Supabase الحديث
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.user_roles (user_id, role, student_id, email)
  values (v_uid, 'student', p_student_id, v_email);

  return v_uid::text;
end;
$$;

create or replace function public.reset_student_password(
  p_student_id text, p_password text
) returns boolean
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_uid uuid;
begin
  if auth.uid() is not null and not public.is_teacher() then
    raise exception 'غير مسموح';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  end if;
  select user_id into v_uid from public.user_roles
    where student_id = p_student_id and role = 'student';
  if v_uid is null then
    raise exception 'لا يوجد حساب مرتبط بهذا الطالب';
  end if;
  update auth.users
    set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
    where id = v_uid;
  return true;
end;
$$;

create or replace function public.remove_student_account(p_student_id text)
returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid;
begin
  if auth.uid() is not null and not public.is_teacher() then
    raise exception 'غير مسموح';
  end if;
  select user_id into v_uid from public.user_roles
    where student_id = p_student_id and role = 'student';
  if v_uid is null then
    raise exception 'لا يوجد حساب مرتبط بهذا الطالب';
  end if;
  delete from auth.users where id = v_uid;  -- user_roles تُحذف تلقائياً (on delete cascade)
  return true;
end;
$$;

revoke all on function public.is_teacher() from public, anon;
revoke all on function public.my_student_id() from public, anon;
revoke all on function public.create_student_account(text, text, text) from public, anon;
revoke all on function public.reset_student_password(text, text) from public, anon;
revoke all on function public.remove_student_account(text) from public, anon;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.my_student_id() to authenticated;
grant execute on function public.create_student_account(text, text, text) to authenticated;
grant execute on function public.reset_student_password(text, text) to authenticated;
grant execute on function public.remove_student_account(text) to authenticated;

-- ---------- الأمان: سياسات RLS ----------
alter table public.students    enable row level security;
alter table public.completions enable row level security;
alter table public.assignments enable row level security;
alter table public.user_roles  enable row level security;

drop policy if exists "authenticated_full" on public.students;
drop policy if exists "authenticated_full" on public.completions;
drop policy if exists "authenticated_full" on public.assignments;
drop policy if exists "teacher_all" on public.students;
drop policy if exists "student_self" on public.students;
drop policy if exists "teacher_all" on public.completions;
drop policy if exists "student_self" on public.completions;
drop policy if exists "teacher_all" on public.assignments;
drop policy if exists "student_self" on public.assignments;
drop policy if exists "roles_read" on public.user_roles;

create policy "teacher_all" on public.students
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "student_self" on public.students
  for select to authenticated using (id = public.my_student_id());

create policy "teacher_all" on public.completions
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "student_self" on public.completions
  for all to authenticated
  using (student_id = public.my_student_id())
  with check (student_id = public.my_student_id());

create policy "teacher_all" on public.assignments
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "student_self" on public.assignments
  for select to authenticated
  using (target = 'all' or target = public.my_student_id());

create policy "roles_read" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_teacher());

revoke all on public.students    from anon;
revoke all on public.completions from anon;
revoke all on public.assignments from anon;
revoke all on public.user_roles  from anon;

grant select, insert, update, delete on public.students    to authenticated;
grant select, insert, update, delete on public.completions to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select on public.user_roles to authenticated;

-- الحساب التجريبي للمعلّم: يُمنح دور المعلّم تلقائياً
insert into public.user_roles (user_id, role, email)
select id, 'teacher', email from auth.users
where email = 'manara.teacher@example.com'
on conflict (user_id) do update set role = 'teacher';

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

insert into public.assignments (lesson_id, target, due, due_date) values
  ('s-hira', 'all', 'الخميس', current_date + ((4 - extract(isodow from current_date)::int + 7) % 7)),
  ('t-noon-tanween', 's1', 'السبت', current_date + ((6 - extract(isodow from current_date)::int + 7) % 7))
on conflict (lesson_id, target) do nothing;

-- إذا كانت المهام التجريبية موجودة من قبل بلا تاريخ، نحسب أقرب موعد للاسم العربي
update public.assignments
set due_date = case due
    when 'الخميس' then current_date + ((4 - extract(isodow from current_date)::int + 7) % 7)
    when 'السبت'  then current_date + ((6 - extract(isodow from current_date)::int + 7) % 7)
  end
where due_date is null and due in ('الخميس', 'السبت');

-- ---------- تلاوات الطلاب: تسجيل صوتي + مراجعة المعلّم ----------
create table if not exists public.recitations (
  id           bigint generated always as identity primary key,
  student_id   text not null references public.students(id) on delete cascade,
  surah        integer not null check (surah between 1 and 114),
  ayah         integer not null check (ayah > 0),
  storage_path text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'review')),
  teacher_note text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
alter table public.recitations enable row level security;

drop policy if exists "teacher_all" on public.recitations;
drop policy if exists "student_read" on public.recitations;
drop policy if exists "student_insert" on public.recitations;

create policy "teacher_all" on public.recitations
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "student_read" on public.recitations
  for select to authenticated using (student_id = public.my_student_id());
create policy "student_insert" on public.recitations
  for insert to authenticated
  with check (student_id = public.my_student_id() and status = 'pending');

revoke all on public.recitations from anon;
grant select, insert, update, delete on public.recitations to authenticated;

-- مسار الملفات: {student_id}/{surah}-{ayah}-{timestamp}.webm
insert into storage.buckets (id, name, public)
values ('recitations', 'recitations', false)
on conflict (id) do update set public = false;

drop policy if exists "recitations_teacher_read" on storage.objects;
drop policy if exists "recitations_student_read" on storage.objects;
drop policy if exists "recitations_student_insert" on storage.objects;
drop policy if exists "recitations_student_delete" on storage.objects;

create policy "recitations_teacher_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'recitations' and public.is_teacher());
create policy "recitations_student_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'recitations' and split_part(name, '/', 1) = public.my_student_id());
create policy "recitations_student_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recitations' and split_part(name, '/', 1) = public.my_student_id());
-- ملف التلاوة يُحذف فقط إن لم تُعتمد بعد (بانتظار المراجعة أو تحتاج إعادة) أو أصبح يتيماً
create or replace function public.can_delete_recitation(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_path, '/', 1) = public.my_student_id()
    and (
      not exists (select 1 from public.recitations r where r.storage_path = p_path)
      or exists (select 1 from public.recitations r where r.storage_path = p_path and r.status in ('pending', 'review'))
    );
$$;
revoke all on function public.can_delete_recitation(text) from public, anon;
grant execute on function public.can_delete_recitation(text) to authenticated;

create policy "recitations_student_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recitations' and public.can_delete_recitation(name));

-- ---------- اعتماد التلاوة يمنح إنجاز الدرس المرتبط تلقائياً ----------
alter table public.recitations add column if not exists lesson_id text;

create or replace function public.recitation_approved_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- إذا كانت مقبولة سابقاً فالإنجاز مُمنوح بالفعل
  if tg_op = 'UPDATE' then
    if old.status = 'approved' then
      return new;
    end if;
  end if;
  if new.status = 'approved' and new.lesson_id is not null then
    insert into public.completions (student_id, lesson_id)
    values (new.student_id, new.lesson_id)
    on conflict (student_id, lesson_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists recitations_approved_completion on public.recitations;
create trigger recitations_approved_completion
  after insert or update of status on public.recitations
  for each row execute function public.recitation_approved_completion();

-- ---------- تسجيل السورة كاملة إلى جانب تسجيل الآية ----------
-- scope = 'ayah' (افتراضي) أو 'surah'؛ في الحالة الثانية يُخزَّن ayah = 1 ويُعرض «السورة كاملة»
alter table public.recitations add column if not exists scope text not null default 'ayah'
  check (scope in ('ayah', 'surah'));

-- ---------- حذف الطالب لتلاوته قبل اعتماد المعلّم ----------
drop policy if exists "student_delete_pending" on public.recitations;
create policy "student_delete_pending" on public.recitations
  for delete to authenticated
  using (student_id = public.my_student_id() and status in ('pending', 'review'));
