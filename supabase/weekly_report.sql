-- منارة — التقرير الأسبوعي بالبريد
-- نفّذ هذا الملف من SQL Editor في Supabase بعد نشر دالة weekly-report.
-- الأسرار المطلوبة (Supabase → Edge Functions → Secrets):
--   RESEND_API_KEY, REPORT_FROM_EMAIL, REPORT_TEST_EMAIL (اختياري), REPORT_APP_URL (اختياري)
--   REPORT_CRON_SECRET (يُطابق القيمة المخزّنة في weekly_report_config أدناه)

-- 1) الإضافات اللازمة للتجدولة واستدعاء الدالة
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 2) سجل لمنع إرسال التقرير نفسه أكثر من مرة في الأسبوع
create table if not exists public.weekly_report_logs (
  week_key  date not null,
  recipient text not null,
  sent_at   timestamptz not null default now(),
  primary key (week_key, recipient)
);
alter table public.weekly_report_logs enable row level security;
-- لا توجد سياسات للمستخدمين العاديين: الدالة وحدها (service_role) تكتب وتقرأ السجل.

-- 3) سرّ الاستدعاء: ضع هنا نفس القيمة الموجودة في Supabase Secrets باسم REPORT_CRON_SECRET
create table if not exists public.weekly_report_config (
  name   text primary key,
  secret text not null
);
alter table public.weekly_report_config enable row level security;
insert into public.weekly_report_config(name, secret)
values ('cron', '<REPORT_CRON_SECRET>')
on conflict (name) do nothing;
-- لا تترك القيمة أعلاه كما هي؛ استبدلها بالقيمة التي أضفتها في Secrets.

-- 4) جدولة كل جمعة 15:00 UTC = 18:00 بتوقيت الرياض
select cron.unschedule(jobid) from cron.job where jobname = 'manara-weekly-report';
select cron.schedule(
  'manara-weekly-report',
  '0 15 * * 5',
  $$
  select net.http_post(
    url := 'https://syvsimvfftznetlzdnkz.supabase.co/functions/v1/weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_a-UApE3lnyX7-XwTAumb9Q_bqooocrL',
      'x-manara-cron', coalesce((select secret from public.weekly_report_config where name = 'cron'), '')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- للتحقق من الجدولة:
-- select jobid, schedule, command from cron.job where jobname = 'manara-weekly-report';
-- لإرسال نسخة تجريبية فورية (إلى REPORT_TEST_EMAIL أو بريد المعلّم):
-- curl -X POST 'https://syvsimvfftznetlzdnkz.supabase.co/functions/v1/weekly-report' \
--   -H "apikey: sb_publishable_a-UApE3lnyX7-XwTAumb9Q_bqooocrL" \
--   -H "x-manara-cron: <REPORT_CRON_SECRET>" \
--   -H 'Content-Type: application/json' -d '{"test":true}'
