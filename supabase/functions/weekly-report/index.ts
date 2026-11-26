// تقرير منارة الأسبوعي — يُرسل عبر Resend من Supabase Edge Function.
// الأسرار تُقرأ من Supabase Secrets ولا تُخزَّن في المستودع:
//   RESEND_API_KEY   مفتاح Resend
//   REPORT_FROM_EMAIL المرسل المُتحقَّق منه في Resend
//   REPORT_TEST_EMAIL (اختياري) بريد تجريبي لاستقبال نسخة الاختبار
//   REPORT_APP_URL    (اختياري) رابط التطبيق، الافتراضي manara-atharok1.vercel.app
//   REPORT_CRON_SECRET سرّ يمنع استدعاء الدالة من غير المجدول (أرسل في header: x-manara-cron)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4';

const LESSON_TITLES: Record<string, string> = {
  'a-elders':'احترام الكبير ورحمة الصغير','a-food':'آداب الطعام والشراب','a-istidhan':'الاستئذان',
  'a-masjid':'آداب المسجد ومجلس العلم','a-parents':'برّ الوالدين','a-salam':'السلام والتحية',
  'a-shukr':'الشكر والحمد','a-truth':'الصدق','g-adab':'لعبة: تصرّف حسن أم لا؟',
  'g-taj':'لعبة: حكم التجويد','g-verse':'لعبة: أكمل الآية','l-0':'حروف: ا','l-1':'حروف: ب ت ث ن ي',
  'l-10':'حروف: ك','l-11':'حروف: ل','l-12':'حروف: م','l-13':'حروف: ه','l-14':'حروف: و',
  'l-2':'حروف: ج ح خ','l-3':'حروف: د ذ','l-4':'حروف: ر ز','l-5':'حروف: س ش','l-6':'حروف: ص ض',
  'l-7':'حروف: ط ظ','l-8':'حروف: ع غ','l-9':'حروف: ف ق','s-hijra-cave':'إن الله معنا',
  's-hira':'أول كلمات من السماء','s-masjid':'بناء المسجد النبوي',
  's-muakhat':'الأخوّة بين المهاجرين والأنصار','s-rahma':'رحمة النبي ﷺ',
  's-sadiq-amin':'الصادق الأمين','t-awad-silah-sughra':'العوض عن التنوين والصلة الصغرى',
  't-ghunna':'الغنّة','t-idgham':'الإدغام','t-idgham-mutajanisayn':'إدغام المتجانسين',
  't-idgham-mutamathilayn':'إدغام المتماثلين','t-idgham-mutaqaribayn':'إدغام المتقاربين',
  't-idhhar':'الإظهار الحلقي','t-ikhfa':'الإخفاء الحقيقي','t-intro':'ما هو التجويد؟',
  't-iqlab':'الإقلاب','t-istiadha-basmala':'الاستعاذة والبسملة',
  't-istiadha-basmala-combos':'الجمع بين الاستعاذة والبسملة وأول السورة',
  't-lam-jalala':'لام لفظ الجلالة','t-madd-arid-leen':'المدّ العارض للسكون ومدّ اللين',
  't-madd-badal':'مدّ البدل','t-madd-lazim':'المدّ اللازم','t-madd-munfasil':'المدّ الجائز المنفصل',
  't-madd-muttasil':'المدّ الواجب المتصل','t-madd-summary':'ملخص مراتب المدود',
  't-madd-tabii':'المدّ الطبيعي','t-meem-sakina':'أحكام الميم الساكنة',
  't-noon-tanween':'النون الساكنة والتنوين','t-qalqala':'القلقلة','t-ra-rules':'أحكام الراء',
  't-saktat':'السكتات','t-silah-kubra':'الصلة الكبرى'
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
const num = (n: number) => new Intl.NumberFormat('ar-EG').format(n);
const day = (s: string) => new Date(s).toLocaleDateString('ar-EG', {timeZone: 'Asia/Riyadh'});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json; charset=utf-8'}
});

type Student = {id:string; name:string; level:string};
type Rec = {id:number; student_id:string; surah:number; ayah:number; scope:string;
  status:string; teacher_note:string|null; lesson_id:string|null;
  created_at:string; reviewed_at:string|null};

function redoOutstanding(recs: Rec[], studentId?: string) {
  return recs.filter(r => r.status === 'review' && (!studentId || r.student_id === studentId) && !recs.some(x =>
    x.student_id === r.student_id && x.id !== r.id &&
    new Date(x.created_at).getTime() > new Date(r.reviewed_at || r.created_at).getTime() &&
    ((x.scope === r.scope && x.surah === r.surah && (r.scope === 'surah' || x.ayah === r.ayah)) ||
     (r.scope === 'ayah' && x.scope === 'surah' && x.surah === r.surah))
  ));
}

function shell(title: string, body: string, appUrl: string) {
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#eaf1f0;padding:18px;color:#12292e">
    <div style="max-width:680px;margin:auto;background:#fff;border-radius:16px;padding:22px">
      <h1 style="color:#0e3b43;margin:0 0 4px">🕌 منارة — ${esc(title)}</h1>
      <div style="color:#5b7378;font-size:13px;margin-bottom:16px">${day(new Date().toISOString())} · تقرير أسبوعي</div>
      ${body}
      <hr style="border:0;border-top:1px solid #d3e0de;margin:20px 0">
      <div style="font-size:12px;color:#5b7378">أُنشئ تلقائياً من بيانات منارة · <a href="${esc(appUrl)}" style="color:#1c8a86">افتح التطبيق</a></div>
    </div></div>`;
}
const card = (rows: string) => `<div style="background:#f4f8f7;border-radius:12px;padding:12px;margin:10px 0">${rows}</div>`;
const stat = (n: number, label: string) => `<div style="display:inline-block;min-width:110px;margin:4px 12px 4px 0"><b style="font-size:22px;color:#1c8a86">${num(n)}</b><div style="font-size:12px;color:#5b7378">${esc(label)}</div></div>`;
const list = (items: string[]) => items.length
  ? `<ul style="margin:6px 0;padding-inline-start:20px">${items.map(x => `<li>${x}</li>`).join('')}</ul>`
  : '<div style="color:#5b7378">لا شيء هذا الأسبوع.</div>';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({error:'method_not_allowed'}, 405);
  try {
    const payload = await req.json().catch(() => ({}));
    const test = payload?.test === true;
    const cronSecret = Deno.env.get('REPORT_CRON_SECRET');
    if (cronSecret && (req.headers.get('x-manara-cron') || '') !== cronSecret)
      return json({error:'unauthorized'}, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({error:'RESEND_API_KEY missing'}, 500);
    const from = Deno.env.get('REPORT_FROM_EMAIL') || 'onboarding@resend.dev';
    const appUrl = Deno.env.get('REPORT_APP_URL') || 'https://manara-atharok1.vercel.app';
    // Resend يسمح بالإرسال من onboarding@resend.dev إلى بريد الحساب فقط.
    // إلى أن يُضاف دومين مُتحقَّق، نُرسل للمعلّم ونتخطى رسائل الطلاب بدل إهدار المحاولات.
    const sharedDomain = /@(?:onboarding|[a-z0-9-]+)\.resend\.dev$/i.test(from);
    const resend = new Resend(apiKey);

    const now = new Date();
    const since = new Date(now.getTime() - 7 * 86400000).toISOString();
    const weekKey = now.toISOString().slice(0, 10);

    const [sr, cr, rr, ur, ar] = await Promise.all([
      supabase.from('students').select('id,name,level'),
      supabase.from('completions').select('student_id,lesson_id,created_at'),
      supabase.from('recitations').select('id,student_id,surah,ayah,scope,status,teacher_note,lesson_id,created_at,reviewed_at'),
      supabase.from('user_roles').select('role,student_id,email'),
      supabase.from('assignments').select('id,lesson_id,target,due_date,created_at').gte('created_at', since)
    ]);
    const fail = [sr, cr, rr, ur, ar].find(r => r.error);
    if (fail) return json({error: fail.error?.message}, 500);

    const students = (sr.data || []) as Student[];
    const completions = cr.data || [];
    const recs = (rr.data || []) as Rec[];
    const roles = ur.data || [];
    const assigns = ar.data || [];
    const redos = redoOutstanding(recs);
    const newDone = completions.filter(c => c.created_at >= since);
    const newApproved = recs.filter(r => r.status === 'approved' && r.created_at >= since);
    const pending = recs.filter(r => r.status === 'pending');

    const targetsFor = (s: Student) => assigns.filter(a =>
      a.target === 'all' || a.target === s.id ||
      (Array.isArray(a.target) && a.target.includes(s.id)) ||
      (typeof a.target === 'string' && a.target.includes(s.id))).length;

    const rowsFor = (s: Student) => {
      const mine = completions.filter(c => c.student_id === s.id);
      const mineNew = newDone.filter(c => c.student_id === s.id);
      const mineRec = recs.filter(r => r.student_id === s.id);
      return {s, total: mine.length, added: mineNew.length,
        titles: mineNew.map(c => esc(LESSON_TITLES[c.lesson_id] || c.lesson_id)),
        approved: mineRec.filter(r => r.status === 'approved').length,
        waiting: pending.filter(r => r.student_id === s.id).length,
        redo: redos.filter(r => r.student_id === s.id).length,
        tasks: targetsFor(s)};
    };
    const rows = students.map(rowsFor);

    const sent: string[] = [], skipped: string[] = [], failed: string[] = [];
    const deliver = async (to: string, subject: string, html: string, log: boolean) => {
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { skipped.push(to || '(empty)'); return; }
      if (log) {
        const {data: prior} = await supabase.from('weekly_report_logs')
          .select('week_key').eq('week_key', weekKey).eq('recipient', to).maybeSingle();
        if (prior) { skipped.push(to); return; }
      }
      const {error: e} = await resend.emails.send({from, to: [to], subject, html});
      if (e) { failed.push(`${to}: ${e.message}`); return; }
      if (log) await supabase.from('weekly_report_logs').insert({week_key: weekKey, recipient: to});
      sent.push(to);
    };

    if (test) {
      const to = Deno.env.get('REPORT_TEST_EMAIL') || roles.find(r => r.role === 'teacher')?.email || '';
      const body = card(stat(students.length, 'طالب') + stat(newDone.length, 'درس جديد') +
        stat(newApproved.length, 'تلاوة مقبولة') + stat(redos.length, 'إعادة مطلوبة')) +
        '<h3>توزيع الطلاب</h3>' + list(rows.map(r =>
          `${esc(r.s.name)} — ${num(r.total)} درس، ${num(r.added)} جديد، ${num(r.redo)} إعادة`));
      await deliver(to, 'منارة — تقرير أسبوعي تجريبي', shell('تقرير تجريبي', body, appUrl), false);
      return json({mode:'test', sent, skipped, failed});
    }

    const teacherEmails = [...new Set(roles.filter(r => r.role === 'teacher').map(r => r.email).filter(Boolean))] as string[];
    const teacherBody = card(stat(students.length, 'طالب') + stat(newDone.length, 'درس منجز هذا الأسبوع') +
      stat(newApproved.length, 'تلاوة مقبولة') + stat(pending.length, 'بانتظار المراجعة') +
      stat(redos.length, 'إعادة مطلوبة') + stat(assigns.length, 'مهمة جديدة')) +
      `<table dir="rtl" style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#0e3b43;color:#fff"><th style="padding:6px">الطالب</th><th>المستوى</th><th>الإجمالي</th><th>جديد</th><th>تلاوات مقبولة</th><th>إعادة</th></tr>
        ${rows.map(r => `<tr style="border-bottom:1px solid #d3e0de"><td style="padding:6px">${esc(r.s.name)}</td><td>${esc(r.s.level)}</td><td>${num(r.total)}</td><td>${num(r.added)}</td><td>${num(r.approved)}</td><td>${num(r.redo)}</td></tr>`).join('')}
      </table>
      <h3>أحدث الإنجازات هذا الأسبوع</h3>` + list(rows.flatMap(r => r.titles.map(t => `${esc(r.s.name)}: ${t}`)));
    for (const to of teacherEmails)
      await deliver(to, `منارة — التقرير الأسبوعي ${weekKey}`, teacherBody, true);

    if (sharedDomain) {
      skipped.push('رسائل الطلاب (يحتاج دوميناً مُتحقَّقاً في Resend)');
    } else {
      for (const r of rows) {
        const email = roles.find(x => x.student_id === r.s.id)?.email;
        if (!email) { skipped.push(`${r.s.name} (بلا بريد)`); continue; }
        const body = `<div>أهلاً ${esc(r.s.name)}،</div>` + card(
          stat(r.total, 'درس منجز') + stat(r.added, 'درس جديد هذا الأسبوع') +
          stat(r.approved, 'تلاوة مقبولة') + stat(r.waiting, 'بانتظار المراجعة') +
          stat(r.redo, 'تلاوة تحتاج إعادة')) +
          `<h3>ما أُنجز هذا الأسبوع</h3>` + list(r.titles) +
          `<h3>تلاوات تحتاج إعادة</h3>` + list(redos.filter(x => x.student_id === r.s.id).map(x =>
            `${esc(LESSON_TITLES[x.lesson_id] || `سورة ${num(x.surah)} آية ${num(x.ayah)}`)}${x.teacher_note ? ` — ${esc(x.teacher_note)}` : ''}`));
        await deliver(email, `منارة — تقدّمك الأسبوعي ${weekKey}`, shell('تقدّمك الأسبوعي', body, appUrl), true);
      }
    }
    return json({mode:'weekly', weekKey, sent, skipped, failed});
  } catch (err) {
    return json({error: String(err)}, 500);
  }
});
