import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { D } from './data.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured = SUPABASE_URL.includes('supabase.co') && !SUPABASE_ANON_KEY.startsWith('YOUR_');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const IT = Object.fromEntries(D.items.map(i => [i.id, i])),
      SECS = D.secs,
      LV = ['مبتدئ', 'متوسط', 'متقدم'];

// ربط الآيات بأمثلة الدروس الموجودة في البيانات (سورة التين، آية 5 → ت-ghunna)
const ARDIG = '٠١٢٣٤٥٦٧٨٩';
const west = s => String(s).replace(/[٠-٩]/g, d => ARDIG.indexOf(d));
const SURAH = new Map(D.q.map((x, i) => [x.name, i + 1]));
const AYAH_LESSONS = (() => {
  const m = new Map();
  const add = (loc, id) => {
    const t = west(loc || '').match(/سورة\s+(.+?)\s*،\s*آية\s+(\d+)/);
    if (!t || !IT[id]) return;
    const sn = SURAH.get(t[1].trim()), ay = +t[2];
    if (!sn || !ay) return;
    const k = sn + ':' + ay;
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k).includes(id)) m.get(k).push(id);
  };
  D.items.forEach(i => {
    (i.ex || []).forEach(e => add(e.loc, i.id));
    (i.qr || []).forEach(q => add(q.loc, i.id));
    const g = i.g && D.games[i.g];
    if (g) g.forEach(x => add(x.loc, i.id));
  });
  return m;
})();
const lessonsFor = (surah, ayah) => AYAH_LESSONS.get(surah + ':' + ayah) || [];
// عكس الخريطة: من الدرس إلى الآيات التي يمكن تسجيل تلاوة لها
const LESSON_AYAHS = (() => {
  const m = new Map();
  for (const [key, ids] of AYAH_LESSONS) {
    const [surah, ayah] = key.split(':').map(Number);
    ids.forEach(id => {
      if (!m.has(id)) m.set(id, []);
      if (!m.get(id).some(x => x.surah === surah && x.ayah === ayah)) m.get(id).push({surah, ayah});
    });
  }
  return m;
})();
const $ = s => document.querySelector(s),
      app = $('#app'),
      N = n => (+n).toLocaleString('ar-EG');
const E = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const sh = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- مواعيد المهام وإشعارات الاستحقاق ---------- */
const DAY_MS = 86400000;
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAY_NUM = Object.fromEntries(DAYS.map((n, i) => [n, i]));
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function dueDateOf(a) {
  const saved = parseDay(a.date);
  if (saved) return saved;
  const text = String(a.due || '').trim();
  if (Object.prototype.hasOwnProperty.call(DAY_NUM, text)) {
    const now = new Date();
    return addDays(now, (DAY_NUM[text] - now.getDay() + 7) % 7);
  }
  if (text === 'اليوم') return new Date();
  if (text === 'غداً' || text === 'غدا') return addDays(new Date(), 1);
  return null;
}
function dueInfo(a) {
  const dt = dueDateOf(a);
  if (!dt) return {label: E(a.due || 'بلا موعد'), short: E(a.due || 'بلا موعد'), days: null, level: 'none'};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((dt - today) / DAY_MS);
  const short = days < 0 ? `متأخرة ${N(-days)} يوم` : days === 0 ? 'اليوم' : days === 1 ? 'غداً' : `بعد ${N(days)} أيام`;
  const level = days < 0 ? 'late' : days <= 3 ? 'soon' : 'none';
  return {label: dt.toLocaleDateString('ar-EG', {weekday: 'long', day: 'numeric', month: 'long'}), short, days, level};
}
const dueTag = a => {
  const i = dueInfo(a);
  return i.level === 'none' ? '' : `<span class="tag ${i.level === 'late' ? 'late' : 'w'}">${E(i.short)}</span>`;
};
function nearTasks(forStudent = null) {
  return assigns.filter(a => {
    const people = tgt(a);
    if (forStudent && !people.some(s => s.id === forStudent)) return false;
    if (!people.some(s => !done[s.id].has(a.id))) return false;
    const info = dueInfo(a);
    return info.days !== null && info.days <= 3;
  }).sort((a, b) => (dueInfo(a).days ?? 99) - (dueInfo(b).days ?? 99));
}
function notifyPanel(list, mode = 'plain') {
  if (!list.length) return '';
  const rows = list.map(a => {
    const info = dueInfo(a), left = tgt(a).filter(s => !done[s.id].has(a.id)).length;
    const action = mode === 'student'
      ? `<button class="btn alt mini" data-o="${a.id}">ابدأ</button>`
      : mode === 'teacher' && a === list[0]
        ? `<button class="btn alt mini" id="gn">عرض المهام</button>` : '';
    return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="grow"><b>${E(IT[a.id].t)}</b><div class="m">${E(info.label)} · ${N(left)} متبقٍ</div></div>${dueTag(a)}${action}</div>`;
  }).join('');
  return `<div class="card notif"><div class="row"><b>🔔 مهام قريبة الاستحقاق</b><span class="grow"></span><span class="tag w">${N(list.length)}</span></div>${rows}</div>`;
}

/* ---------- متأخرات تسليم التلاوات ---------- */
function recCovers(r, lessonId) {
  if (!r) return false;
  return r.lesson_id === lessonId || (r.quiz_lessons || []).includes(lessonId) || recLessons(r).includes(lessonId);
}
function lateRecitations(forStudent = null) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  assigns.forEach(a => {
    // فقط الدروس التي يمكن تسجيل تلاوة لها (لها آية في أمثلة data.js)
    if (!LESSON_AYAHS.has(a.id)) return;
    const due = dueDateOf(a);
    if (!due || due >= today) return;
    tgt(a).forEach(s => {
      if (forStudent && s.id !== forStudent) return;
      if (done[s.id]?.has(a.id)) return; // الدرس منجز: لا تنبيه
      const recs = recitations.filter(r => r.student_id === s.id && recCovers(r, a.id));
      if (!recs.length) {
        out.push({a, s, rec: null, state: 'missing', days: Math.round((today - due) / DAY_MS)});
        return;
      }
      const first = recs.map(r => ({r, day: parseDay(isoDay(new Date(r.created_at)))}))
                        .sort((x, y) => x.day - y.day)[0];
      const days = Math.round((first.day - due) / DAY_MS);
      if (days > 0) out.push({a, s, rec: first.r, state: 'late', days});
    });
  });
  return out.sort((x, y) => y.days - x.days);
}
function lateRecPanel(list, mode = 'plain') {
  if (!list.length) return '';
  const rows = list.map(x => {
    const status = x.state === 'missing'
      ? '<span class="tag late">لم تُسلّم</span>'
      : `<span class="tag late">سُلّمت متأخرة ${N(x.days)} يوم</span>`;
    const detail = `${mode === 'student' ? '' : E(x.s.n) + ' · '}${E(dueInfo(x.a).label)}`;
    const action = mode === 'student'
      ? `<button class="btn alt mini" data-lateo="${x.a.id}">سجّل التلاوة</button>`
      : `<button class="btn alt mini" data-latev="${x.s.id}">عرض الطالب</button>`;
    return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="grow"><b>${E(IT[x.a.id]?.t || x.a.id)}</b><div class="m">${detail}</div></div>${status}${action}</div>`;
  }).join('');
  return `<div class="card notif warn"><div class="row"><b>⏰ متأخرات تسليم التلاوات</b><span class="grow"></span><span class="tag late">${N(list.length)}</span></div>${rows}</div>`;
}
function wireLate() {
  app.querySelectorAll('[data-latev]').forEach(b => b.onclick = () => {
    mode = 'S'; sid = b.dataset.latev; go({p: 'home'});
  });
  app.querySelectorAll('[data-lateo]').forEach(b => b.onclick = () => {
    const ay = LESSON_AYAHS.get(b.dataset.lateo)?.[0];
    if (!ay) return;
    if (view.p !== 'quran' || view.n !== ay.surah) go({p: 'quran', n: ay.surah});
    reciteDlg(ay.surah, ay.ayah, D.q[ay.surah - 1]?.name || '');
  });
}

/* ---------- إعادات التلاوات بعد مراجعة المعلّم ---------- */
function redoRequests(forStudent = null) {
  const out = [];
  recitations.filter(r => r.status === 'review').forEach(r => {
    if (forStudent && r.student_id !== forStudent) return;
    const since = new Date(r.reviewed_at || r.created_at).getTime();
    // تسجيل جديد لنفس الآية/السورة بعد طلب الإعادة يُعدّ استجابةً للطالب
    const answered = recitations.some(x => x.student_id === r.student_id && x.id !== r.id &&
      new Date(x.created_at).getTime() > since &&
      ((x.scope === r.scope && x.surah === r.surah && (r.scope === 'surah' || x.ayah === r.ayah)) ||
       (r.scope === 'ayah' && x.scope === 'surah' && x.surah === r.surah)));
    if (answered) return;
    const day = new Date(since); day.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    out.push({r, s: students.find(z => z.id === r.student_id),
      days: Math.max(0, Math.round((today - day) / DAY_MS))});
  });
  return out.sort((a, b) => b.days - a.days);
}
function redoPanel(list, mode = 'plain') {
  if (!list.length) return '';
  const rows = list.map(x => {
    const note = x.r.teacher_note ? E(x.r.teacher_note) : '';
    const title = mode === 'student' ? recWhere(x.r) : E(x.s?.n || x.r.student_id);
    const detail = mode === 'student'
      ? `${note ? note + ' · ' : ''}اطلب المعلّم إعادة التسجيل · لم تُعِد بعد`
      : `${recWhere(x.r)}${note ? ' · ' + note : ''} · لم يُعِد بعد`;
    const wait = x.days ? `<span class="tag w">منذ ${N(x.days)} يوم</span>` : '<span class="tag w">اليوم</span>';
    const action = mode === 'student'
      ? `<button class="btn alt mini" data-redo="${x.r.id}">🎙️ إعادة التسجيل</button>`
      : `<button class="btn alt mini" data-redov="${x.r.student_id}">عرض الطالب</button>`;
    return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="grow"><b>${title}</b><div class="m">${detail}</div></div>${wait}${action}</div>`;
  }).join('');
  return `<div class="card notif retry"><div class="row"><b>🔁 إعادات مطلوبة بعد المراجعة</b><span class="grow"></span><span class="tag w">${N(list.length)}</span></div>${rows}</div>`;
}
function wireRedo() {
  app.querySelectorAll('[data-redov]').forEach(b => b.onclick = () => {
    mode = 'S'; sid = b.dataset.redov; go({p: 'home'});
  });
  app.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => {
    const r = recitations.find(x => x.id === +b.dataset.redo);
    if (!r) return;
    if (view.p !== 'quran' || view.n !== r.surah) go({p: 'quran', n: r.surah});
    reciteDlg(r.surah, r.scope === 'surah' ? 1 : r.ayah, D.q[r.surah - 1]?.name || '', r.scope);
  });
}

const auth = $('#auth');
let students = [], done = {}, assigns = [], roles = [], recitations = [];
let mode = 'T', sid = null, view = {p: 'home'}, user = null, role = 'teacher';
const reportFilter = {q: '', lv: '', sort: 'pct'};
const isTeacher = () => role === 'teacher';

function toast(t) {
  const e = $('#toast');
  e.textContent = t;
  e.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => e.classList.remove('show'), 2600);
}

/* ---------- Supabase layer ---------- */
async function loadData() {
  const [{data: st, error: e1}, {data: cp, error: e2}, {data: as, error: e3}, {data: ro, error: e4}, {data: rc, error: e5}] = await Promise.all([
    sb.from('students').select('*').order('id'),
    sb.from('completions').select('*'),
    sb.from('assignments').select('*').order('created_at'),
    sb.from('user_roles').select('user_id, role, student_id, email'),
    sb.from('recitations').select('*').order('created_at', {ascending: false})
  ]);
  if (e1 || e2 || e3 || e4 || e5) {
    console.error(e1 || e2 || e3 || e4 || e5);
    toast('تعذّر تحميل البيانات من Supabase');
  }
  students = (st || []).map(r => ({id: r.id, n: r.name, lv: r.level}));
  roles = ro || [];
  recitations = rc || [];
  done = Object.fromEntries(students.map(s => [s.id, new Set()]));
  (cp || []).forEach(r => { if (done[r.student_id]) done[r.student_id].add(r.lesson_id); });
  assigns = (as || []).map(r => ({dbId: r.id, id: r.lesson_id, to: r.target, due: r.due || 'بلا موعد', date: r.due_date || null}));
  // الطالب لا يستطيع تبديل الهوية: حسابه مرتبط بسجل طالب واحد
  if (!isTeacher()) {
    const mine = roles.find(r => r.user_id === user?.id && r.role === 'student');
    if (mine?.student_id) sid = mine.student_id;
  }
  if (!students.find(s => s.id === sid)) sid = students[0]?.id || null;
}

async function persistCompletion(lessonId) {
  const {error} = await sb.from('completions')
    .upsert({student_id: sid, lesson_id: lessonId}, {onConflict: 'student_id,lesson_id'});
  if (error) { console.error(error); toast('تعذّر حفظ الإنجاز: ' + error.message); }
}

async function persistAssign(a) {
  const {error} = await sb.from('assignments')
    .insert({lesson_id: a.id, target: a.to, due: a.due, due_date: a.date || null});
  if (error) { console.error(error); toast('تعذّر حفظ الإسناد: ' + error.message); }
}

async function updateDue(dbId, text, date) {
  const {error} = await sb.from('assignments')
    .update({due: text, due_date: date}).eq('id', dbId);
  if (error) { console.error(error); toast('تعذّر حفظ الموعد: ' + error.message); return false; }
  return true;
}

async function persistPromotion(s) {
  const {error} = await sb.from('students').update({level: s.lv}).eq('id', s.id);
  if (error) { console.error(error); toast('تعذّر حفظ الترقية: ' + error.message); }
}

async function persistStudent(s, isNew) {
  const row = {id: s.id, name: s.n, level: s.lv};
  const {error} = isNew
    ? await sb.from('students').insert(row)
    : await sb.from('students').update({name: s.n, level: s.lv}).eq('id', s.id);
  if (error) { console.error(error); toast('تعذّر حفظ الطالب: ' + error.message); return false; }
  return true;
}

async function removeStudent(id) {
  const {error} = await sb.from('students').delete().eq('id', id);
  if (error) { console.error(error); toast('تعذّر حذف الطالب: ' + error.message); return false; }
  return true;
}

async function removeAssign(dbId) {
  const {error} = await sb.from('assignments').delete().eq('id', dbId);
  if (error) { console.error(error); toast('تعذّر حذف المهمة: ' + error.message); return false; }
  return true;
}

async function seedDemo() {
  const demoStudents = [
    {id: 's1', name: 'أحمد', level: 'مبتدئ'},
    {id: 's2', name: 'مريم', level: 'متوسط'},
    {id: 's3', name: 'سلمى', level: 'مبتدئ'},
    {id: 's4', name: 'زياد', level: 'متقدم'},
    {id: 's5', name: 'ريم', level: 'مبتدئ'},
    {id: 's6', name: 'هدى', level: 'مبتدئ'}
  ];
  const demoDone = {
    s1: ['t-intro', 'a-salam', 'l-0'],
    s2: ['t-ghunna', 's-hira'],
    s3: ['a-food'],
    s4: ['t-madd-lazim'],
    s5: [],
    s6: ['l-1', 'l-2']
  };
  const demoAssigns = [
    {lesson_id: 's-hira', target: 'all', due: 'الخميس', due_date: isoDay(dueDateOf({due: 'الخميس'}))},
    {lesson_id: 't-noon-tanween', target: 's1', due: 'السبت', due_date: isoDay(dueDateOf({due: 'السبت'}))}
  ];
  const e1 = await sb.from('students').upsert(demoStudents);
  const e2 = await sb.from('completions').upsert(
    Object.entries(demoDone).flatMap(([s, ids]) => ids.map(lesson_id => ({student_id: s, lesson_id}))),
    {onConflict: 'student_id,lesson_id'}
  );
  const e3 = await sb.from('assignments').upsert(demoAssigns, {onConflict: 'lesson_id,target'});
  if (e1.error || e2.error || e3.error) {
    console.error(e1.error || e2.error || e3.error);
    toast('تعذّر تحميل البيانات التجريبية');
    return;
  }
  await loadData();
  toast('تم تحميل البيانات التجريبية');
  render();
}

/* ---------- Auth ---------- */
function showAuth(msg) {
  auth.hidden = false;
  if (msg) $('#amsg').textContent = msg;
}
async function startApp(u) {
  user = u;
  const {data: r, error} = await sb.from('user_roles')
    .select('role, student_id').eq('user_id', u.id).maybeSingle();
  if (error) { showAuth('تعذّر قراءة دور الحساب: ' + error.message); return; }
  if (!r) { showAuth('حسابك غير مرتبط بدور. تواصل مع المعلّم.'); return; }
  role = r.role;
  mode = isTeacher() ? 'T' : 'S';
  view = {p: 'home'};
  auth.hidden = true;
  await loadData();
  render();
}
async function boot() {
  if (!sb) { showAuth('يرجى تعبئة SUPABASE_URL و SUPABASE_ANON_KEY في config.js أولاً.'); return; }
  const {data: {session}} = await sb.auth.getSession();
  if (session) await startApp(session.user);
  else showAuth();
}

$('#sin').onclick = async () => {
  const email = $('#em').value.trim(), password = $('#pw').value;
  const {data, error} = await sb.auth.signInWithPassword({email, password});
  if (error) { $('#amsg').textContent = error.message; return; }
  $('#amsg').textContent = '';
  await startApp(data.user);
};
const supBtn = $('#sup');
if (supBtn) supBtn.onclick = async () => {
  const email = $('#em').value.trim(), password = $('#pw').value;
  const {data, error} = await sb.auth.signUp({email, password});
  if (error) { $('#amsg').textContent = error.message; return; }
  $('#amsg').textContent = data.session
    ? 'تم إنشاء الحساب. أهلاً بك!'
    : 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجّل الدخول.';
};
$('#out').onclick = async () => {
  await sb.auth.signOut();
  students = []; done = {}; assigns = []; roles = []; recitations = [];
  mode = 'T'; sid = null; view = {p: 'home'}; user = null; role = 'teacher';
  showAuth();
  $('#amsg').textContent = '';
};

/* ---------- Core navigation ---------- */
const me = () => students.find(s => s.id === sid);
const tgt = a => a.to === 'all' ? students : students.filter(s => s.id === a.to);
const lvIt = lv => D.items.filter(i => i.lv === lv);
function prog(s) {
  const l = lvIt(s.lv), d = l.filter(i => done[s.id].has(i.id)).length;
  return {d, t: l.length, pct: l.length ? Math.round(d / l.length * 100) : 0};
}
function go(v) { view = v; render(); window.scrollTo(0, 0); }
function render() {
  // الطالب لا يصل إلى صفحات المعلّم حتى لو تغيّرت حالة الواجهة
  if (!isTeacher() && ['students', 'cur', 'tasks', 'reports', 'recitations'].includes(view.p)) view = {p: 'home'};
  const toggle = isTeacher() ? '' : 'none';
  $('#bT').style.display = toggle;
  $('#bS').style.display = toggle;
  $('#bT').classList.toggle('on', mode === 'T');
  $('#bS').classList.toggle('on', mode === 'S');
  $('#st').style.display = isTeacher() && mode === 'S' ? '' : 'none';
  $('#st').innerHTML = students.map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${E(s.n)}</option>`).join('');
  side();
  ({home: () => mode === 'T' ? thome() : shome(), students: tstud, cur: tcur, tasks: ttasks, reports: treports, recitations: trec, quran, sec: ssec, lesson})[view.p]();
}
function side() {
  const it = mode === 'T'
    ? [['home', '🏠', 'الرئيسية'], ['students', '👥', 'الطلاب'], ['cur', '📚', 'المنهج'], ['tasks', '✅', 'المهام'], ['reports', '📊', 'التقارير'], ['recitations', '🎙️', 'التلاوات'], ['quran', '📖', 'القرآن']]
    : [['home', '🏠', 'الرئيسية'], ['quran', '📖', 'القرآن'], ...SECS.map(s => ['sec:' + s.id, s.icon, s.t])];
  const cur = view.p === 'sec' ? 'sec:' + view.sec : view.p;
  const near = nearTasks(mode === 'T' ? null : sid).length;
  const late = lateRecitations(mode === 'T' ? null : sid).length;
  const redo = redoRequests(mode === 'T' ? null : sid).length;
  $('#side').innerHTML = `<div class="nv">` + it.map(([k, ic, t]) => {
    let bell = '';
    if (near && (k === 'home' || k === 'tasks')) bell += ` <span class="nav-bell"><span class="ic">🔔</span>${N(near)}</span>`;
    if (late && (k === 'home' || k === 'tasks' || (mode === 'S' && k === 'quran')))
      bell += ` <span class="nav-bell late"><span class="ic">⏰</span>${N(late)}</span>`;
    if (redo && (k === 'home' || (mode === 'T' ? k === 'recitations' : (!isTeacher() && k === 'quran'))))
      bell += ` <span class="nav-bell retry"><span class="ic">🔁</span>${N(redo)}</span>`;
    return `<button data-k="${k}" class="${cur === k ? 'on' : ''}"><span><span class="nav-ic">${ic}</span>${t}</span>${bell}</button>`;
  }).join('') + `</div>`;
  $('#side').querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    go(k.startsWith('sec:') ? {p: 'sec', sec: k.slice(4)} : {p: k});
  });
}
$('#bT').onclick = () => { mode = 'T'; go({p: 'home'}); };
$('#bS').onclick = () => { mode = 'S'; go({p: 'home'}); };
$('#st').onchange = e => { sid = e.target.value; go({p: 'home'}); };

/* ---------- Theme (light / dark) ---------- */
const themeBtn = $('#theme');
const systemDark = () => matchMedia('(prefers-color-scheme:dark)').matches;
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : systemDark();
}
function applyTheme() {
  const saved = localStorage.getItem('manara.theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  const dark = isDark();
  themeBtn.textContent = dark ? '☀️' : '🌙';
  themeBtn.setAttribute('aria-label', dark ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي');
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#07262c' : '#0e3b43');
}
applyTheme();
themeBtn.onclick = () => {
  localStorage.setItem('manara.theme', isDark() ? 'light' : 'dark');
  applyTheme();
};
matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change', () => {
  if (!localStorage.getItem('manara.theme')) applyTheme();
});

/* ---------- Teacher views ---------- */
function thome() {
  const rd = students.filter(s => prog(s).pct >= 80 && s.lv !== 'متقدم');
  const pending = recitations.filter(r => r.status === 'pending').length;
  const soon = nearTasks(), late = lateRecitations(), redo = redoRequests();
  const tot = assigns.reduce((a, x) => a + tgt(x).length, 0),
        dn = assigns.reduce((a, x) => a + tgt(x).filter(s => done[s.id].has(x.id)).length, 0);
  app.innerHTML = `<h1>أهلاً بك يا معلم</h1><div class="stats">
    <div class="card stat"><i class="si">👥</i><b>${N(students.length)}</b><span>طالب</span></div>
    <div class="card stat"><i class="si">📌</i><b>${N(assigns.length)}</b><span>مهمة مُسندة</span></div>
    <div class="card stat c-good"><i class="si">✅</i><b>${N(dn)} / ${N(tot)}</b><span>تسليمات أُنجزت</span></div>
    <div class="card stat c-warn"><i class="si">⬆️</i><b>${N(rd.length)}</b><span>جاهزون للترقية</span></div>
    <div class="card stat c-warn"><i class="si">🎙️</i><b>${N(pending)}</b><span>تلاوات بانتظار</span></div>
    <div class="card stat c-bad"><i class="si">🔁</i><b>${N(redo.length)}</b><span>إعادات مطلوبة</span></div></div>` +
    (pending ? `<div class="card" style="border:2px solid var(--lamp)"><b>${N(pending)} تلاوة بانتظار المراجعة</b><p class="m" style="margin:4px 0 8px">استمع إليها واعتمدها أو اطلب إعادة التسجيل.</p><button class="btn lamp" id="gr">فتح التلاوات</button></div>` : '') +
    notifyPanel(soon, 'teacher') +
    lateRecPanel(late) +
    redoPanel(redo) +
    (rd.length ? `<div class="card" style="border:2px solid var(--lamp)"><b>أنهوا معظم مستواهم</b>${rd.map(s => `<div class="row" style="margin-top:6px"><span class="grow">${E(s.n)} (${prog(s).pct}%)</span><button class="btn lamp" data-up="${s.id}">ترقية إلى ${LV[LV.indexOf(s.lv) + 1]}</button></div>`).join('')}</div>` : '') +
    (students.length ? `<div class="card"><p style="margin:0 0 10px">من «المنهج» تعاين الدروس وتسندها، ومن «الطلاب» ترى تقدم كل طالب.</p><button class="btn" id="g1">فتح المنهج</button></div>`
      : `<div class="card"><p style="margin:0 0 10px">لا يوجد طلاب بعد. يمكنك البدء بالبيانات التجريبية.</p><button class="btn" id="seed">تحميل بيانات تجريبية</button></div>`);
  if ($('#g1')) $('#g1').onclick = () => go({p: 'cur'});
  if ($('#gr')) $('#gr').onclick = () => go({p: 'recitations'});
  if ($('#gn')) $('#gn').onclick = () => go({p: 'tasks'});
  if ($('#seed')) $('#seed').onclick = seedDemo;
  wireLate(); wireRedo();
  app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const s = students.find(x => x.id === b.dataset.up);
    s.lv = LV[LV.indexOf(s.lv) + 1];
    toast('تمت الترقية');
    render();
    persistPromotion(s);
  });
}
function tstud() {
  app.innerHTML = `<h1>الطلاب</h1><div class="row" style="margin-bottom:10px"><div class="grow m">${N(students.length)} طالب مسجّل · ${N(roles.filter(r => r.role === 'student').length)} حساب طالب</div><button class="btn" id="adds">+ إضافة طالب</button></div><div class="card tbl"><table><thead><tr><th>الطالب</th><th>المستوى</th><th>التقدم في مستواه</th><th>أنجز</th><th>الحساب</th><th>إجراءات</th></tr></thead><tbody>${students.map(s => {
    const p = prog(s), acc = roles.find(r => r.student_id === s.id);
    return `<tr><td><b>${E(s.n)}</b></td><td><span class="tag">${s.lv}</span></td><td><div class="bar" title="${p.pct}%"><i style="width:${p.pct}%"></i></div></td><td>${N(done[s.id].size)} درساً</td><td>${acc ? `<span class="tag">${E(acc.email || 'مربوط')}</span>` : '<span class="m">—</span>'}</td><td class="row" style="gap:4px;flex-wrap:wrap"><button class="btn alt" data-p="${s.id}">ملف</button><button class="btn alt" data-v="${s.id}">عرض</button><button class="btn alt" data-e="${s.id}">تعديل</button><button class="btn alt" data-ac="${s.id}">حساب</button><button class="btn alt" data-d="${s.id}">حذف</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
  app.querySelectorAll('[data-p]').forEach(b => b.onclick = () => profileDlg(b.dataset.p));
  app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { mode = 'S'; sid = b.dataset.v; go({p: 'home'}); });
  app.querySelectorAll('[data-e]').forEach(b => b.onclick = () => studentDlg(b.dataset.e));
  app.querySelectorAll('[data-ac]').forEach(b => b.onclick = () => accountDlg(b.dataset.ac));
  app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    const s = students.find(x => x.id === b.dataset.d);
    if (!confirm(`حذف الطالب «${s.n}» وكل إنجازاته؟`)) return;
    if (await removeStudent(s.id)) {
      students = students.filter(x => x.id !== s.id);
      delete done[s.id];
      if (sid === s.id) sid = students[0]?.id || null;
      toast('تم حذف الطالب');
      render();
    }
  });
  $('#adds').onclick = () => studentDlg(null);
}
function studentDlg(id) {
  const s = id ? students.find(x => x.id === id) : null;
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">${s ? 'تعديل الطالب' : 'إضافة طالب'}</h2><label>الاسم</label><input id="sn" value="${E(s?.n || '')}" placeholder="اسم الطالب"><label>المستوى</label><select id="sl">${LV.map(l => `<option value="${l}" ${s?.lv === l ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="row" style="margin-top:14px"><button class="btn" id="ok">حفظ</button><button class="btn alt" id="x">إلغاء</button></div>`;
  d.showModal();
  $('#x').onclick = () => d.close();
  $('#ok').onclick = async () => {
    const name = $('#sn').value.trim();
    if (!name) { toast('اكتب اسم الطالب'); return; }
    const rec = {id: s?.id || ('s' + Date.now()), n: name, lv: $('#sl').value};
    const ok = await persistStudent(rec, !s);
    if (!ok) return;
    if (s) { s.n = rec.n; s.lv = rec.lv; }
    else { students.push(rec); done[rec.id] = new Set(); }
    d.close();
    toast('تم حفظ الطالب');
    render();
  };
}
function profileDlg(id) {
  const s = students.find(x => x.id === id);
  if (!s) return;
  const p = prog(s), acc = roles.find(r => r.student_id === id);
  const myAssigns = assigns.filter(a => tgt(a).includes(s));
  const myRec = recitations.filter(r => r.student_id === id);
  const late = lateRecitations(id).length, redo = redoRequests(id).length;
  const subs = SECS.map(x => {
    const it = D.items.filter(i => i.sec === x.id);
    const c = it.filter(i => done[id].has(i.id)).length;
    return {x, c, t: it.length, pct: it.length ? Math.round(c / it.length * 100) : 0};
  });
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">ملف الطالب: ${E(s.n)}</h2>
    <div class="card"><div class="row"><div class="grow"><b>${E(s.lv)}</b><div class="m">${acc ? E(acc.email || 'حساب مربوط') : 'لا يوجد حساب دخول'}</div></div><span class="tag">${N(p.pct)}% في مستواه</span></div></div>
    <div class="stats" style="margin:10px 0">
      <div class="card stat"><b>${N(done[id].size)}</b><span>درس منجز</span></div>
      <div class="card stat"><b>${N(myRec.filter(r => r.status === 'approved').length)}</b><span>تلاوة مقبولة</span></div>
      <div class="card stat"><b>${N(myRec.filter(r => r.status === 'pending').length)}</b><span>بانتظار المراجعة</span></div>
      <div class="card stat"><b>${N(late)}</b><span>تأخير تلاوة</span></div>
      <div class="card stat"><b>${N(redo)}</b><span>إعادة مطلوبة</span></div>
    </div>
    <h3 style="margin:12px 0 4px">تقدّم المواد</h3>
    <div class="card">${subs.map(x => `<div class="row" style="margin:6px 0"><div class="grow">${x.x.icon} ${E(x.x.t)} <span class="m">${N(x.c)}/${N(x.t)}</span></div><div style="width:40%"><div class="bar" title="${x.pct}%"><i style="width:${x.pct}%"></i></div></div><b>${N(x.pct)}%</b></div>`).join('')}</div>
    <h3 style="margin:12px 0 4px">المهام المسندة</h3>
    <div class="card">${myAssigns.length ? myAssigns.map(a => `<div class="row" style="margin:5px 0"><div class="grow">${E(IT[a.id]?.t || a.id)}<div class="m">${E(dueInfo(a).label)}</div></div>${done[id].has(a.id) ? '<span class="tag ok">✓ منجز</span>' : dueTag(a)}</div>`).join('') : '<div class="m">لا توجد مهام مسندة.</div>'}</div>
    <h3 style="margin:12px 0 4px">التلاوات</h3>
    <div class="card">${myRec.length ? myRec.map(r => `<div class="row" style="margin:5px 0;flex-wrap:wrap"><div class="grow">${recWhere(r)}<div class="m">${new Date(r.created_at).toLocaleString('ar-EG')}</div></div><span class="tag ${r.status === 'approved' ? '' : 'w'}">${RECT[r.status] || r.status}</span>${quizTag(r)}</div>`).join('') : '<div class="m">لا توجد تلاوات مسجّلة.</div>'}</div>
    <div class="row" style="margin-top:14px"><button class="btn" id="px">إغلاق</button></div>`;
  d.showModal();
  $('#px').onclick = () => d.close();
}

function accountDlg(id) {
  const s = students.find(x => x.id === id);
  const acc = roles.find(r => r.student_id === id);
  const d = $('#dlg');
  if (!acc) {
    d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">حساب ${E(s.n)}</h2><p class="m">سيستطيع الطالب الدخول ومشاهدة تقدّمه ومهامه فقط.</p><label>بريد الطالب</label><input id="ae" type="email" placeholder="student@example.com"><label>كلمة المرور</label><input id="ap" type="password" placeholder="6 أحرف على الأقل"><div class="row" style="margin-top:14px"><button class="btn" id="ok">إنشاء الحساب</button><button class="btn alt" id="x">إلغاء</button></div>`;
    d.showModal();
    $('#x').onclick = () => d.close();
    $('#ok').onclick = async () => {
      const email = $('#ae').value.trim(), password = $('#ap').value;
      const {data, error} = await sb.rpc('create_student_account', {p_student_id: id, p_email: email, p_password: password});
      if (error) { toast(error.message); return; }
      roles.push({user_id: data, role: 'student', student_id: id, email: email.toLowerCase()});
      d.close(); toast('تم إنشاء حساب الطالب'); render();
    };
  } else {
    d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">حساب ${E(s.n)}</h2><div class="card"><b>${E(acc.email || '—')}</b><div class="m">حساب طالب مرتبط</div></div><label>كلمة مرور جديدة</label><input id="np" type="password" placeholder="اتركها فارغة للإبقاء على الحالية"><div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn" id="rst">تحديث كلمة المرور</button><button class="btn alt" id="rm">إلغاء الربط</button><button class="btn alt" id="x">إغلاق</button></div>`;
    d.showModal();
    $('#x').onclick = () => d.close();
    $('#rst').onclick = async () => {
      const password = $('#np').value;
      if (!password) { toast('اكتب كلمة مرور جديدة'); return; }
      const {error} = await sb.rpc('reset_student_password', {p_student_id: id, p_password: password});
      if (error) { toast(error.message); return; }
      d.close(); toast('تم تحديث كلمة المرور');
    };
    $('#rm').onclick = async () => {
      if (!confirm('إلغاء ربط الحساب بالطالب؟ سيُحذف حساب الدخول ويبقى تقدّمه محفوظاً.')) return;
      const {error} = await sb.rpc('remove_student_account', {p_student_id: id});
      if (error) { toast(error.message); return; }
      roles = roles.filter(r => r.student_id !== id);
      d.close(); toast('تم إلغاء الربط'); render();
    };
  }
}
function tcur() {
  const sec = view.sec || SECS[0].id;
  app.innerHTML = `<h1>المنهج</h1><div class="row tabs">${SECS.map(s => `<button class="chip ${s.id === sec ? 'on' : ''}" data-s="${s.id}">${s.icon} ${s.t}</button>`).join('')}</div>` +
    D.items.filter(i => i.sec === sec).map(i => `<div class="card it"><div class="grow"><b>${E(i.t)}</b> <span class="tag">${i.lv}</span> <span class="tag w">مسودة</span></div><button class="btn alt" data-v="${i.id}">معاينة</button><button class="btn" data-a="${i.id}">إسناد</button></div>`).join('');
  app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go({p: 'cur', sec: b.dataset.s}));
  app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => go({p: 'lesson', id: b.dataset.v, back: view}));
  app.querySelectorAll('[data-a]').forEach(b => b.onclick = () => assign(b.dataset.a));
}
function assign(id) {
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">إسناد: ${E(IT[id].t)}</h2><label>إلى</label><select id="to"><option value="all">كل الطلاب</option>${students.map(s => `<option value="${s.id}">${E(s.n)} (${s.lv})</option>`).join('')}</select>` +
    `<label>التاريخ (للتذكير التلقائي)</label><input id="dd" type="date">` +
    `<label>نص الموعد (اختياري، يقبل اسماً مثل الخميس)</label><input id="due" type="text" placeholder="مثلاً: الخميس"><div class="row" style="margin-top:14px"><button class="btn" id="ok">إسناد</button><button class="btn alt" id="x">إلغاء</button></div>`;
  d.showModal();
  $('#x').onclick = () => d.close();
  $('#ok').onclick = () => {
    const date = $('#dd').value || null;
    const typed = $('#due').value.trim();
    const dt = date ? parseDay(date) : dueDateOf({due: typed});
    const due = date ? DAYS[dt.getDay()] : (typed || (dt ? DAYS[dt.getDay()] : 'بلا موعد'));
    const a = {id, to: $('#to').value, due, date: dt ? isoDay(dt) : null};
    assigns.push(a);
    d.close();
    toast('تم الإسناد مع الموعد');
    go({p: 'tasks'});
    persistAssign(a);
  };
}

function dueDlg(dbId) {
  const a = assigns.find(x => x.dbId === dbId);
  if (!a) return;
  const current = dueDateOf(a);
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">تعديل موعد: ${E(IT[a.id].t)}</h2><label>التاريخ</label><input id="ed" type="date" value="${current ? isoDay(current) : ''}">` +
    `<label>نص الموعد (اختياري)</label><input id="et" type="text" value="${E(a.due === 'بلا موعد' ? '' : a.due)}" placeholder="مثلاً: الخميس"><div class="row" style="margin-top:14px"><button class="btn" id="ok">حفظ</button><button class="btn alt" id="x">إلغاء</button></div>`;
  d.showModal();
  $('#x').onclick = () => d.close();
  $('#ok').onclick = async () => {
    const date = $('#ed').value || null;
    const typed = $('#et').value.trim();
    const dt = date ? parseDay(date) : dueDateOf({due: typed});
    const text = date ? DAYS[dt.getDay()] : (typed || (dt ? DAYS[dt.getDay()] : 'بلا موعد'));
    if (!await updateDue(dbId, text, dt ? isoDay(dt) : null)) return;
    Object.assign(a, {due: text, date: dt ? isoDay(dt) : null});
    d.close(); toast('تم تحديث الموعد'); render();
  };
}
function ttasks() {
  app.innerHTML = `<h1>المهام</h1>` + notifyPanel(nearTasks()) + lateRecPanel(lateRecitations()) +
    (assigns.length ? assigns.map(a => {
      const t = tgt(a), n = t.filter(s => done[s.id].has(a.id)).length, info = dueInfo(a);
      const label = info.days === null ? E(a.due) : E(info.label) + (a.due && a.due !== DAYS[parseDay(a.date)?.getDay()] && info.label.indexOf(a.due) < 0 ? ` (${E(a.due)})` : '');
      return `<div class="card it"><div class="grow"><b>${E(IT[a.id].t)}</b><div class="m">إلى: ${a.to === 'all' ? 'كل الطلاب' : E(t[0]?.n || '—')} · الموعد: ${label}</div></div>${dueTag(a)}<span class="tag">${N(n)} / ${N(t.length)} سلّموا</span><button class="btn alt" data-edue="${a.dbId}">تعديل الموعد</button><button class="btn alt" data-del="${a.dbId}">حذف</button></div>`;
    }).join('') : `<div class="card">لا توجد مهام بعد.</div>`);
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف هذه المهمة؟')) return;
    if (await removeAssign(+b.dataset.del)) {
      assigns = assigns.filter(x => x.dbId !== +b.dataset.del);
      toast('تم حذف المهمة');
      render();
    }
  });
  app.querySelectorAll('[data-edue]').forEach(b => b.onclick = () => dueDlg(+b.dataset.edue));
  wireLate();
}

function reportData() {
  const subs = SECS.map(x => {
    const it = D.items.filter(i => i.sec === x.id);
    return {x, it, total: students.length * it.length,
      cnt: students.reduce((a, s) => a + it.filter(i => done[s.id].has(i.id)).length, 0)};
  });
  const rows = students.map(s => {
    const r = {name: s.n, level: s.lv, pct: prog(s).pct, done: done[s.id].size,
      rec: recitations.filter(x => x.student_id === s.id && x.status === 'approved').length};
    subs.forEach(({x, it}) => {
      const c = it.filter(i => done[s.id].has(i.id)).length;
      r[x.id] = it.length ? Math.round(c / it.length * 100) : 0;
      r[x.id + '_cnt'] = `${c}/${it.length}`;
    });
    return r;
  });
  const allDone = students.reduce((a, s) => a + done[s.id].size, 0);
  const allPct = students.length ? Math.round(students.reduce((a, s) => a + prog(s).pct, 0) / students.length) : 0;
  const ready = students.filter(s => prog(s).pct >= 80 && s.lv !== 'متقدم').length;
  const approved = recitations.filter(r => r.status === 'approved').length;
  const pending = recitations.filter(r => r.status === 'pending').length;
  return {subs, rows, allDone, allPct, ready, approved, pending};
}
const csvCell = v => `"${String(v).replace(/"/g, '""')}"`;
function exportCSV() {
  const {subs, allPct, allDone, ready, approved, pending} = reportData();
  const rows = reportRows();
  const head = ['الطالب', 'المستوى', 'الإنجاز العام %', 'الدروس المنجزة', 'تلاوات مقبولة',
    ...subs.flatMap(({x}) => [`${x.t} %`, `${x.t} (منجز/إجمالي)`])];
  const lines = [
    ['تقرير منارة', new Date().toLocaleString('ar-EG')],
    ['الإنجاز العام %', allPct], ['الدروس المنجزة', allDone], ['جاهزون للترقية', ready],
    ['تلاوات مقبولة', approved], ['تلاوات بانتظار المراجعة', pending],
    ['النتائج المعروضة', `${rows.length} من ${students.length}`],
    ['البحث', reportFilter.q || '—'], ['المستوى', reportFilter.lv || 'الكل'],
    [], head,
    ...rows.map(r => [r.name, r.level, r.pct, r.done, r.rec,
      ...subs.flatMap(({x}) => [r[x.id], r[x.id + '_cnt']])
    ])
  ];
  const csv = '\ufeff' + lines.map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url; a.download = `manara-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('تم تنزيل التقرير CSV');
}
function printPDF() {
  const old = document.title;
  document.title = `منارة — تقرير ${new Date().toLocaleDateString('ar-EG')}`;
  window.addEventListener('afterprint', () => { document.title = old; }, {once: true});
  window.print();
}
function reportRows() {
  const q = reportFilter.q.trim().toLowerCase();
  const rows = reportData().rows.filter(r =>
    (!q || r.name.toLowerCase().includes(q)) && (!reportFilter.lv || r.level === reportFilter.lv));
  const by = {
    pct: (a, b) => b.pct - a.pct,
    name: (a, b) => a.name.localeCompare(b.name, 'ar'),
    done: (a, b) => b.done - a.done,
    rec: (a, b) => b.rec - a.rec
  };
  return rows.sort(by[reportFilter.sort] || by.pct);
}
function refreshReportTable() {
  const body = $('#rbody');
  if (!body) return;
  const rows = reportRows();
  body.innerHTML = rows.length ? rows.map(r => `<tr><td><b>${E(r.name)}</b></td><td>${E(r.level)}</td><td><div class="bar" title="${r.pct}%"><i style="width:${r.pct}%"></i></div></td>${SECS.map(x => `<td><div class="bar" title="${r[x.id]}%"><i style="width:${r[x.id]}%"></i></div></td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${SECS.length + 3}" class="m">لا توجد نتائج مطابقة للبحث أو التصفية.</td></tr>`;
  const c = $('#rcount');
  if (c) c.textContent = `${N(rows.length)} من ${N(students.length)} طالب`;
}
function treports() {
  const {subs, allDone, allPct, ready, approved, pending} = reportData();
  app.innerHTML = `<div class="print-head"><h1>منارة — تقرير المتابعة</h1><p>تاريخ التقرير: ${new Date().toLocaleString('ar-EG')}</p></div>
    <h1>التقارير</h1>
    <div class="row" style="margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <input id="rq" aria-label="بحث باسم الطالب" placeholder="ابحث باسم الطالب" value="${E(reportFilter.q)}" style="max-width:220px">
      <select id="rl" aria-label="تصفية حسب المستوى"><option value="">كل المستويات</option>${LV.map(l => `<option value="${l}" ${reportFilter.lv === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="rsort" aria-label="ترتيب النتائج">
        <option value="pct" ${reportFilter.sort === 'pct' ? 'selected' : ''}>الأعلى إنجازاً</option>
        <option value="name" ${reportFilter.sort === 'name' ? 'selected' : ''}>حسب الاسم</option>
        <option value="done" ${reportFilter.sort === 'done' ? 'selected' : ''}>الأكثر دروساً</option>
        <option value="rec" ${reportFilter.sort === 'rec' ? 'selected' : ''}>الأكثر تلاوات</option>
      </select>
      <span class="grow m" id="rcount"></span>
      <button class="btn alt" id="excsv">تصدير CSV</button><button class="btn" id="expdf">حفظ PDF</button>
    </div>
    <div class="stats"><div class="card stat"><b>${N(allPct)}%</b><span>إنجاز عام</span></div><div class="card stat"><b>${N(allDone)}</b><span>درس منجز</span></div><div class="card stat"><b>${N(ready)}</b><span>جاهز للترقية</span></div><div class="card stat"><b>${N(approved)}</b><span>تلاوات مقبولة</span></div><div class="card stat"><b>${N(pending)}</b><span>تلاوات بانتظار</span></div></div>
    <h2>إنجاز المواد</h2><div class="card">${subs.map(s => `<div class="row" style="margin:8px 0"><div class="grow"><b>${s.icon} ${s.t}</b><div class="m">${N(s.cnt)} / ${N(s.total)} درس</div></div><div style="width:55%"><div class="bar" title="${s.pct}%"><i style="width:${s.pct}%"></i></div></div><b>${N(s.pct)}%</b></div>`).join('')}</div>
    <h2>تقدّم الطلاب</h2><div class="card tbl"><table><thead><tr><th>الطالب</th><th>المستوى</th><th>عام</th>${SECS.map(x => `<th>${x.icon}</th>`).join('')}</tr></thead><tbody id="rbody"></tbody></table></div>`;
  $('#rq').oninput = e => { reportFilter.q = e.target.value; refreshReportTable(); };
  $('#rl').onchange = e => { reportFilter.lv = e.target.value; refreshReportTable(); };
  $('#rsort').onchange = e => { reportFilter.sort = e.target.value; refreshReportTable(); };
  $('#excsv').onclick = exportCSV;
  $('#expdf').onclick = printPDF;
  refreshReportTable();
}

/* ---------- Student views ---------- */
function shome() {
  const s = me();
  if (!s) { app.innerHTML = `<div class="card">حسابك غير مرتبط بسجل طالب. تواصل مع المعلّم.</div>`; return; }
  const mine = assigns.filter(a => tgt(a).includes(s) && !done[s.id].has(a.id)), n = done[s.id].size;
  const soon = nearTasks(s.id);
  const myRec = recitations.filter(r => r.student_id === s.id);
  const pend = myRec.filter(r => r.status !== 'approved');
  const recOk = myRec.filter(r => r.status === 'approved').length;
  const recWait = myRec.filter(r => r.status === 'pending').length, recRev = redoRequests(s.id).length;
  const quizRecs = myRec.filter(r => r.status === 'approved' && (!r.quiz_at || !r.quiz_passed));
  const quizDone = myRec.filter(r => r.status === 'approved' && r.quiz_passed);
  app.innerHTML = `<div class="hero"><h1>أهلاً يا ${E(s.n)}</h1><div>مستواك: ${s.lv}</div><div class="m">تلاواتك: ${N(recOk)} مقبولة · ${N(recWait)} بانتظار المراجعة${recRev ? ' · ' + N(recRev) + ' تحتاج إعادة' : ''}</div><div class="lanterns" aria-label="${n} دروس">${[0, 1, 2, 3, 4, 5, 6].map(i => `<div class="ln ${i < n ? 'lit' : ''}"></div>`).join('')}</div></div>
  <div class="stats">
    <div class="card stat c-good"><i class="si">📚</i><b>${N(n)}</b><span>دروس منجزة</span></div>
    <div class="card stat c-good"><i class="si">✅</i><b>${N(recOk)}</b><span>تلاوات مقبولة</span></div>
    <div class="card stat c-warn"><i class="si">⏳</i><b>${N(recWait)}</b><span>بانتظار المراجعة</span></div>
    <div class="card stat c-bad"><i class="si">🔁</i><b>${N(recRev)}</b><span>تحتاج إعادة</span></div></div>
  ${notifyPanel(soon, 'student')}
  ${lateRecPanel(lateRecitations(s.id), 'student')}
  ${redoPanel(redoRequests(s.id), 'student')}
  ${(quizRecs.length || quizDone.length) ? `<h2>اختبارات التلاوات</h2>` + quizRecs.map(r => `<div class="card task"><div class="grow"><b>${recWhere(r)}</b> <span class="tag w">📝 ${r.quiz_at ? `أعد ${N(r.quiz_correct)}/${N(r.quiz_total)}` : 'بانتظار الاختبار'}</span><div class="m">أُعتمدت التلاوة — أجب عن أسئلة قصيرة لتحديد إنجازك.</div></div><button class="btn" data-quiz="${r.id}">ابدأ الاختبار</button></div>`).join('') + (quizDone.length ? `<div class="card"><span class="tag ok">✅ أنهيت ${N(quizDone.length)} اختبار تلاوة</span></div>` : '') : ''}
  ${pend.length ? `<h2>تلاوات تحتاج متابعة</h2>` + pend.map(r => `<div class="card task"><div class="grow"><b>${recWhere(r)}</b> <span class="tag ${r.status === 'approved' ? '' : 'w'}">${RECT[r.status] || r.status}</span><div class="m">أُرسلت ${new Date(r.created_at).toLocaleString('ar-EG')}${r.teacher_note ? ' · ' + E(r.teacher_note) : ''}</div></div>${r.status === 'review' ? `<button class="btn" data-redo="${r.id}">🎙️ إعادة</button>` : ''}<button class="btn alt" data-rd="${r.id}">🗑️ حذف</button></div>`).join('') : ''}
  <h2>مطلوب منك</h2>` + (mine.length ? mine.map(a => `<div class="card task"><div class="grow"><b>${E(IT[a.id].t)}</b><div class="m">الموعد: ${E(dueInfo(a).label)}</div></div>${dueTag(a)}<button class="btn" data-o="${a.id}">ابدأ</button></div>`).join('') : `<div class="card">لا مهام الآن. اختر مادة من القائمة.</div>`) +
    `<h2>موادي</h2><div class="grid">${SECS.map(x => {
      const it = D.items.filter(i => i.sec === x.id && LV.indexOf(i.lv) <= LV.indexOf(s.lv));
      return `<button class="sub" data-sec="${x.id}"><span class="em">${x.icon}</span><b>${x.t}</b><div class="m">${N(it.filter(i => done[s.id].has(i.id)).length)} / ${N(it.length)}</div></button>`;
    }).join('')}<button class="sub" data-q="1"><span class="em">📖</span><b>القرآن</b><div class="m">رواية حفص</div></button></div>`;
  app.querySelectorAll('[data-o]').forEach(b => b.onclick = () => go({p: 'lesson', id: b.dataset.o, back: view}));
  app.querySelectorAll('[data-quiz]').forEach(b => b.onclick = () => quizDlg(+b.dataset.quiz));
  app.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => deleteRecitation(+b.dataset.rd));
  wireLate(); wireRedo();
  app.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => go({p: 'sec', sec: b.dataset.sec}));
  app.querySelector('[data-q]').onclick = () => go({p: 'quran'});
}
function ssec() {
  const s = me();
  if (!s) { app.innerHTML = `<div class="card">لا يوجد طلاب بعد.</div>`; return; }
  const x = SECS.find(z => z.id === view.sec);
  app.innerHTML = `<h1>${x.icon} ${x.t}</h1>` + D.items.filter(i => i.sec === x.id).map(i => {
    const lock = LV.indexOf(i.lv) > LV.indexOf(s.lv), ok = done[s.id].has(i.id);
    return `<div class="card it"><div class="grow"><b>${E(i.t)}</b> <span class="tag">${i.lv}</span> ${ok ? '✓' : ''}${lock ? ' 🔒' : ''}</div><button class="btn" data-o="${i.id}" ${lock ? 'disabled' : ''}>${ok ? 'راجع' : 'ابدأ'}</button></div>`;
  }).join('') + `<p class="note">🔒 يُفتح المستوى التالي بعد أن يرقّيك معلمك.</p>`;
  app.querySelectorAll('[data-o]').forEach(b => b.onclick = () => go({p: 'lesson', id: b.dataset.o, back: view}));
}

/* ---------- Quiz, games, lesson ---------- */
function quiz(items, fin) {
  const box = document.createElement('div');
  let n = 0, sc = 0;
  items.forEach(q => {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = (q.top ? `<p class="m">${E(q.top)}</p>` : '') + (q.big ? `<div class="bigq ar">${E(q.big)}</div>` : '') + (q.q ? `<b>${E(q.q)}</b>` : '') + `<div class="opts"></div><div></div>`;
    const ob = c.children[c.children.length - 2];
    q.o.forEach((t, k) => {
      const b = document.createElement('button');
      b.className = 'opt'; b.textContent = t;
      b.onclick = () => {
        ob.querySelectorAll('.opt').forEach((x, j) => { x.disabled = true; if (j === q.a) { x.classList.add('ok'); x.textContent = '✓ ' + x.textContent; } });
        const ok = k === q.a;
        if (ok) sc++; else { b.classList.add('no'); b.textContent = '✗ ' + b.textContent; }
        c.lastChild.innerHTML = `<div class="fb"><b>${ok ? 'أحسنت!' : 'لا بأس، لنتعلّم معاً.'}</b> ${E(q.whys ? q.whys[k] : (q.why || ''))}</div>`;
        if (++n === items.length) fin(sc);
      };
      ob.appendChild(b);
    });
    box.appendChild(c);
  });
  return box;
}
const R5 = ['إظهار', 'إدغام بغنة', 'إدغام بلا غنة', 'إقلاب', 'إخفاء'];
function gameItems(g) {
  const G = D.games;
  if (g === 'taj') return sh(G.taj).slice(0, 8).map(x => ({top: 'ما حكم النون الساكنة أو التنوين؟ (' + x.loc + ')', big: x.w, o: R5, a: R5.indexOf(x.ans), why: x.hint + '.'}));
  if (g === 'verse') return sh(G.verse).slice(0, 8).map(x => {
    const o = sh(x.opts.map((t, k) => ({t, k: k === x.ans})));
    return {top: 'اختر الكلمة الناقصة (' + x.loc + ')', big: (x.pre ? x.pre + ' ' : '') + 'ـــــــ' + (x.post ? ' ' + x.post : ''), o: o.map(z => z.t), a: o.findIndex(z => z.k), why: 'الآية كاملة: ' + [x.pre, x.opts[x.ans], x.post].filter(Boolean).join(' ')};
  });
  return sh(G.adab).slice(0, 8).map(x => ({top: x.sc, big: x.ch, o: ['تصرّف حسن', 'ليس الأحسن'], a: x.ok ? 0 : 1, why: x.fb + ' ' + x.adab}));
}
const NJ = 'ادذرزو', Z = '\u200d';
function lesson() {
  const it = IT[view.id], prev = mode === 'T';
  let b = '', qs = null, manual = false;
  if (it.kind === 'taj') {
    b = `<div class="card"><b>الهدف:</b> ${E(it.goal)}</div>` + it.expl.map(p => `<div class="card">${E(p)}</div>`).join('') + `<h2>نقاط مهمة</h2><div class="card">${it.keys.map(k => '• ' + E(k)).join('<br>')}</div>` + (it.ex.length ? `<h2>أمثلة من القرآن</h2>` + it.ex.map(e => `<div class="card"><b>${E(e.text)}</b> ${e.note ? '<span class="tag">' + E(e.note) + '</span>' : ''}<div class="m">${E(e.loc)}</div><div class="ex ar">${E(e.v)}</div></div>`).join('') : '');
    qs = it.quiz;
  } else if (it.kind === 'story') {
    b = `<div class="card">${E(it.intro)}</div>` + it.scenes.map((t, i) => `<div class="card"><span class="tag">${N(i + 1)}</span> ${E(t)}</div>`).join('') + `<div class="fb"><b>ماذا نتعلم؟</b> ${E(it.learn)}<br><b>أطبّق اليوم:</b> ${E(it.apply)}</div>`;
    qs = it.quiz;
  } else if (it.kind === 'adab') {
    b = `<div class="card">${E(it.scen)}</div>` + `<div class="card" id="ad"></div>`;
    qs = [{q: 'ماذا تفعل؟', o: it.ch.map(c => c.t), a: it.ch.findIndex(c => c.ok), whys: it.ch.map(c => c.fb + ' ' + it.adab)}];
  } else if (it.kind === 'ltr') {
    manual = true;
    b = it.letters.map(l => {
      const f = NJ.includes(l.c) ? [['منفرد', l.c], ['آخر', Z + l.c]] : [['منفرد', l.c], ['أول', l.c + Z], ['وسط', Z + l.c + Z], ['آخر', Z + l.c]];
      return `<div class="card"><div class="big ar">${l.c}</div><div class="forms">${f.map(([n, t]) => `<div><b class="ar">${t}</b><span class="m">${n}</span></div>`).join('')}</div><div class="wd"><span class="em">${l.e}</span><span class="ar"><mark>${l.w[0]}</mark>${E(l.w.slice(1))}</span></div></div>`;
    }).join('');
  } else {
    qs = gameItems(it.g);
  }
  app.innerHTML = `<div class="top row"><button class="btn alt" id="bk">رجوع</button><div class="grow m">${prev ? 'معاينة المعلم: لا تُسجَّل النتائج' : ''}</div></div><h1>${E(it.t)}</h1>` + b + (it.kind === 'adab' ? `<h2>الدليل</h2>` + it.qr.map(q => `<div class="card"><div class="m">${E(q.loc)}</div><div class="ex ar">${E(q.text)}</div></div>`).join('') + `<div class="card"><b>أحفظ:</b> ${E(it.mem)}<br><b>أطبّق هذا الأسبوع:</b> ${E(it.week)}</div>` : '') + `<div id="qz"></div><div id="fin"></div>` + (prev && it.tn ? `<div class="fb"><b>ملاحظة للمعلم:</b> ${E(it.tn)}</div>` : '');
  $('#bk').onclick = () => go(view.back || {p: 'home'});
  const fin = () => {
    if (!prev && sid && !done[sid].has(it.id)) { done[sid].add(it.id); toast('أحسنت! أُضيف فانوس 🏮'); persistCompletion(it.id); }
    $('#fin').innerHTML = `<div class="fb"><b>${prev ? 'انتهت المعاينة.' : 'أنهيتَ الدرس 🏮'}</b></div>`;
  };
  if (it.kind === 'adab') $('#ad').remove();
  if (qs) $('#qz').appendChild(quiz(qs, fin));
  if (manual) {
    $('#qz').innerHTML = `<button class="btn" id="dn">${prev ? '(في المنصة يؤكد المعلم الإتقان)' : 'أتقنتُ هذه الحروف'}</button>`;
    $('#dn').onclick = fin;
  }
}

/* ---------- Quran ---------- */
const RECITERS = [
  ['ar.alafasy', 'مشاري العفاسي'],
  ['ar.husary', 'محمود خليل الحصري'],
  ['ar.minshawi', 'محمد صديق المنشاوي']
];
const RECT = {pending: 'قيد المراجعة', approved: 'مقبولة', review: 'تحتاج إعادة'};
const recWhere = r => `${N(r.surah)}. ${E(D.q[r.surah - 1]?.name || r.surah)} — ${r.scope === 'surah' ? 'السورة كاملة' : 'الآية ' + N(r.ayah)}`;
function recLessons(r) {
  if (!r) return [];
  if (r.scope === 'surah') {
    const len = D.q[r.surah - 1]?.v.length || 1;
    return [...new Set(Array.from({length: len}, (_, i) => lessonsFor(r.surah, i + 1)).flat())];
  }
  return lessonsFor(r.surah, r.ayah);
}

/* ---------- تسجيل تلاوة الطالب (آية أو سورة كاملة) ---------- */
function reciteDlg(surah, ayah, surahName, scope = 'ayah') {
  const d = $('#dlg'), full = scope === 'surah';
  const cand = recLessons({surah, ayah, scope});
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">${full ? 'تسجيل السورة كاملة' : 'تسجيل تلاوة'}</h2><p class="m">${E(surahName)} — ${full ? 'السورة كاملة' : 'الآية ' + N(ayah)}</p>` +
    `<p class="m" style="margin:6px 0">بعد اعتماد المعلّم ستجري اختباراً قصيراً (${N(cand.length)} سؤال) لتحديد الدرس أو الدروس التي تُضاف لإنجازك.</p>` +
    `<div class="card" id="rstat">اضغط «ابدأ التسجيل» ثم ${full ? 'تلا السورة من أولها إلى آخرها' : 'تلا الآية'} بصوت واضح.</div><div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn" id="rgo">ابدأ التسجيل</button><button class="btn alt" id="rsend" disabled>إرسال للمعلّم</button><button class="btn alt" id="rx">إغلاق</button></div>`;
  d.showModal();
  const stat = $('#rstat'), goBtn = $('#rgo'), sendBtn = $('#rsend');
  let mr = null, stream = null, chunks = [], blob = null;
  const ext = t => /mp4/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : /wav/.test(t) ? 'wav' : 'webm';
  const stopStream = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
  $('#rx').onclick = () => { if (mr?.state === 'recording') mr.stop(); stopStream(); d.close(); };
  goBtn.onclick = async () => {
    if (mr?.state === 'recording') { mr.stop(); return; }
    try {
      stopStream(); chunks = []; blob = null; sendBtn.disabled = true;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('هذا المتصفح لا يدعم تسجيل الصوت');
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const rec = new MediaRecorder(stream); mr = rec;
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stopStream();
        blob = new Blob(chunks, {type: rec.mimeType || 'audio/webm'});
        if (!blob.size) { stat.textContent = 'لم يُسجَّل صوت. حاول مرة أخرى.'; return; }
        if (blob.size > 5 * 1024 * 1024) { stat.textContent = 'التسجيل كبير جداً (أكثر من 5 ميغابايت). أعد التسجيل بمدة أقصر.'; blob = null; return; }
        stat.textContent = `تم التسجيل (${N(Math.round(blob.size / 1024))} كيلوبايت). أرسله للمعلّم أو أعد التسجيل.`;
        sendBtn.disabled = false;
        goBtn.textContent = 'إعادة التسجيل';
      };
      rec.start();
      stat.textContent = full ? 'جارٍ التسجيل... تلا السورة ثم اضغط «إيقاف التسجيل».'
        : 'جارٍ التسجيل... اقرأ الآية ثم اضغط «إيقاف التسجيل».';
      goBtn.textContent = 'إيقاف التسجيل';
    } catch (err) {
      stat.textContent = 'تعذّر التسجيل: ' + err.message;
      stopStream();
    }
  };
  sendBtn.onclick = async () => {
    if (!blob || !sid) return;
    sendBtn.disabled = true;
    const path = `${sid}/${surah}-${full ? 'full' : ayah}-${Date.now()}.${ext(blob.type)}`;
    const {error: ue} = await sb.storage.from('recitations').upload(path, blob, {contentType: (blob.type || 'audio/webm').split(';')[0], upsert: false});
    if (ue) { toast('تعذّر رفع التلاوة: ' + ue.message); sendBtn.disabled = false; return; }
    const {data, error: ie} = await sb.from('recitations')
      .insert({student_id: sid, surah, ayah: full ? 1 : ayah, scope,
               storage_path: path, status: 'pending'})
      .select().single();
    if (ie) {
      await sb.storage.from('recitations').remove([path]);
      toast('تعذّر حفظ التلاوة: ' + ie.message); sendBtn.disabled = false; return;
    }
    recitations.unshift(data);
    d.close(); toast('أُرسلت التلاوة بانتظار مراجعة المعلّم');
  };
}

/* ---------- اختبار قصير يحدد دروس التلاوة المقبولة ---------- */
function quizQuestions(r) {
  return recLessons(r).map(id => {
    const it = IT[id], q = it?.quiz?.[0];
    if (!q || !q.o?.length) return null;
    return {id, title: it.t, q: q.q, why: q.why || '', correct: q.a,
            opts: sh(q.o.map((text, i) => ({text, i})))};
  }).filter(Boolean);
}
function quizTag(r) {
  if (r.quiz_passed) return `<span class="tag ok">📝 نجح ${N(r.quiz_correct)}/${N(r.quiz_total)}</span>`;
  if (r.quiz_at) return `<span class="tag late">📝 أعد ${N(r.quiz_correct)}/${N(r.quiz_total)}</span>`;
  if (r.status === 'approved') return `<span class="tag w">📝 بانتظار الاختبار</span>`;
  return '';
}
function quizDlg(id) {
  const r = recitations.find(x => x.id === id);
  if (!r || r.status !== 'approved') return;
  const qs = quizQuestions(r);
  if (!qs.length) { toast('لا يوجد اختبار مرتبط بهذه التلاوة'); return; }
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">اختبار قصير: ${recWhere(r)}</h2>` +
    `<p class="m" style="margin:4px 0 10px">لكل إجابة صحيحة يُضاف درسها إلى إنجازك. يمكنك إعادة الاختبار إذا لم تُصب أي إجابة.</p>` +
    qs.map((q, i) => `<div class="card" data-quizq="${i}"><b>${N(i + 1)}. ${E(q.q)}</b><div class="m">من درس: ${E(q.title)}</div>` +
      q.opts.map(o => `<label class="opt" style="display:flex;gap:8px;align-items:center"><input type="radio" name="q${i}" value="${o.i}"><span>${E(o.text)}</span></label>`).join('') +
      `<div class="fb" data-fb="${i}" hidden></div></div>`).join('') +
    `<div class="row" style="margin-top:12px"><button class="btn" id="qok">إرسال الإجابات</button><button class="btn alt" id="qx">إغلاق</button></div>`;
  d.showModal();
  $('#qx').onclick = () => d.close();
  const submit = $('#qok');
  const check = async () => {
    const answers = qs.map((q, i) => {
      const sel = d.querySelector(`input[name="q${i}"]:checked`);
      const val = sel ? +sel.value : -1;
      return {q, ok: val === q.correct};
    });
    answers.forEach((a, i) => {
      const fb = d.querySelector(`[data-fb="${i}"]`);
      fb.hidden = false;
      fb.className = 'fb ' + (a.ok ? 'ok' : 'no');
      fb.textContent = a.ok
        ? `✅ إجابة صحيحة — أُضيف درس «${a.q.title}».`
        : `❌ الإجابة الصحيحة: ${a.q.opts.find(o => o.i === a.q.correct)?.text || ''}${a.q.why ? ' — ' + a.q.why : ''}`;
    });
    const lessons = answers.filter(a => a.ok).map(a => a.q.id);
    submit.disabled = true;
    const {error} = await sb.rpc('submit_recitation_quiz', {
      p_recitation_id: r.id, p_lessons: lessons,
      p_correct: lessons.length, p_total: qs.length
    });
    if (error) { toast('تعذّر حفظ الاختبار: ' + error.message); submit.disabled = false; return; }
    Object.assign(r, {quiz_lessons: lessons, quiz_correct: lessons.length,
      quiz_total: qs.length, quiz_passed: lessons.length > 0, quiz_at: new Date().toISOString()});
    lessons.forEach(l => done[r.student_id]?.add(l));
    toast(lessons.length ? `أُضيف ${N(lessons.length)} درس لإنجازك 🏮` : 'لم تُصب أي إجابة. يمكنك إعادة الاختبار.');
    if (lessons.length) {
      submit.disabled = false;
      submit.textContent = 'إغلاق';
      submit.onclick = () => { d.close(); render(); };
    } else {
      submit.textContent = 'إعادة المحاولة';
      submit.disabled = false;
      submit.onclick = check;
    }
  };
  submit.onclick = check;
}

/* ---------- حذف التلاوة قبل المراجعة (الطالب فقط) ---------- */
async function deleteRecitation(id) {
  const r = recitations.find(x => x.id === id);
  if (!r || r.status === 'approved') return;
  if (!confirm('حذف هذه التلاوة؟ يمكنك تسجيلها من جديد.')) return;
  // حذف السجل أولاً؛ سياسة التخزين تسمح بحذف الملف بعد أن يصبح يتيماً
  const {error} = await sb.from('recitations').delete().eq('id', id);
  if (error) { toast('تعذّر حذف التلاوة: ' + error.message); return; }
  const {error: se} = await sb.storage.from('recitations').remove([r.storage_path]);
  if (se) console.error('تعذّر حذف ملف التلاوة:', se);
  recitations = recitations.filter(x => x.id !== id);
  toast('تم حذف التلاوة');
  render();
}

/* ---------- مراجعة التلاوات (المعلّم) ---------- */
function trec() {
  const list = recitations.slice();
  const pending = list.filter(r => r.status === 'pending').length;
  const redo = redoRequests();
  app.innerHTML = `<h1>التلاوات</h1><div class="row" style="margin-bottom:10px"><div class="grow m">${N(list.length)} تسجيل · ${N(pending)} بانتظار المراجعة · ${N(redo.length)} إعادة مطلوبة</div><button class="btn alt" id="rf">تحديث</button></div>` +
    lateRecPanel(lateRecitations()) +
    redoPanel(redo) +
    (list.length ? list.map(r => {
      const s = students.find(x => x.id === r.student_id);
      const ln = r.lesson_id ? (IT[r.lesson_id]?.t || r.lesson_id) : '';
      return `<div class="card"><div class="row"><div class="grow"><b>${E(s?.n || r.student_id)}</b> <span class="tag">${recWhere(r)}</span>${ln ? ` <span class="tag">📘 ${E(ln)} (قديم)</span>` : ''}${quizTag(r)} <span class="tag ${r.status === 'approved' ? '' : 'w'}">${RECT[r.status] || r.status}</span><div class="m">${new Date(r.created_at).toLocaleString('ar-EG')}${r.teacher_note ? ' · ' + E(r.teacher_note) : ''}</div></div></div><audio controls data-rec="${r.id}" style="width:100%;margin:10px 0"></audio><div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn" data-ap="${r.id}">اعتماد</button><button class="btn alt" data-rv="${r.id}">يحتاج إعادة</button></div></div>`;
    }).join('') : `<div class="card">لا توجد تلاوات بعد. يستطيع الطالب تسجيل تلاوته من صفحة القرآن.</div>`);
  $('#rf').onclick = () => loadData().then(render);
  wireLate(); wireRedo();
  list.forEach(async r => {
    const {data, error} = await sb.storage.from('recitations').createSignedUrl(r.storage_path, 3600);
    const el = app.querySelector(`[data-rec="${r.id}"]`);
    if (!error && data?.signedUrl && el) el.src = data.signedUrl;
    else if (error && el) el.outerHTML = `<p class="m">تعذّر تحميل التلاوة: ${E(error.message)}</p>`;
  });
  const review = async (id, status) => {
    const note = status === 'approved'
      ? (prompt('ملاحظة للمعلّم (اختياري):', '') || '')
      : (prompt('سبب الإعادة (مثلاً: مخارج الحروف):', '') || '');
    const reviewed_at = new Date().toISOString();
    const {error} = await sb.from('recitations')
      .update({status, teacher_note: note, reviewed_at}).eq('id', id);
    if (error) { toast('تعذّر حفظ المراجعة: ' + error.message); return; }
    const r = recitations.find(x => x.id === id);
    if (r) Object.assign(r, {status, teacher_note: note, reviewed_at});
    const legacy = r?.lesson_id && status === 'approved';
    if (legacy) done[r.student_id]?.add(r.lesson_id);
    toast(status === 'approved'
      ? (legacy ? 'تم الاعتماد وأُضيف إنجاز الدرس 🏮' : 'تم الاعتماد — على الطالب إجراء الاختبار القصير 📝')
      : 'تم تسجيل ملاحظة الإعادة — سيظهر تنبيه للطالب 🔁');
    render();
  };
  app.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => review(+b.dataset.ap, 'approved'));
  app.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => review(+b.dataset.rv, 'review'));
}

function quran() {
  let n = view.n || 1, hide = false;
  let reciter = localStorage.getItem('manara.reciter') || 'ar.alafasy';
  let rate = +(localStorage.getItem('manara.rate') || 1);
  let auto = localStorage.getItem('manara.auto') === '1';
  const audio = new Audio();
  audio.preload = 'none';
  audio.style.display = 'none';
  let current = null, keys = [], playToken = 0;
  const src = g => `https://cdn.islamic.network/quran/audio/128/${reciter}/${g}.mp3`;

  function sync() {
    app.querySelectorAll('[data-akey]').forEach(b => {
      const on = !!current && b.dataset.akey === current.key && !audio.paused;
      b.classList.toggle('on', on);
      b.textContent = on ? '❚❚' : '▶';
      b.setAttribute('aria-label', on ? 'إيقاف التلاوة' : 'تشغيل التلاوة');
    });
  }
  function stop() { playToken++; audio.pause(); audio.currentTime = 0; current = null; sync(); }
  function play(g, key, chain = false) {
    if (!chain && current?.key === key && !audio.paused) { stop(); return; }
    const token = ++playToken;
    current = {g, key};
    audio.src = src(g);
    audio.playbackRate = rate;
    audio.play()
      .then(() => { if (token === playToken) sync(); })
      .catch(err => {
        if (token !== playToken) return;
        toast('تعذّر تشغيل التلاوة: ' + err.message);
        current = null; sync();
      });
    sync();
  }
  audio.onended = () => {
    if (!auto || !current) { current = null; sync(); return; }
    const i = keys.findIndex(k => k.key === current.key), nx = keys[i + 1];
    if (nx) play(nx.g, nx.key, true); else { current = null; sync(); }
  };
  audio.onerror = () => { toast('تعذّر تحميل التلاوة. جرّب قارئاً آخر أو تحقق من الاتصال.'); current = null; sync(); };

  function draw() {
    const s = D.q[n - 1];
    const surRec = !isTeacher() && sid
      ? recitations.filter(r => r.student_id === sid && r.surah === n && r.scope === 'surah').slice(-1)[0]
      : null;
    const base = D.q.slice(0, n - 1).reduce((a, x) => a + x.v.length, 0);
    keys = s.v.map((_, i) => ({g: base + i + 1, key: 'ay' + i}));
    app.innerHTML = `<h1>القرآن (رواية حفص)</h1>
      ${!isTeacher() && sid ? redoPanel(redoRequests(sid), 'student') : ''}
      <div class="row qbar">
        <select id="sf" aria-label="السورة">${D.q.map(x => `<option value="${x.id}" ${x.id === n ? 'selected' : ''}>${N(x.id)}. ${x.name}</option>`).join('')}</select>
        <label>القارئ <select id="rc" aria-label="القارئ">${RECITERS.map(([id, name]) => `<option value="${id}" ${id === reciter ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
        <label>السرعة <select id="rt" aria-label="سرعة التلاوة">${[0.75, 1, 1.25, 1.5].map(v => `<option value="${v}" ${v === rate ? 'selected' : ''}>${v}×</option>`).join('')}</select></label>
        <label><input type="checkbox" id="au" ${auto ? 'checked' : ''}> تتابع تلقائي</label>
        <button class="btn alt" id="plall">▶ تلاوة السورة</button><button class="btn alt" id="stp">■ إيقاف</button>
        ${!isTeacher() && sid ? `<button class="btn" id="rsur">🎙️ تسجيل السورة كاملة</button>${surRec ? `<span class="tag">${RECT[surRec.status] || surRec.status}</span>${surRec.status === 'approved' && !surRec.quiz_passed ? `<button class="btn mini" id="qzs" title="اختبار قصير لتحديد الدرس">📝 اختبار</button>` : ''}${surRec.status !== 'approved' ? `<button class="btn alt mini" id="drs" title="حذف تسجيل السورة">🗑️</button>` : ''}` : ''}` : ''}
        <label style="margin-inline-start:auto"><input type="checkbox" id="hd" ${hide ? 'checked' : ''}> وضع الحفظ: إخفاء الآيات (اضغط على الآية لإظهارها)</label>
      </div>
      <div class="card ar qtxt" id="qt" style="margin-top:12px"></div>
      <p class="note">نص القرآن: مشروع Tanzil (tanzil.net)، رواية حفص، دون أي تعديل. التلاوة من خدمة التلاوة القرآنية (cdn.islamic.network) بالقارئ المختار، وتحتاج اتصالاً بالإنترنت. للطالب: زر 🎙️ بجانب كل آية، أو «🎙️ تسجيل السورة كاملة» أعلى الصفحة، يرسل التسجيل إلى المعلّم للمراجعة؛ وبعد الاعتماد يُجري اختباراً قصيراً يُحدد الدرس الذي يُضاف لسجل الإنجاز. لم تُراجَع النصوص بعد من مختص.</p>`;
    const qt = $('#qt');
    if (n !== 1 && n !== 9) {
      const wrap = document.createElement('div'); wrap.className = 'row basm-row';
      const p = document.createElement('span'); p.className = 'ar'; p.textContent = D.basm;
      const b = document.createElement('button'); b.className = 'btn alt mini'; b.dataset.akey = 'basm'; b.dataset.g = '1'; b.textContent = '▶'; b.title = 'استمع إلى البسملة'; b.setAttribute('aria-label', 'استمع إلى البسملة');
      wrap.append(p, b); qt.appendChild(wrap);
    }
    s.v.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 'ay-row';
      const sp = document.createElement('span');
      sp.className = 'ay' + (hide ? ' hid' : '');
      sp.textContent = t + ' ﴿' + N(i + 1) + '﴾ ';
      sp.onclick = () => sp.classList.toggle('hid');
      const b = document.createElement('button'); b.className = 'btn alt mini'; b.dataset.akey = 'ay' + i; b.dataset.g = keys[i].g; b.textContent = '▶'; b.title = 'استمع إلى الآية ' + N(i + 1); b.setAttribute('aria-label', 'استمع إلى الآية ' + N(i + 1));
      row.append(sp, b);
      if (!isTeacher() && sid) {
        const rb = document.createElement('button'); rb.className = 'btn alt mini'; rb.textContent = '🎙️'; rb.title = 'سجّل تلاوة هذه الآية'; rb.setAttribute('aria-label', 'سجّل تلاوة الآية ' + N(i + 1));
        rb.onclick = () => reciteDlg(n, i + 1, s.name);
        row.appendChild(rb);
      }
      const mine = recitations.filter(r => r.surah === n && r.ayah === i + 1 && r.scope !== 'surah').slice(-1)[0];
      if (mine) {
        const tag = document.createElement('span'); tag.className = 'tag'; tag.style.alignSelf = 'center'; tag.textContent = RECT[mine.status] || mine.status;
        row.appendChild(tag);
        if (!isTeacher() && sid && mine.status === 'approved' && !mine.quiz_passed) {
          const qb = document.createElement('button'); qb.className = 'btn mini'; qb.textContent = '📝 اختبار';
          qb.title = 'اختبار قصير لتحديد الدرس'; qb.setAttribute('aria-label', 'اختبار تلاوة الآية ' + N(i + 1));
          qb.onclick = () => quizDlg(mine.id);
          row.appendChild(qb);
        }
        if (!isTeacher() && sid && mine.status !== 'approved') {
          const db = document.createElement('button'); db.className = 'btn alt mini'; db.textContent = '🗑️';
          db.title = 'حذف التلاوة قبل المراجعة'; db.setAttribute('aria-label', 'حذف تلاوة الآية ' + N(i + 1));
          db.onclick = () => deleteRecitation(mine.id);
          row.appendChild(db);
        }
      }
      qt.appendChild(row);
    });
    app.appendChild(audio);
    qt.querySelectorAll('[data-g]').forEach(b => b.onclick = () => play(+b.dataset.g, b.dataset.akey));
    $('#sf').onchange = e => { n = +e.target.value; view.n = n; stop(); draw(); };
    $('#rc').onchange = e => { reciter = e.target.value; localStorage.setItem('manara.reciter', reciter); stop(); };
    $('#rt').onchange = e => { rate = +e.target.value; localStorage.setItem('manara.rate', String(rate)); audio.playbackRate = rate; };
    $('#au').onchange = e => { auto = e.target.checked; localStorage.setItem('manara.auto', auto ? '1' : '0'); };
    $('#hd').onchange = e => { hide = e.target.checked; draw(); };
    $('#plall').onclick = () => { if (keys[0]) play(keys[0].g, keys[0].key); };
    $('#stp').onclick = stop;
    if ($('#rsur')) $('#rsur').onclick = () => reciteDlg(n, 1, s.name, 'surah');
    if ($('#qzs')) $('#qzs').onclick = () => quizDlg(surRec.id);
    if ($('#drs')) $('#drs').onclick = () => deleteRecitation(surRec.id);
    wireRedo();
    sync();
  }
  draw();
}

boot();
