import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { D } from './data.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured = SUPABASE_URL.includes('supabase.co') && !SUPABASE_ANON_KEY.startsWith('YOUR_');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const IT = Object.fromEntries(D.items.map(i => [i.id, i])),
      SECS = D.secs,
      LV = ['مبتدئ', 'متوسط', 'متقدم'];
const $ = s => document.querySelector(s),
      app = $('#app'),
      N = n => (+n).toLocaleString('ar-EG');
const E = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const sh = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const auth = $('#auth');
let students = [], done = {}, assigns = [];
let mode = 'T', sid = null, view = {p: 'home'}, user = null;

function toast(t) {
  const e = $('#toast');
  e.textContent = t;
  e.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => e.classList.remove('show'), 2600);
}

/* ---------- Supabase layer ---------- */
async function loadData() {
  const [{data: st, error: e1}, {data: cp, error: e2}, {data: as, error: e3}] = await Promise.all([
    sb.from('students').select('*').order('id'),
    sb.from('completions').select('*'),
    sb.from('assignments').select('*').order('created_at')
  ]);
  if (e1 || e2 || e3) {
    console.error(e1 || e2 || e3);
    toast('تعذّر تحميل البيانات من Supabase');
  }
  students = (st || []).map(r => ({id: r.id, n: r.name, lv: r.level}));
  done = Object.fromEntries(students.map(s => [s.id, new Set()]));
  (cp || []).forEach(r => { if (done[r.student_id]) done[r.student_id].add(r.lesson_id); });
  assigns = (as || []).map(r => ({dbId: r.id, id: r.lesson_id, to: r.target, due: r.due || 'بلا موعد'}));
  if (!students.find(s => s.id === sid)) sid = students[0]?.id || null;
}

async function persistCompletion(lessonId) {
  const {error} = await sb.from('completions')
    .upsert({student_id: sid, lesson_id: lessonId}, {onConflict: 'student_id,lesson_id'});
  if (error) { console.error(error); toast('تعذّر حفظ الإنجاز: ' + error.message); }
}

async function persistAssign(a) {
  const {error} = await sb.from('assignments')
    .insert({lesson_id: a.id, target: a.to, due: a.due});
  if (error) { console.error(error); toast('تعذّر حفظ الإسناد: ' + error.message); }
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
    {lesson_id: 's-hira', target: 'all', due: 'الخميس'},
    {lesson_id: 't-noon-tanween', target: 's1', due: 'السبت'}
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
$('#sup').onclick = async () => {
  const email = $('#em').value.trim(), password = $('#pw').value;
  const {data, error} = await sb.auth.signUp({email, password});
  if (error) { $('#amsg').textContent = error.message; return; }
  $('#amsg').textContent = data.session
    ? 'تم إنشاء الحساب. أهلاً بك!'
    : 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني ثم سجّل الدخول.';
};
$('#out').onclick = async () => {
  await sb.auth.signOut();
  students = []; done = {}; assigns = [];
  mode = 'T'; sid = null; view = {p: 'home'}; user = null;
  showAuth();
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
  $('#bT').classList.toggle('on', mode === 'T');
  $('#bS').classList.toggle('on', mode === 'S');
  $('#st').style.display = mode === 'S' ? '' : 'none';
  $('#st').innerHTML = students.map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${E(s.n)}</option>`).join('');
  side();
  ({home: () => mode === 'T' ? thome() : shome(), students: tstud, cur: tcur, tasks: ttasks, reports: treports, quran, sec: ssec, lesson})[view.p]();
}
function side() {
  const it = mode === 'T'
    ? [['home', 'الرئيسية'], ['students', 'الطلاب'], ['cur', 'المنهج'], ['tasks', 'المهام'], ['reports', 'التقارير'], ['quran', 'القرآن']]
    : [['home', 'الرئيسية'], ['quran', 'القرآن'], ...SECS.map(s => ['sec:' + s.id, s.icon + ' ' + s.t])];
  const cur = view.p === 'sec' ? 'sec:' + view.sec : view.p;
  $('#side').innerHTML = `<div class="nv">` + it.map(([k, t]) => `<button data-k="${k}" class="${cur === k ? 'on' : ''}">${t}</button>`).join('') + `</div>`;
  $('#side').querySelectorAll('button').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    go(k.startsWith('sec:') ? {p: 'sec', sec: k.slice(4)} : {p: k});
  });
}
$('#bT').onclick = () => { mode = 'T'; go({p: 'home'}); };
$('#bS').onclick = () => { mode = 'S'; go({p: 'home'}); };
$('#st').onchange = e => { sid = e.target.value; go({p: 'home'}); };

/* ---------- Teacher views ---------- */
function thome() {
  const rd = students.filter(s => prog(s).pct >= 80 && s.lv !== 'متقدم');
  const tot = assigns.reduce((a, x) => a + tgt(x).length, 0),
        dn = assigns.reduce((a, x) => a + tgt(x).filter(s => done[s.id].has(x.id)).length, 0);
  app.innerHTML = `<h1>أهلاً بك يا معلم</h1><div class="stats"><div class="card stat"><b>${N(students.length)}</b><span>طالب</span></div><div class="card stat"><b>${N(assigns.length)}</b><span>مهمة مُسندة</span></div><div class="card stat"><b>${N(dn)} / ${N(tot)}</b><span>تسليمات أُنجزت</span></div><div class="card stat"><b>${N(rd.length)}</b><span>جاهزون للترقية</span></div></div>` +
    (rd.length ? `<div class="card" style="border:2px solid var(--lamp)"><b>أنهوا معظم مستواهم</b>${rd.map(s => `<div class="row" style="margin-top:6px"><span class="grow">${E(s.n)} (${prog(s).pct}%)</span><button class="btn lamp" data-up="${s.id}">ترقية إلى ${LV[LV.indexOf(s.lv) + 1]}</button></div>`).join('')}</div>` : '') +
    (students.length ? `<div class="card"><p style="margin:0 0 10px">من «المنهج» تعاين الدروس وتسندها، ومن «الطلاب» ترى تقدم كل طالب.</p><button class="btn" id="g1">فتح المنهج</button></div>`
      : `<div class="card"><p style="margin:0 0 10px">لا يوجد طلاب بعد. يمكنك البدء بالبيانات التجريبية.</p><button class="btn" id="seed">تحميل بيانات تجريبية</button></div>`);
  if ($('#g1')) $('#g1').onclick = () => go({p: 'cur'});
  if ($('#seed')) $('#seed').onclick = seedDemo;
  app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const s = students.find(x => x.id === b.dataset.up);
    s.lv = LV[LV.indexOf(s.lv) + 1];
    toast('تمت الترقية');
    render();
    persistPromotion(s);
  });
}
function tstud() {
  app.innerHTML = `<h1>الطلاب</h1><div class="row" style="margin-bottom:10px"><div class="grow m">${N(students.length)} طالب مسجّل</div><button class="btn" id="adds">+ إضافة طالب</button></div><div class="card tbl"><table><thead><tr><th>الطالب</th><th>المستوى</th><th>التقدم في مستواه</th><th>أنجز</th><th>إجراءات</th></tr></thead><tbody>${students.map(s => {
    const p = prog(s);
    return `<tr><td><b>${E(s.n)}</b></td><td><span class="tag">${s.lv}</span></td><td><div class="bar" title="${p.pct}%"><i style="width:${p.pct}%"></i></div></td><td>${N(done[s.id].size)} درساً</td><td class="row" style="gap:4px;flex-wrap:wrap"><button class="btn alt" data-v="${s.id}">عرض</button><button class="btn alt" data-e="${s.id}">تعديل</button><button class="btn alt" data-d="${s.id}">حذف</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
  app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { mode = 'S'; sid = b.dataset.v; go({p: 'home'}); });
  app.querySelectorAll('[data-e]').forEach(b => b.onclick = () => studentDlg(b.dataset.e));
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
  d.innerHTML = `<h2 style="margin-top:0;color:var(--ink)">إسناد: ${E(IT[id].t)}</h2><label>إلى</label><select id="to"><option value="all">كل الطلاب</option>${students.map(s => `<option value="${s.id}">${E(s.n)} (${s.lv})</option>`).join('')}</select><label>الموعد</label><input id="due" type="text" placeholder="مثلاً: الخميس"><div class="row" style="margin-top:14px"><button class="btn" id="ok">إسناد</button><button class="btn alt" id="x">إلغاء</button></div>`;
  d.showModal();
  $('#x').onclick = () => d.close();
  $('#ok').onclick = () => {
    const a = {id, to: $('#to').value, due: $('#due').value || 'بلا موعد'};
    assigns.push(a);
    d.close();
    toast('تم الإسناد');
    go({p: 'tasks'});
    persistAssign(a);
  };
}
function ttasks() {
  app.innerHTML = `<h1>المهام</h1>` + (assigns.length ? assigns.map(a => {
    const t = tgt(a), n = t.filter(s => done[s.id].has(a.id)).length;
    return `<div class="card it"><div class="grow"><b>${E(IT[a.id].t)}</b><div class="m">إلى: ${a.to === 'all' ? 'كل الطلاب' : E(t[0]?.n || '—')} · الموعد: ${E(a.due)}</div></div><span class="tag">${N(n)} / ${N(t.length)} سلّموا</span><button class="btn alt" data-del="${a.dbId}">حذف</button></div>`;
  }).join('') : `<div class="card">لا توجد مهام بعد.</div>`);
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف هذه المهمة؟')) return;
    if (await removeAssign(+b.dataset.del)) {
      assigns = assigns.filter(x => x.dbId !== +b.dataset.del);
      toast('تم حذف المهمة');
      render();
    }
  });
}

function treports() {
  const subs = SECS.map(x => {
    const it = D.items.filter(i => i.sec === x.id);
    const total = students.length * it.length;
    const cnt = students.reduce((a, s) => a + it.filter(i => done[s.id].has(i.id)).length, 0);
    return {id: x.id, t: x.t, icon: x.icon, total, cnt, pct: total ? Math.round(cnt / total * 100) : 0};
  });
  const allDone = students.reduce((a, s) => a + done[s.id].size, 0);
  const allPct = students.length ? Math.round(students.reduce((a, s) => a + prog(s).pct, 0) / students.length) : 0;
  const ready = students.filter(s => prog(s).pct >= 80 && s.lv !== 'متقدم').length;
  app.innerHTML = `<h1>التقارير</h1>
    <div class="stats"><div class="card stat"><b>${N(allPct)}%</b><span>إنجاز عام</span></div><div class="card stat"><b>${N(allDone)}</b><span>درس منجز</span></div><div class="card stat"><b>${N(ready)}</b><span>جاهز للترقية</span></div></div>
    <h2>إنجاز المواد</h2><div class="card">${subs.map(s => `<div class="row" style="margin:8px 0"><div class="grow"><b>${s.icon} ${s.t}</b><div class="m">${N(s.cnt)} / ${N(s.total)} درس</div></div><div style="width:55%"><div class="bar" title="${s.pct}%"><i style="width:${s.pct}%"></i></div></div><b>${N(s.pct)}%</b></div>`).join('')}</div>
    <h2>تقدّم الطلاب</h2><div class="card tbl"><table><thead><tr><th>الطالب</th><th>المستوى</th><th>عام</th>${SECS.map(x => `<th>${x.icon}</th>`).join('')}</tr></thead><tbody>${students.map(s => `<tr><td><b>${E(s.n)}</b></td><td>${s.lv}</td><td><div class="bar" title="${prog(s).pct}%"><i style="width:${prog(s).pct}%"></i></div></td>${SECS.map(x => {
      const it = D.items.filter(i => i.sec === x.id);
      const c = it.filter(i => done[s.id].has(i.id)).length, p = it.length ? Math.round(c / it.length * 100) : 0;
      return `<td><div class="bar" title="${p}%"><i style="width:${p}%"></i></div></td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ---------- Student views ---------- */
function shome() {
  const s = me();
  if (!s) { app.innerHTML = `<div class="card">لا يوجد طلاب بعد. عد إلى وضع المعلّم لتحميل البيانات التجريبية.</div>`; return; }
  const mine = assigns.filter(a => tgt(a).includes(s) && !done[s.id].has(a.id)), n = done[s.id].size;
  app.innerHTML = `<div class="hero"><h1>أهلاً يا ${E(s.n)}</h1><div>مستواك: ${s.lv}</div><div class="lanterns" aria-label="${n} دروس">${[0, 1, 2, 3, 4, 5, 6].map(i => `<div class="ln ${i < n ? 'lit' : ''}"></div>`).join('')}</div></div>
  <h2>مطلوب منك</h2>` + (mine.length ? mine.map(a => `<div class="card task"><div class="grow"><b>${E(IT[a.id].t)}</b><div class="m">الموعد: ${E(a.due)}</div></div><button class="btn" data-o="${a.id}">ابدأ</button></div>`).join('') : `<div class="card">لا مهام الآن. اختر مادة من القائمة.</div>`) +
    `<h2>موادي</h2><div class="grid">${SECS.map(x => {
      const it = D.items.filter(i => i.sec === x.id && LV.indexOf(i.lv) <= LV.indexOf(s.lv));
      return `<button class="sub" data-sec="${x.id}"><span class="em">${x.icon}</span><b>${x.t}</b><div class="m">${N(it.filter(i => done[s.id].has(i.id)).length)} / ${N(it.length)}</div></button>`;
    }).join('')}<button class="sub" data-q="1"><span class="em">📖</span><b>القرآن</b><div class="m">رواية حفص</div></button></div>`;
  app.querySelectorAll('[data-o]').forEach(b => b.onclick = () => go({p: 'lesson', id: b.dataset.o, back: view}));
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
function quran() {
  let n = view.n || 1, hide = false;
  function draw() {
    const s = D.q[n - 1];
    app.innerHTML = `<h1>القرآن (رواية حفص)</h1><div class="row"><select id="sf" style="width:auto">${D.q.map(x => `<option value="${x.id}" ${x.id === n ? 'selected' : ''}>${N(x.id)}. ${x.name}</option>`).join('')}</select><label style="margin:0"><input type="checkbox" id="hd" ${hide ? 'checked' : ''}> وضع الحفظ: إخفاء الآيات (اضغط على الآية لإظهارها)</label></div>
    <div class="card ar qtxt" id="qt" style="margin-top:12px"></div><p class="note">نص القرآن: مشروع Tanzil (tanzil.net)، رواية حفص، دون أي تعديل. لم تُراجَع بعد من مختص. تلاوة الحصري ستُربط بعد اختبار الروابط.</p>`;
    const qt = $('#qt');
    if (n !== 1 && n !== 9) { const p = document.createElement('div'); p.style.textAlign = 'center'; p.textContent = D.basm; qt.appendChild(p); }
    s.v.forEach((t, i) => {
      const sp = document.createElement('span');
      sp.className = 'ay' + (hide ? ' hid' : '');
      sp.textContent = t + ' ﴿' + N(i + 1) + '﴾ ';
      sp.onclick = () => sp.classList.toggle('hid');
      qt.appendChild(sp);
    });
    $('#sf').onchange = e => { n = +e.target.value; view.n = n; draw(); };
    $('#hd').onchange = e => { hide = e.target.checked; draw(); };
  }
  draw();
}

boot();
