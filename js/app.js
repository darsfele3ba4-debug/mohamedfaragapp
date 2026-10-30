/* الواجهة: الشاشات + التنقل + الأحداث (النسخة المبسطة) */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const enDigits = s => String(s ?? '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٫,]/g, '.');
  const num = s => { const t = enDigits(s).trim(); return t === '' ? null : Number(t); };
  const norm = s => String(s || '').replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const fmtFull = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const money = v => (Number(v) || 0).toLocaleString('en-US') + ' ج';
  const frac = (a, b) => `<bdi dir="ltr">${esc(a)}${b ? ' / ' + esc(b) : ''}</bdi>`;
  const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const CODE_RE = /^[A-Z0-9]{4,12}$/;
  const PKEY = 'sapp_parent_code';
  const ATT = { present: 'حاضر', absent: 'غائب' };
  const HW = { done: 'حلّ الواجب', missing: 'لم يحل' };
  const PAID = { '1': 'دفع', '0': 'لم يدفع' };
  const NAV = [['', '👥', 'المجموعات'], ['students', '🎓', 'الطلاب'], ['settings', '⚙️', 'الإعدادات']];
  const state = { q: {}, search: '', modal: null, showSetup: false, parent: null, route: '', sel: {}, pinged: false };

  // ───────── بيانات مساعدة ─────────
  const P = () => {
    const prof = (Store.token() && Store.setting('profile')) || (state.parent && state.parent.data && state.parent.data.settings.profile) || {};
    const o = Object.assign({}, CONFIG);
    Object.keys(prof || {}).forEach(k => { if (prof[k]) o[k] = prof[k]; });
    return o;
  };
  const byName = (a, b) => a.name.localeCompare(b.name, 'ar');
  const groups = () => Store.list('Groups').sort((a, b) => (+a.sortOrder || 0) - (+b.sortOrder || 0) || byName(a, b));
  const students = (gid, arch) => Store.list('Students').filter(s => (!gid || s.groupId === gid) && (arch ? s.status === 'archived' : s.status !== 'archived')).sort(byName);
  const classes = gid => Store.list('Classes').filter(c => !gid || c.groupId === gid).sort((a, b) => b.date.localeCompare(a.date) || Number(b.createdAt) - Number(a.createdAt));
  const gName = id => (Store.get('Groups', id) || {}).name || '—';
  const recId = (cid, sid) => 'r_' + cid + '_' + sid;
  const rec = (cid, sid) => Store.get('Records', recId(cid, sid));
  const empty = (t, sub) => `<div class="empty"><div>📭</div><b>${esc(t)}</b>${sub ? `<p>${sub}</p>` : ''}</div>`;
  const opts = (arr, sel) => arr.map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const clsTitle = c => c.title ? c.title : 'حصة ' + fmtDate(c.date);
  const defFee = c => (c && c.fee) || ((Store.get('Groups', c && c.groupId) || {}).fee) || '';

  /** ملخص مجموعة سجلات (لحصة أو لطالب) */
  function summary(recs, maxOf) {
    const s = { present: 0, absent: 0, done: 0, missing: 0, paidN: 0, unpaidN: 0, paidSum: 0, scoreN: 0, pctSum: 0, scoreSum: 0 };
    recs.forEach(r => {
      if (r.attendance === 'present') s.present++; else if (r.attendance === 'absent') s.absent++;
      if (r.homework === 'done') s.done++; else if (r.homework === 'missing') s.missing++;
      if (r.paid === '1') { s.paidN++; s.paidSum += Number(r.amount) || 0; } else if (r.paid === '0') s.unpaidN++;
      if (r.score !== '' && r.score != null) {
        s.scoreN++; s.scoreSum += Number(r.score) || 0;
        const m = Number(maxOf(r)); if (m > 0) s.pctSum += (Number(r.score) || 0) * 100 / m;
      }
    });
    const rate = (a, b) => a + b ? Math.round(a * 100 / (a + b)) : null;
    s.attRate = rate(s.present, s.absent); s.hwRate = rate(s.done, s.missing);
    s.avgPct = s.scoreN ? Math.round(s.pctSum / s.scoreN) : null;
    s.avg = s.scoreN ? Math.round(s.scoreSum * 10 / s.scoreN) / 10 : null;
    return s;
  }
  const pctTxt = v => v == null ? '—' : v + '%';

  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function waLink(phone, text) {
    let n = enDigits(phone).replace(/\D/g, '');
    const cc = String(CONFIG.countryCode || '20');
    if (n.startsWith('00')) n = n.slice(2);
    else if (n.startsWith('0')) n = cc + n.slice(1);
    else if (n && !n.startsWith(cc)) n = cc + n;
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text);
  }
  function openWA(phone, text) {
    if (!phone) toast('لا يوجد رقم لولي الأمر، اختر جهة الاتصال من واتساب');
    window.open(waLink(phone, text), '_blank');
  }
  function genCode() {
    const used = new Set(Store.list('Students').map(s => s.code));
    let c;
    do { const b = crypto.getRandomValues(new Uint8Array(8)); c = ''; for (let i = 0; i < 8; i++) c += CHARS[b[i] % CHARS.length]; } while (used.has(c));
    return c;
  }
  const parentUrl = code => location.origin + location.pathname + '#/p' + (code ? '?c=' + code : '');

  // ───────── التخطيط العام ─────────
  function badge() {
    const s = Store.status, p = Store.pending;
    const m = { synced: ['ok', '✓ متزامن'], syncing: ['busy', '⟳ مزامنة…'], offline: ['warn', '⚡ غير متصل'], error: ['err', '✕ خطأ'], idle: ['', '…'] };
    let [c, t] = m[s] || m.idle;
    if (p && s !== 'syncing') { c = 'warn'; t = '● ' + p + ' معلّق'; }
    return `<button class="badge ${c}" data-act="syncNow" title="${esc(Store.lastError || 'اضغط للمزامنة الآن')}">${t}</button>`;
  }
  function layout(v, r) {
    const p = P(), act = ['group', 'class'].includes(r) ? '' : r === 'student' ? 'students' : r;
    return `<header class="top">
      ${v.back ? `<a class="icon" href="${v.back}" aria-label="رجوع">➜</a>` : (p.logo ? `<img class="logo round" src="${esc(p.logo)}" alt="" onerror="this.remove()">` : '')}
      <div class="ttl"><b>${esc(v.title)}</b>${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</div>
      <span id="badge">${badge()}</span>
    </header>
    <main>${v.body}</main>
    <nav class="bottom">${NAV.map(([h, i, t]) => `<a href="#/${h}" class="${act === h ? 'on' : ''}"><span>${i}</span>${t}</a>`).join('')}</nav>`;
  }

  // ───────── تسجيل الدخول ─────────
  function viewLogin() {
    const p = P();
    return `<div class="auth">
      ${p.logo ? `<img class="logo-lg round" src="${esc(p.logo)}" alt="" onerror="this.remove()">` : '<div class="logo-lg emoji">🎓</div>'}
      <h1>${esc(p.appName)}</h1><p class="muted">${esc(p.teacherName)} · ${esc(p.subject)}</p>
      ${state.showSetup ? `
      <form data-form="firstSetup" class="card stack">
        <b>إعداد أول مرة</b>
        <p class="muted small">اختر كلمة مرور المدرس، وهي التي ستدخل بها بعد ذلك من أي جهاز.</p>
        <input class="inp" type="password" name="password" placeholder="كلمة المرور (6 أحرف على الأقل)" minlength="6" required>
        <input class="inp" type="password" name="password2" placeholder="تأكيد كلمة المرور" required>
        <button class="btn pri">حفظ والدخول</button>
      </form>` : `
      <form data-form="login" class="card stack">
        <input class="inp" type="password" name="password" placeholder="كلمة المرور" required autofocus>
        <button class="btn pri">دخول</button>
      </form>`}
      <button class="link" data-act="toggleSetup">${state.showSetup ? 'لدي كلمة مرور بالفعل' : 'إعداد أول مرة'}</button>
      <a class="link" href="#/p">👪 بوابة ولي الأمر</a>
    </div>`;
  }

  // ───────── المجموعات (الرئيسية) ─────────
  function viewGroups() {
    const gs = groups();
    const body = `<div class="quick"><button class="btn pri" data-act="addGroup">➕ مجموعة جديدة</button></div>
      ${gs.length ? gs.map(g => {
        const n = students(g.id).length, cl = classes(g.id), last = cl[0];
        return `<a class="card li gcard" href="#/group/${g.id}"><span class="av">👥</span><span class="grow"><b>${esc(g.name)}</b>
          <small class="muted">${n} طالب · ${cl.length} حصة${last ? ' · آخر حصة ' + fmtDate(last.date) : ''}</small></span><span class="muted">‹</span></a>`;
      }).join('') : empty('لا توجد مجموعات بعد', 'ابدأ بإضافة مجموعة، ثم أضف طلابها.')}`;
    return { title: P().appName, sub: P().teacherName, body };
  }

  function viewGroup(id) {
    const g = Store.get('Groups', id);
    if (!g) return { title: 'غير موجودة', back: '#/', body: empty('المجموعة غير موجودة') };
    const tab = state.q.t === 'st' ? 'st' : 'cl', st = students(id), cl = classes(id);
    const tabs = `<div class="tabs"><a href="#/group/${id}" class="${tab === 'cl' ? 'on' : ''}">📅 الحصص (${cl.length})</a><a href="#/group/${id}?t=st" class="${tab === 'st' ? 'on' : ''}">🎓 الطلاب (${st.length})</a></div>`;
    let list;
    if (tab === 'cl') {
      list = `<div class="quick"><button class="btn pri" data-act="addClass" data-g="${id}">➕ حصة جديدة</button></div>
        ${cl.length ? `<div class="card list">${cl.map(c => {
          const rs = st.map(s => rec(c.id, s.id)).filter(Boolean), s = summary(rs, () => c.maxScore);
          return `<a class="li" href="#/class/${c.id}"><span class="grow"><b>${esc(clsTitle(c))}</b><small class="muted">${fmtFull(c.date)}</small>
            <small>✅ ${s.present} حاضر · ❌ ${s.absent} غائب · 📚 ${s.done} حل · 💰 ${s.paidN} دفع</small></span><span class="muted">‹</span></a>`;
        }).join('')}</div>` : empty('لا توجد حصص', st.length ? 'اضغط «حصة جديدة» لبدء تسجيل الحضور والدرجات.' : 'أضف الطلاب أولاً من تبويب «الطلاب».')}`;
    } else {
      list = `<div class="quick"><button class="btn pri" data-act="addStudent" data-g="${id}">➕ طالب</button><button class="btn" data-act="bulkStudents" data-g="${id}">📋 إضافة جماعية</button><a class="btn" href="#/codes?g=${id}">🖨️ طباعة الأكواد</a></div>
        ${st.length ? `<div class="card list">${st.map(stuLi).join('')}</div>` : empty('لا يوجد طلاب في هذه المجموعة')}`;
    }
    return {
      title: g.name, sub: g.fee ? 'المصاريف: ' + money(g.fee) : '', back: '#/',
      body: `${tabs}${list}
        <div class="acts mt"><button class="btn sm" data-act="editGroup" data-id="${id}">✏️ تعديل المجموعة</button><button class="btn sm ghost" data-act="delGroup" data-id="${id}">🗑️ حذف المجموعة</button></div>`
    };
  }
  const stuLi = s => `<a class="li" href="#/student/${s.id}"><span class="av">${esc(s.name.trim()[0] || '؟')}</span><span class="grow"><b>${esc(s.name)}</b><small class="muted">${esc(gName(s.groupId))}</small></span><span class="code small ltr">${esc(s.code)}</span></a>`;

  // ───────── شاشة الحصة (التسجيل) ─────────
  function viewClass(id) {
    const c = Store.get('Classes', id);
    if (!c) return { title: 'غير موجودة', back: '#/', body: empty('الحصة غير موجودة') };
    const st = students(c.groupId), sel = state.sel[id] || (state.sel[id] = new Set());
    [...sel].forEach(x => { if (!st.find(s => s.id === x)) sel.delete(x); });
    const rs = st.map(s => rec(id, s.id)).filter(Boolean), sm = summary(rs, () => c.maxScore), max = c.maxScore;
    const fee = defFee(c);
    const tg = (sid, f, map, cur, cls) => `<div class="tg">${Object.entries(map).map(([v, t]) => `<button type="button" class="${cur === v ? 'on ' + cls[v] : ''}" data-act="setf" data-s="${sid}" data-f="${f}" data-v="${v}">${t}</button>`).join('')}</div>`;
    const cards = st.map(s => {
      const r = rec(id, s.id) || {};
      return `<div class="card stu ${sel.has(s.id) ? 'sel' : ''}">
        <div class="stu-h"><label class="chk"><input type="checkbox" data-chg="sel" data-s="${s.id}" ${sel.has(s.id) ? 'checked' : ''} aria-label="تحديد"></label>
          <a class="grow" href="#/student/${s.id}"><b>${esc(s.name)}</b></a><span class="code small ltr">${esc(s.code)}</span></div>
        <div class="fields">
          <div class="f"><span>الحضور</span>${tg(s.id, 'attendance', { present: 'حاضر', absent: 'غائب' }, r.attendance, { present: 'g', absent: 'r' })}</div>
          <div class="f"><span>الواجب</span>${tg(s.id, 'homework', { done: 'حلّ', missing: 'لم يحل' }, r.homework, { done: 'g', missing: 'r' })}</div>
          <div class="f"><span>درجة الامتحان</span><div class="sc"><input class="inp sm num" inputmode="decimal" data-chg="score" data-s="${s.id}" value="${esc(r.score || '')}" placeholder="—" aria-label="الدرجة">${max ? `<small class="muted">/ ${esc(max)}</small>` : ''}</div></div>
          <div class="f"><span>المصاريف</span>${tg(s.id, 'paid', { '1': 'دفع', '0': 'لم يدفع' }, r.paid, { '1': 'g', '0': 'r' })}</div>
          <div class="f"><span>المبلغ</span><div class="sc"><input class="inp sm num" inputmode="decimal" data-chg="amount" data-s="${s.id}" value="${esc(r.amount || '')}" placeholder="${esc(fee || '—')}" aria-label="المبلغ"><small class="muted">ج</small></div></div>
          <div class="f full"><input class="inp sm" data-chg="note" data-s="${s.id}" value="${esc(r.note || '')}" placeholder="📝 ملاحظات (تظهر لولي الأمر)" aria-label="ملاحظات"></div>
        </div></div>`;
    }).join('');
    const radio = (name, map) => `<div class="chips">${[['', 'بدون تغيير'], ...Object.entries(map)].map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}" ${v === '' ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
    const bulk = `<details class="card bulk" ${state.bulkOpen ? 'open' : ''} data-sec="bulk"><summary>⚡ إدخال / تعديل جماعي</summary>
      <form data-form="bulkRec" class="stack">
        <div class="seg big">${[['all', 'كل الطلاب (' + st.length + ')'], ['sel', 'المحددين فقط (' + sel.size + ')']].map(([v, t]) => `<label><input type="radio" name="target" value="${v}" ${(sel.size ? 'sel' : 'all') === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        <b class="small">الحضور</b>${radio('attendance', ATT)}
        <b class="small">الواجب</b>${radio('homework', { done: 'حلّ', missing: 'لم يحل' })}
        <b class="small">المصاريف</b>${radio('paid', PAID)}
        <div class="row2"><label>المبلغ<input class="inp" name="amount" inputmode="decimal" placeholder="${esc(fee || 'بدون تغيير')}"></label>
          <label>درجة الامتحان${max ? ' (من ' + esc(max) + ')' : ''}<input class="inp" name="score" inputmode="decimal" placeholder="بدون تغيير"></label></div>
        <label>ملاحظة للجميع<input class="inp" name="note" placeholder="بدون تغيير"></label>
        <label class="chk"><input type="checkbox" name="clear"> مسح كل بيانات المحددين في هذه الحصة</label>
        <button class="btn pri">تطبيق</button>
      </form></details>`;
    return {
      title: clsTitle(c), sub: gName(c.groupId) + ' · ' + fmtFull(c.date), back: '#/group/' + c.groupId,
      body: `<div class="stats">
          <div class="stat"><b>${sm.present} <small>من ${st.length}</small></b><span>حاضر · ${sm.absent} غائب</span></div>
          <div class="stat"><b>${sm.done}</b><span>حلّ الواجب · ${sm.missing} لم يحل</span></div>
          <div class="stat"><b>${sm.avg == null ? '—' : sm.avg}</b><span>متوسط الدرجة${max ? ' من ' + esc(max) : ''}</span></div>
          <div class="stat"><b>${money(sm.paidSum)}</b><span>${sm.paidN} دفع · ${sm.unpaidN} لم يدفع</span></div></div>
        <div class="quick">
          <button class="btn sm" data-act="fillAll" data-f="attendance" data-v="present">✅ الباقي حاضر</button>
          <button class="btn sm" data-act="fillAll" data-f="homework" data-v="done">📚 الباقي حلّ</button>
          <button class="btn sm" data-act="fillAll" data-f="paid" data-v="1">💰 الباقي دفع</button>
          <button class="btn sm" data-act="selAll">${sel.size === st.length && st.length ? '☐ إلغاء التحديد' : '☑️ تحديد الكل'}</button>
        </div>
        ${bulk}
        ${st.length ? cards : empty('لا يوجد طلاب في هذه المجموعة')}
        <div class="acts mt"><button class="btn sm" data-act="editClass" data-id="${id}">✏️ تعديل بيانات الحصة</button><button class="btn sm ghost" data-act="delClass" data-id="${id}">🗑️ حذف الحصة</button></div>`
    };
  }

  // ───────── الطلاب ─────────
  function studentRows() {
    const q = norm(state.search), arch = state.q.arch === '1';
    const list = students(state.q.g, arch).filter(s => !q || norm(s.name).includes(q) || s.code.toLowerCase().includes(q));
    return list.length ? `<div class="card list">${list.map(stuLi).join('')}</div>` : empty(q ? 'لا توجد نتائج' : 'لا يوجد طلاب');
  }
  function viewStudents() {
    return {
      title: 'الطلاب', sub: students().length + ' طالب',
      body: `<div class="quick"><button class="btn pri" data-act="addStudent" data-g="${esc(state.q.g || '')}">➕ طالب</button><button class="btn" data-act="bulkStudents" data-g="${esc(state.q.g || '')}">📋 إضافة جماعية</button><a class="btn" href="#/codes${state.q.g ? '?g=' + esc(state.q.g) : ''}">🖨️ الأكواد</a></div>
        <div class="row2"><select class="inp" data-chg="stGroup" aria-label="المجموعة"><option value="">كل المجموعات</option>${opts(groups(), state.q.g)}</select>
        <select class="inp" data-chg="stArch" aria-label="الحالة"><option value="">الطلاب الحاليون</option><option value="1" ${state.q.arch === '1' ? 'selected' : ''}>المؤرشفون</option></select></div>
        <input class="inp" type="search" data-inp="search" placeholder="🔍 بحث بالاسم أو الكود" value="${esc(state.search)}">
        <div id="list">${studentRows()}</div>`
    };
  }

  function studentHistory(sid) {
    return Store.list('Records').filter(r => r.studentId === sid).map(r => {
      const c = Store.get('Classes', r.classId);
      return c ? Object.assign({}, r, { date: c.date, title: c.title, max: c.maxScore }) : null;
    }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  }
  const histRow = r => `<tr><td class="nm">${fmtDate(r.date)}${r.title ? `<small class="muted d">${esc(r.title)}</small>` : ''}</td>
    <td class="${r.attendance === 'absent' ? 'bad-t' : r.attendance ? 'ok-c' : ''}">${ATT[r.attendance] || '—'}</td>
    <td class="${r.homework === 'missing' ? 'bad-t' : r.homework ? 'ok-c' : ''}">${r.homework === 'done' ? 'حلّ' : r.homework === 'missing' ? 'لم يحل' : '—'}</td>
    <td>${r.score !== '' && r.score != null ? frac(r.score, r.max) : '—'}</td>
    <td class="${r.paid === '0' ? 'bad-t' : r.paid === '1' ? 'ok-c' : ''}">${r.paid === '1' ? 'دفع' + (r.amount ? ' ' + money(r.amount) : '') : r.paid === '0' ? 'لم يدفع' : '—'}</td>
    <td class="nm">${esc(r.note || '')}</td></tr>`;
  const histTable = rs => `<div class="card scroll"><table class="tbl"><thead><tr><th>الحصة</th><th>الحضور</th><th>الواجب</th><th>الدرجة</th><th>المصاريف</th><th>ملاحظات</th></tr></thead><tbody>${rs.map(histRow).join('') || '<tr><td colspan="6" class="muted">لا توجد حصص مسجلة</td></tr>'}</tbody></table></div>`;
  const statsHtml = sm => `<div class="stats">
      <div class="stat"><b>${pctTxt(sm.attRate)}</b><span>نسبة الحضور · ${sm.absent} غياب</span></div>
      <div class="stat"><b>${pctTxt(sm.hwRate)}</b><span>حل الواجبات</span></div>
      <div class="stat"><b>${pctTxt(sm.avgPct)}</b><span>متوسط الدرجات</span></div>
      <div class="stat"><b>${money(sm.paidSum)}</b><span>إجمالي المدفوع${sm.unpaidN ? ' · ' + sm.unpaidN + ' لم يدفع' : ''}</span></div></div>`;

  function viewStudent(id) {
    const s = Store.get('Students', id);
    if (!s) return { title: 'غير موجود', back: '#/students', body: empty('الطالب غير موجود') };
    const rs = studentHistory(id), sm = summary(rs, r => r.max);
    return {
      title: s.name, sub: gName(s.groupId) + (s.status === 'archived' ? ' · مؤرشف' : ''), back: '#/group/' + s.groupId + '?t=st',
      body: `<div class="card prof">
          <div class="kv"><span>كود ولي الأمر</span><b class="code ltr">${esc(s.code)}</b><button class="btn sm" data-act="copy" data-t="${esc(s.code)}">نسخ</button></div>
          <div class="kv"><span>المجموعة</span>${esc(gName(s.groupId))}</div>
          ${s.guardianPhone ? `<div class="kv"><span>رقم ولي الأمر</span><a class="ltr" href="tel:${esc(s.guardianPhone)}">${esc(s.guardianPhone)}</a></div>` : ''}
          ${s.notes ? `<div class="kv"><span>ملاحظة خاصة 🔒</span><span class="pre">${esc(s.notes)}</span></div>` : ''}
        </div>
        <div class="quick"><button class="btn wa" data-act="sendCode" data-id="${id}">📲 إرسال الكود لولي الأمر</button><button class="btn" data-act="editStudent" data-id="${id}">✏️ تعديل</button></div>
        ${statsHtml(sm)}
        <h3>سجل الحصص</h3>${histTable(rs)}
        <div class="acts mt"><button class="btn sm" data-act="regen" data-id="${id}">🔄 كود جديد</button><button class="btn sm" data-act="archive" data-id="${id}">${s.status === 'archived' ? '↩️ إلغاء الأرشفة' : '📦 أرشفة'}</button><button class="btn sm ghost" data-act="delStudent" data-id="${id}">🗑️ حذف</button></div>`
    };
  }

  // ───────── الإعدادات ─────────
  function viewSettings() {
    const p = P();
    return {
      title: 'الإعدادات',
      body: `<div class="card stack"><b>رابط بوابة ولي الأمر</b><p class="muted small">ولي الأمر يفتح هذا الرابط ويكتب كود الطالب.</p>
          <div class="erow"><input class="inp ltr" readonly value="${esc(parentUrl())}"><button class="btn" data-act="copy" data-t="${esc(parentUrl())}">نسخ</button></div></div>
        <form data-form="password" class="card stack"><b>تغيير كلمة المرور</b>
          <input class="inp" type="password" name="oldPassword" placeholder="كلمة المرور الحالية" required>
          <input class="inp" type="password" name="newPassword" placeholder="كلمة المرور الجديدة" minlength="6" required>
          <input class="inp" type="password" name="newPassword2" placeholder="تأكيد كلمة المرور الجديدة" required>
          <button class="btn pri">تغيير</button></form>
        <div class="card stack"><b>أخرى</b>
          <button class="btn" data-act="theme">🌓 الوضع الليلي / النهاري</button>
          <button class="btn" data-act="export">💾 تنزيل نسخة احتياطية</button>
          <button class="btn" data-act="syncNow">🔄 مزامنة الآن</button>
          <button class="btn ghost" data-act="logout">🚪 تسجيل الخروج</button></div>
        <p class="muted small center">${esc(p.teacherName)} · ${esc(p.subject)}</p>`
    };
  }

  // ───────── طباعة الأكواد ─────────
  function viewCodes(gid) {
    const p = P(), st = students(gid), url = parentUrl();
    return `<div class="print-bar no-print"><a class="btn" href="#/${gid ? 'group/' + gid + '?t=st' : 'students'}">➜ رجوع</a><button class="btn pri" data-act="print">🖨️ طباعة</button></div>
      <div class="codes">${st.map(s => `<div class="code-card"><b>${esc(s.name)}</b><small>${esc(gName(s.groupId))} · ${esc(p.teacherName)}</small>
        <div>كود المتابعة: <b class="code ltr">${esc(s.code)}</b></div><small class="ltr">${esc(url)}</small></div>`).join('') || empty('لا يوجد طلاب')}</div>`;
  }

  // ───────── بوابة ولي الأمر ─────────
  async function parentLoad(code) {
    state.parent = { loading: true };
    render();
    try {
      const data = await Store.api('parentPortal', { code });
      try { localStorage.setItem(PKEY, code); } catch (e) { /* ignore */ }
      state.parent = { data };
    } catch (e) {
      state.parent = { error: e.message };
      if (e.code === 'NOT_FOUND') try { localStorage.removeItem(PKEY); } catch (x) { /* ignore */ }
    }
    render();
  }
  function viewParent() {
    const st = state.parent || {}, p = P();
    const head = `<div class="p-head">${p.logo ? `<img class="logo-lg round" src="${esc(p.logo)}" alt="" onerror="this.remove()">` : ''}<b>${esc(p.teacherName)}</b><small class="muted">${esc(p.subject)}${p.schoolName ? ' · ' + esc(p.schoolName) : ''}</small></div>`;
    if (st.loading) return `<div class="parent">${head}<div class="empty"><div class="spin"></div><b>جاري التحميل…</b></div></div>`;
    let saved = ''; try { saved = localStorage.getItem(PKEY) || ''; } catch (e) { /* ignore */ }
    if (!st.data) return `<div class="parent">${head}
      <form data-form="parent" class="card stack"><b>متابعة الطالب</b><p class="muted small">اكتب كود الطالب الذي أرسله لك المدرس.</p>
      <input class="inp ltr code-inp" name="code" maxlength="12" required autocomplete="off" value="${esc(saved)}" placeholder="الكود">
      ${st.error ? `<p class="err-t">${esc(st.error)}</p>` : ''}<button class="btn pri">عرض</button></form></div>`;
    const d = st.data, rs = d.records.slice().sort((a, b) => b.date.localeCompare(a.date)), sm = summary(rs, r => r.max);
    const item = (k, v, cls) => `<div class="pi ${cls || ''}"><small>${k}</small><b>${v}</b></div>`;
    return `<div class="parent">${head}
      <div class="card"><h2>${esc(d.student.name)}</h2><small class="muted">${esc(d.student.group)}</small></div>
      ${statsHtml(sm)}
      <h3>الحصص</h3>
      ${rs.length ? rs.map(r => `<div class="card prec"><div class="prec-h"><b>${fmtFull(r.date)}</b>${r.title ? `<small class="muted">${esc(r.title)}</small>` : ''}</div>
        <div class="pgrid">
          ${item('الحضور', ATT[r.attendance] || '—', r.attendance === 'absent' ? 'bad' : r.attendance ? 'good' : '')}
          ${item('الواجب', r.homework === 'done' ? 'حلّ ✓' : r.homework === 'missing' ? 'لم يحل' : '—', r.homework === 'missing' ? 'bad' : r.homework ? 'good' : '')}
          ${item('درجة الامتحان', r.score !== '' && r.score != null ? frac(r.score, r.max) : '—')}
          ${item('المصاريف', r.paid === '1' ? 'دفع' + (r.amount ? ' ' + money(r.amount) : '') : r.paid === '0' ? 'لم يدفع' : '—', r.paid === '0' ? 'bad' : r.paid === '1' ? 'good' : '')}
        </div>${r.note ? `<p class="pnote">📝 ${esc(r.note)}</p>` : ''}</div>`).join('') : empty('لا توجد حصص مسجلة بعد')}
      ${p.whatsapp ? `<a class="btn wa block" target="_blank" rel="noopener" href="${waLink(p.whatsapp, 'السلام عليكم، بخصوص الطالب/ة ' + d.student.name)}">📲 تواصل مع المدرس</a>` : ''}
      <button class="btn ghost block" data-act="parentReset">تغيير الكود</button></div>`;
  }

  // ───────── النوافذ ─────────
  function modalHtml(m) {
    if (m.type === 'group') {
      const g = m.g || {};
      return `<form data-form="group" class="stack"><h2>${g.id ? 'تعديل' : 'إضافة'} مجموعة</h2>
        <label>اسم المجموعة<input class="inp" name="name" value="${esc(g.name || '')}" placeholder="مثال: مجموعة السبت 4 م" required autofocus></label>
        <label>المصاريف الافتراضية (ج)<input class="inp" name="fee" inputmode="decimal" value="${esc(g.fee || '')}" placeholder="مثال: 100"></label>
        <label>ملاحظة<input class="inp" name="note" value="${esc(g.note || '')}" placeholder="المكان، الموعد…"></label>
        <button class="btn pri">حفظ</button></form>`;
    }
    if (m.type === 'class') {
      const c = m.c || {}, prev = classes(c.groupId || m.gid)[0] || {};
      return `<form data-form="class" class="stack"><h2>${c.id ? 'تعديل الحصة' : 'حصة جديدة'}</h2>
        <label>التاريخ<input class="inp" type="date" name="date" value="${esc(c.date || today())}" required></label>
        <label>عنوان الحصة (اختياري)<input class="inp" name="title" value="${esc(c.title || '')}" placeholder="مثال: الدرس الثالث، النعت"></label>
        <div class="row2"><label>الدرجة النهائية للامتحان<input class="inp" name="maxScore" inputmode="decimal" value="${esc(c.id ? c.maxScore : (prev.maxScore || '10'))}" placeholder="مثال: 10"></label>
        <label>المصاريف (ج)<input class="inp" name="fee" inputmode="decimal" value="${esc(c.id ? c.fee : ((Store.get('Groups', m.gid) || {}).fee || ''))}" placeholder="اختياري"></label></div>
        <button class="btn pri">${c.id ? 'حفظ' : 'إنشاء وبدء التسجيل'}</button></form>`;
    }
    if (m.type === 'student') {
      const x = m.s || {}, gs = groups();
      if (!gs.length) return `<h2>إضافة طالب</h2>${empty('أضف مجموعة أولاً')}<button class="btn pri block" data-act="addGroup">➕ مجموعة</button>`;
      return `<form data-form="student" class="stack"><h2>${x.id ? 'تعديل بيانات الطالب' : 'إضافة طالب'}</h2>
        <label>اسم الطالب<input class="inp" name="name" value="${esc(x.name || '')}" required autofocus></label>
        <label>المجموعة<select class="inp" name="groupId" required>${opts(gs, x.groupId || m.gid)}</select></label>
        <label>كود الطالب<input class="inp ltr" name="code" value="${esc(x.code || '')}" maxlength="12" placeholder="اتركه فارغاً ليُولَّد تلقائياً"></label>
        <label>رقم ولي الأمر (واتساب)<input class="inp ltr" type="tel" name="guardianPhone" value="${esc(x.guardianPhone || '')}"></label>
        <label>ملاحظة خاصة 🔒 (لا تظهر لولي الأمر)<textarea class="inp" name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
        <button class="btn pri">حفظ</button></form>`;
    }
    if (m.type === 'bulkStudents') {
      const gs = groups();
      if (!gs.length) return `<h2>إضافة جماعية</h2>${empty('أضف مجموعة أولاً')}<button class="btn pri block" data-act="addGroup">➕ مجموعة</button>`;
      return `<form data-form="bulkStudents" class="stack"><h2>إضافة جماعية للطلاب</h2>
        <select class="inp" name="groupId" required>${opts(gs, m.gid)}</select>
        <textarea class="inp" name="list" rows="9" required placeholder="اسم في كل سطر، ويمكن إضافة رقم ولي الأمر والكود بعد فاصلة:&#10;أحمد محمد علي، 01012345678&#10;سارة حسن، 01198765432، 1025&#10;محمود سعيد"></textarea>
        <p class="muted small">الكود اختياري (4 إلى 12 حرفاً أو رقماً). لو تركته يُولَّد تلقائياً.</p>
        <button class="btn pri">إضافة</button></form>`;
    }
    return '';
  }
  function openModal(m) { state.modal = m; renderModal(); }
  function closeModal() { state.modal = null; renderModal(); }
  function renderModal() {
    const el = $('#modal');
    if (!state.modal) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="x" data-act="closeModal" aria-label="إغلاق">✕</button>${modalHtml(state.modal)}</div>`;
    const f = el.querySelector('[autofocus]'); if (f) f.focus();
  }

  // ───────── العرض والتنقل ─────────
  function parseHash() {
    const [p, qs] = (location.hash.slice(1) || '/').split('?');
    return { parts: p.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  function render() {
    const { parts, q } = parseHash(), r = parts[0] || '', app = $('#app');
    const key = r + '/' + (parts[1] || '');
    if (key !== state.route) { state.search = ''; state.route = key; state.bulkOpen = false; }
    state.q = q; state.r = r;
    if (r === 'p') {
      const code = q.c || (() => { try { return localStorage.getItem(PKEY); } catch (e) { return ''; } })();
      if (code && !state.parent) { parentLoad(String(code).trim().toUpperCase()); return; }
      app.innerHTML = viewParent(); return;
    }
    if (!Store.token()) {
      app.innerHTML = viewLogin();
      if (!state.pinged) { state.pinged = true; Store.api('ping').then(d => { if (d.needsSetup && !state.showSetup) { state.showSetup = true; render(); } }).catch(() => {}); }
      return;
    }
    if (r === 'codes') { app.innerHTML = viewCodes(q.g); return; }
    const V = { '': viewGroups, group: () => viewGroup(parts[1]), class: () => viewClass(parts[1]), students: viewStudents, student: () => viewStudent(parts[1]), settings: viewSettings };
    app.innerHTML = layout((V[r] || viewGroups)(), r);
  }
  const go = h => { if (location.hash === h) render(); else location.hash = h; };

  // إعادة الرسم عند تغيّر البيانات (بدون مقاطعة الكتابة أو اللمس)
  let dirty = false, pdown = false;
  const typing = () => { const a = document.activeElement; return a && $('#app').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox'; };
  const flush = () => { if (dirty && !typing() && !pdown) { dirty = false; render(); } };
  Store.on(changed => {
    const b = $('#badge'); if (b) b.innerHTML = badge();
    if (!changed) return;
    if (!Store.token() && state.r !== 'p') return render();
    dirty = true;
    if (!typing() && !pdown) { dirty = false; render(); }
  });
  document.addEventListener('focusout', () => setTimeout(flush, 250));
  document.addEventListener('pointerdown', () => { pdown = true; }, true);
  const up = () => setTimeout(() => { pdown = false; flush(); }, 60);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);

  // ───────── الإجراءات ─────────
  const sOf = id => Store.get('Students', id);
  const curClass = () => state.r === 'class' ? Store.get('Classes', parseHash().parts[1]) : null;
  function recRow(c, sid, patch) {
    const cur = rec(c.id, sid) || { id: recId(c.id, sid), classId: c.id, studentId: sid, attendance: '', homework: '', score: '', note: '', paid: '', amount: '', deleted: '' };
    return Object.assign({}, cur, patch, { deleted: '' });
  }
  function scoreVal(v, c) {
    const n = num(v);
    if (n == null) return '';
    if (isNaN(n) || n < 0 || (Number(c.maxScore) > 0 && n > Number(c.maxScore))) throw new Error('الدرجة لازم تكون بين 0 و ' + (c.maxScore || '…'));
    return String(n);
  }
  function amountVal(v) {
    const n = num(v);
    if (n == null) return '';
    if (isNaN(n) || n < 0) throw new Error('المبلغ غير صحيح');
    return String(n);
  }

  const acts = {
    syncNow: () => Store.sync(),
    toggleSetup: () => { state.showSetup = !state.showSetup; render(); },
    closeModal,
    print: () => window.print(),
    copy: el => navigator.clipboard.writeText(el.dataset.t).then(() => toast('تم النسخ ✓'), () => toast('تعذر النسخ', true)),
    theme: () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), n = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = n; try { localStorage.setItem('sapp_theme', n); } catch (e) { /* ignore */ }
    },
    logout: () => { if (Store.pending && !confirm('يوجد ' + Store.pending + ' تعديل لم يُرفع بعد وسيُفقد. متابعة الخروج؟')) return; if (Store.pending || confirm('تسجيل الخروج من هذا الجهاز؟')) Store.clearAll(); },
    export: () => {
      const blob = new Blob([JSON.stringify(Store.exportLocal(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'backup-' + today() + '.json'; a.click();
    },
    parentReset: () => { state.parent = null; try { localStorage.removeItem(PKEY); } catch (e) { /* ignore */ } go('#/p'); render(); },
    addGroup: () => openModal({ type: 'group' }),
    editGroup: el => openModal({ type: 'group', g: Store.get('Groups', el.dataset.id) }),
    delGroup: el => {
      const id = el.dataset.id;
      if (students(id).length || students(id, true).length) return toast('انقل الطلاب أو احذفهم أولاً', true);
      if (!confirm('حذف هذه المجموعة وكل حصصها؟')) return;
      const cl = classes(id).map(c => ({ id: c.id, deleted: '1' }));
      if (cl.length) Store.saveMany('Classes', cl);
      Store.remove('Groups', id); go('#/');
    },
    addClass: el => openModal({ type: 'class', gid: el.dataset.g }),
    editClass: el => openModal({ type: 'class', c: Store.get('Classes', el.dataset.id) }),
    delClass: el => {
      if (!confirm('حذف هذه الحصة وكل ما سُجّل فيها؟')) return;
      const c = Store.get('Classes', el.dataset.id), rel = Store.list('Records').filter(r => r.classId === c.id).map(r => ({ id: r.id, deleted: '1' }));
      if (rel.length) Store.saveMany('Records', rel);
      Store.remove('Classes', c.id); go('#/group/' + c.groupId);
    },
    addStudent: el => openModal({ type: 'student', gid: el.dataset.g || state.q.g }),
    editStudent: el => openModal({ type: 'student', s: sOf(el.dataset.id) }),
    bulkStudents: el => openModal({ type: 'bulkStudents', gid: el.dataset.g || state.q.g }),
    archive: el => { const s = sOf(el.dataset.id); Store.save('Students', { id: s.id, status: s.status === 'archived' ? 'active' : 'archived' }); },
    delStudent: el => {
      if (!confirm('حذف الطالب نهائياً؟ (يُفضّل الأرشفة)')) return;
      const s = sOf(el.dataset.id); Store.remove('Students', s.id); go('#/group/' + s.groupId + '?t=st');
    },
    regen: el => { if (confirm('توليد كود جديد؟ الكود القديم سيتوقف عن العمل.')) Store.save('Students', { id: el.dataset.id, code: genCode() }); },
    sendCode: el => {
      const s = sOf(el.dataset.id), p = P();
      openWA(s.guardianPhone, 'السلام عليكم،\nيمكنكم متابعة الطالب/ة ' + s.name + ' (الحضور، الواجب، الدرجات، المصاريف) من الرابط:\n' + parentUrl(s.code) + '\nكود الطالب: ' + s.code + '\n' + p.teacherName + ' - ' + p.subject);
    },
    // ── تسجيل الحصة ──
    setf: el => {
      const c = curClass(); if (!c) return;
      const { s, f, v } = el.dataset, cur = rec(c.id, s) || {};
      const val = cur[f] === v ? '' : v, patch = { [f]: val };
      if (f === 'paid') patch.amount = val === '1' ? (cur.amount || defFee(c) || '') : val === '0' ? '' : cur.amount || '';
      Store.save('Records', recRow(c, s, patch));
    },
    fillAll: el => {
      const c = curClass(); if (!c) return;
      const { f, v } = el.dataset;
      const rows = students(c.groupId).filter(s => !(rec(c.id, s.id) || {})[f]).map(s => {
        const patch = { [f]: v }; if (f === 'paid') patch.amount = (rec(c.id, s.id) || {}).amount || defFee(c) || '';
        return recRow(c, s.id, patch);
      });
      if (!rows.length) return toast('كل الطلاب مسجلين بالفعل');
      Store.saveMany('Records', rows); toast('تم تسجيل ' + rows.length + ' طالب ✓');
    },
    selAll: () => {
      const c = curClass(); if (!c) return;
      const st = students(c.groupId), sel = state.sel[c.id] || (state.sel[c.id] = new Set());
      if (sel.size === st.length) sel.clear(); else st.forEach(s => sel.add(s.id));
      render();
    }
  };

  const forms = {
    async firstSetup(f) {
      if (f.password !== f.password2) throw new Error('كلمتا المرور غير متطابقتين');
      const d = await Store.api('initPassword', { password: f.password });
      Store.setToken(d.token); state.showSetup = false; render(); Store.sync();
    },
    async login(f) {
      const d = await Store.api('login', { password: f.password });
      Store.setToken(d.token); render(); Store.sync();
    },
    parent(f) { parentLoad(f.code.trim().toUpperCase()); },
    group(f) {
      const g = state.modal.g || {}, fee = amountVal(f.fee);
      Store.save('Groups', { id: g.id || uid(), name: f.name.trim(), fee, note: f.note.trim(), sortOrder: g.sortOrder || String(Date.now()) });
      closeModal(); toast('تم الحفظ ✓');
    },
    class(f) {
      const c = state.modal.c || {}, id = c.id || uid(), max = amountVal(f.maxScore), fee = amountVal(f.fee);
      Store.save('Classes', { id, groupId: c.groupId || state.modal.gid, date: f.date, title: f.title.trim(), maxScore: max, fee });
      closeModal(); if (!c.id) go('#/class/' + id); else toast('تم الحفظ ✓');
    },
    student(f) {
      const x = state.modal.s || {};
      let code = enDigits(f.code).trim().toUpperCase();
      if (code) {
        if (!CODE_RE.test(code)) throw new Error('الكود من 4 إلى 12 حرفاً إنجليزياً أو رقماً');
        if (Store.list('Students').some(s => s.code === code && s.id !== x.id)) throw new Error('الكود مستخدم لطالب آخر');
      } else code = x.code || genCode();
      Store.save('Students', { id: x.id || uid(), name: f.name.trim(), groupId: f.groupId, code, guardianPhone: enDigits(f.guardianPhone).trim(), notes: f.notes.trim(), status: x.status || 'active' });
      closeModal(); toast('تم الحفظ ✓');
    },
    bulkStudents(f) {
      const used = new Set(Store.list('Students').map(s => s.code)), rows = [], bad = [];
      f.list.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
        const parts = l.split(/[,،\t;]/).map(x => x.trim());
        const name = parts.shift();
        let phone = '', code = '';
        parts.forEach(x => { const e = enDigits(x).replace(/\s/g, ''); if (/^\+?\d{9,15}$/.test(e) && !phone) phone = e; else if (e && !code) code = e.toUpperCase(); });
        if (!name) return;
        if (code && (!CODE_RE.test(code) || used.has(code))) { bad.push(name); code = ''; }
        if (!code) code = (() => { let c; do { c = genCode(); } while (used.has(c)); return c; })();
        used.add(code);
        rows.push({ id: uid(), name, groupId: f.groupId, code, guardianPhone: phone, notes: '', status: 'active' });
      });
      if (!rows.length) throw new Error('اكتب اسماً واحداً على الأقل');
      Store.saveMany('Students', rows);
      closeModal(); toast('تمت إضافة ' + rows.length + ' طالب ✓' + (bad.length ? ' · ' + bad.length + ' كود مكرر/غير صالح تم توليد بديل له' : ''));
    },
    bulkRec(f) {
      const c = curClass(); if (!c) return;
      const st = students(c.groupId), sel = state.sel[c.id] || new Set();
      const targets = f.target === 'sel' ? st.filter(s => sel.has(s.id)) : st;
      if (!targets.length) throw new Error(f.target === 'sel' ? 'لم تحدد أي طالب' : 'لا يوجد طلاب');
      const patch = {};
      if (f.clear) Object.assign(patch, { attendance: '', homework: '', score: '', note: '', paid: '', amount: '' });
      else {
        if (f.attendance) patch.attendance = f.attendance;
        if (f.homework) patch.homework = f.homework;
        if (f.paid) patch.paid = f.paid;
        const sc = scoreVal(f.score, c); if (sc !== '') patch.score = sc;
        const am = amountVal(f.amount); if (am !== '') patch.amount = am;
        if (f.note.trim()) patch.note = f.note.trim();
        if (!Object.keys(patch).length) throw new Error('اختر شيئاً لتطبيقه');
      }
      if (f.clear && !confirm('مسح بيانات ' + targets.length + ' طالب في هذه الحصة؟')) return;
      const rows = targets.map(s => {
        const p = Object.assign({}, patch), cur = rec(c.id, s.id) || {};
        if (p.paid === '1' && p.amount == null) p.amount = cur.amount || defFee(c) || '';
        if (p.paid === '0' && p.amount == null) p.amount = '';
        return recRow(c, s.id, p);
      });
      Store.saveMany('Records', rows);
      state.bulkOpen = false; f.target === 'sel' && sel.clear();
      toast('تم التطبيق على ' + rows.length + ' طالب ✓');
    },
    async password(f) {
      if (f.newPassword !== f.newPassword2) throw new Error('كلمتا المرور غير متطابقتين');
      const d = await Store.api('changePassword', { oldPassword: f.oldPassword, newPassword: f.newPassword });
      Store.setToken(d.token); toast('تم تغيير كلمة المرور ✓'); render();
    }
  };

  // ───────── ربط الأحداث ─────────
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el && acts[el.dataset.act]) { e.preventDefault(); acts[el.dataset.act](el, e); return; }
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('submit', async e => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    try { await forms[form.dataset.form](Object.fromEntries(new FormData(form)), form); }
    catch (x) { toast(x.message, true); }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  });
  document.addEventListener('change', e => {
    const el = e.target, k = el.dataset && el.dataset.chg;
    if (!k) return;
    const q = Object.assign({}, state.q);
    if (k === 'stGroup' || k === 'stArch') { q[k === 'stGroup' ? 'g' : 'arch'] = el.value; go('#/students?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v))); return; }
    const c = curClass(); if (!c) return;
    const sid = el.dataset.s;
    if (k === 'sel') {
      const sel = state.sel[c.id] || (state.sel[c.id] = new Set());
      el.checked ? sel.add(sid) : sel.delete(sid);
      el.closest('.stu').classList.toggle('sel', el.checked);
      const lab = document.querySelector('form[data-form="bulkRec"] input[value="sel"] + span'); if (lab) lab.textContent = 'المحددين فقط (' + sel.size + ')';
      const r = document.querySelector('form[data-form="bulkRec"] input[value="' + (sel.size ? 'sel' : 'all') + '"]'); if (r) r.checked = true;
      return;
    }
    const cur = rec(c.id, sid) || {};
    try {
      if (k === 'score') { const v = scoreVal(el.value, c); if (v !== (cur.score || '')) Store.save('Records', recRow(c, sid, { score: v })); }
      if (k === 'amount') { const v = amountVal(el.value); if (v !== (cur.amount || '')) Store.save('Records', recRow(c, sid, v ? { amount: v, paid: cur.paid || '1' } : { amount: v })); }
      if (k === 'note') { const v = el.value.trim(); if (v !== (cur.note || '')) Store.save('Records', recRow(c, sid, { note: v })); }
    } catch (x) { toast(x.message, true); el.value = cur[k] || ''; }
  });
  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.inp;
    if (k === 'search') { state.search = e.target.value; $('#list').innerHTML = studentRows(); }
  });
  document.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('details[data-sec="bulk"]')) state.bulkOpen = e.target.open; }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.modal) closeModal();
    const k = e.target.dataset && e.target.dataset.chg;
    if (e.key === 'Enter' && (k === 'score' || k === 'amount' || k === 'note')) {
      e.preventDefault();
      const all = [...document.querySelectorAll('input[data-chg="' + k + '"]')], i = all.indexOf(e.target);
      if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
    }
  });
  window.addEventListener('hashchange', render);

  // ───────── التشغيل ─────────
  (async () => {
    try { const th = localStorage.getItem('sapp_theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }
    document.documentElement.style.setProperty('--pri', CONFIG.primaryColor || '#14532d');
    document.title = CONFIG.appName;
    try { await Store.init(); } catch (e) { toast('تعذر فتح التخزين المحلي: ' + e.message, true); }
    render();
    Store.sync();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
