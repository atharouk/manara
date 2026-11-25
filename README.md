# منارة — نسخة سحابية (Supabase + Vercel)

نسخة مطوّرة من النموذج الأولي: تسجيل دخول للمعلّم، حفظ تقدّم الطلاب والمهام في Supabase، ونشر ثابت على Vercel عبر GitHub.

> **الرابط المباشر:** https://manara-atharok1.vercel.app
>
> **المستودع:** https://github.com/atharouk/manara
>
> **حساب المعلّم التجريبي:** `manara.teacher@example.com` — كلمة المرور: `Manara@2026`

## البنية

| الملف | الوظيفة |
|---|---|
| `index.html` | الواجهة (من النموذج الأصلي) + شاشة الدخول |
| `data.js` | محتوى الدروس والمصحف (مستخرج من السطر 73 الأصلي) |
| `app.js` | المنطق + طبقة Supabase |
| `config.js` | رابط المشروع والمفتاح العام `anon` |
| `supabase/schema.sql` | الجداول وسياسات الأمان والبيانات التجريبية |

## 1) إعداد Supabase

1. أنشئ مشروعاً جديداً في https://supabase.com/dashboard.
2. افتح **SQL Editor** وشغّل محتوى `supabase/schema.sql`.
3. من **Project Settings > API** انسخ:
   - `Project URL`
   - `anon public` key
4. ضعهما في `config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
5. من **Authentication > Providers** تأكد أن `Email` مفعّل. أنشئ مستخدم معلّم من **Authentication > Users > Add user** (أو من شاشة «إنشاء حساب» في التطبيق).

> ⚠️ لا تضع `service_role` key في المتصفح أبداً. المفتاح `anon` عام بطبيعته، والحماية تتم عبر سياسات RLS في `schema.sql`.
>
> ملاحظة: في هذه النسخة أي مستخدم مسجّل يُعامل كمعلم. للإنتاج، عطّل التسجيل الحر من **Authentication > Providers > Email > Allow new users to sign up** وأنشئ المستخدمين يدوياً، أو أضف جدول قائمة سماح بالبريد الإلكتروني.

## 2) التشغيل محلياً

بسبب استخدام ES Modules، افتح التطبيق عبر خادم محلي وليس `file://`:

```powershell
python -m http.server 8000
```

ثم افتح `http://localhost:8000`.

## 3) GitHub + Vercel (تم)

تم إنشاء المستودع وربطه بـ Vercel. كل `git push` على فرع `main` يعيد النشر تلقائياً.

```powershell
git add .
git commit -m "وصف التغيير"
git push origin main
```

إعدادات Vercel الحالية:
- Framework Preset: **Other** (موقع ثابت، بلا خطوة بناء).
- لا متغيرات بيئة؛ الإعداد في `config.js`.
- Production URL: `manara-atharok1.vercel.app`.

## 4) ما الذي تحوّل إلى سحابي؟

- `students` ← جدول `students`
- `done` ← جدول `completions`
- `assigns` ← جدول `assignments`
- ترقية الطالب ← تحديث `students.level`
- فتح الدرس/الاختبار ← إدراج في `completions`
- إسناد مهمة ← إدراج في `assignments`
- الحالة `mode` / `sid` / `view` تبقى محلية (واجهة فقط)

## 5) التطوير المنفّذ

- ✅ إضافة/تعديل/حذف الطلاب من الواجهة (مع الحفظ الفوري في Supabase).
- ✅ حذف المهام المسندة من الواجهة.
- ✅ صفحة «التقارير»: إنجاز عام، إنجاز لكل مادة، وتقدّم كل طالب مادةً بمادة.
- ✅ إضافة أسباب توضيحية لجميع أسئلة السيرة الـ18.
- ✅ التقدّم لكل مادة يظهر بجانب التقدّم العام في التقارير.

## 6) أفكار للتطوير القادم

- حساب مستقل لكل طالب مع سياسات RLS تقيّده ببياناته.
- ربط التلاوة الصوتية بعد التحقق من الروابط.
- تصدير التقارير إلى CSV أو PDF.
- لوحة إشعارات للمهام القريبة الاستحقاق.
