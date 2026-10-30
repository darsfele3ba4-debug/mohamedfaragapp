/* طبقة البيانات: الكلام مع الـ API + كاش IndexedDB + طابور التعديلات (outbox) + المزامنة.
   باقي التطبيق لا يعرف أي شيء عن Google Sheets. */
window.Store = (() => {
  const ENTS = ['Groups', 'Students', 'Classes', 'Records', 'Settings'];
  const FALLBACK = { profile: {} };
  const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
  const KEY = 'sapp_' + hash(CONFIG.apiUrl);
  const data = {}; ENTS.forEach(e => data[e] = new Map());
  const outbox = new Map();
  const listeners = new Set();
  let db, status = 'idle', lastError = '', syncing = false, timer = null, version = 0;

  // ───── IndexedDB (غلاف صغير) ─────
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function openDB() {
    const r = indexedDB.open(KEY, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      ENTS.forEach(e => { if (!d.objectStoreNames.contains(e)) d.createObjectStore(e, { keyPath: 'id' }); });
      ['outbox', 'meta'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
    };
    return req(r);
  }
  function tx(stores, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(stores, 'readwrite');
      fn(t);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const meta = k => req(db.transaction('meta').objectStore('meta').get(k));
  const setMeta = (k, v) => tx(['meta'], t => t.objectStore('meta').put(v, k));

  async function init() {
    db = await openDB();
    for (const e of ENTS) (await req(db.transaction(e).objectStore(e).getAll())).forEach(r => data[e].set(r.id, r));
    await new Promise(res => {
      const c = db.transaction('outbox').objectStore('outbox').openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { outbox.set(cur.key, cur.value); cur.continue(); } else res(); };
      c.onerror = () => res();
    });
    window.addEventListener('online', () => sync());
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    setInterval(() => sync(), 90000);
  }

  // ───── الحالة والمستمعين ─────
  const emit = changed => { if (changed) version++; listeners.forEach(f => f(changed)); };
  const setStatus = (s, err) => { status = s; lastError = err || ''; emit(false); };
  const on = f => listeners.add(f);

  // ───── الجلسة ─────
  const token = () => localStorage.getItem(KEY + '_token');
  const setToken = t => t ? localStorage.setItem(KEY + '_token', t) : localStorage.removeItem(KEY + '_token');

  // ───── API ─────
  async function api(action, payload) {
    if (!CONFIG.apiUrl || !/^https:\/\/script\.google/.test(CONFIG.apiUrl)) throw Object.assign(new Error('لم يتم ضبط رابط الـ API في ملف config.js'), { code: 'NO_API' });
    let res;
    try {
      res = await fetch(CONFIG.apiUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: token(), payload: payload || {} })
      });
    } catch (e) { throw Object.assign(new Error('تعذر الاتصال بالخادم'), { code: 'NET' }); }
    let j;
    try { j = await res.json(); } catch (e) { throw Object.assign(new Error('رد غير متوقع من الخادم. تأكد من نشر الـ Script كـ Web App متاح لـ Anyone'), { code: 'BAD_RESPONSE' }); }
    if (!j.ok) throw Object.assign(new Error((j.error && j.error.message) || 'خطأ غير معروف'), { code: j.error && j.error.code });
    return j.data;
  }

  // ───── القراءة ─────
  const list = e => [...data[e].values()].filter(r => r.deleted !== '1');
  const get = (e, id) => { const r = data[e].get(id); return r && r.deleted !== '1' ? r : null; };
  function setting(k) {
    const r = data.Settings.get(k);
    if (r) try { return JSON.parse(r.value); } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(FALLBACK[k] ?? null));
  }

  // ───── الكتابة (محلياً فوراً + طابور) ─────
  async function saveMany(e, rowsIn) {
    const now = String(Date.now());
    const out = rowsIn.map(row => {
      const r = Object.assign({}, data[e].get(row.id) || {}, row, { updatedAt: now });
      if (!r.createdAt) r.createdAt = now;
      if (r.deleted == null) r.deleted = '';
      data[e].set(r.id, r);
      outbox.set(e + ':' + r.id, { entity: e, row: r });
      return r;
    });
    await tx([e, 'outbox'], t => out.forEach(r => {
      t.objectStore(e).put(r);
      t.objectStore('outbox').put({ entity: e, row: r }, e + ':' + r.id);
    }));
    emit(true);
    clearTimeout(timer); timer = setTimeout(sync, 1500);
    return out;
  }
  const save = (e, row) => saveMany(e, [row]).then(r => r[0]);
  const remove = (e, id) => save(e, { id, deleted: '1' });
  const saveSetting = (k, v) => save('Settings', { id: k, value: JSON.stringify(v) });

  async function mergeRows(e, rows, force) {
    const puts = [];
    rows.forEach(r => {
      const loc = data[e].get(r.id);
      if (!force && (outbox.has(e + ':' + r.id) || (loc && Number(loc.updatedAt) > Number(r.updatedAt)))) return;
      data[e].set(r.id, r); puts.push(r);
    });
    if (puts.length) await tx([e], t => puts.forEach(r => t.objectStore(e).put(r)));
    return puts.length;
  }

  // ───── المزامنة ─────
  async function sync() {
    if (syncing || !token()) return;
    if (!navigator.onLine) return setStatus('offline');
    syncing = true; setStatus('syncing');
    let changed = 0;
    try {
      // 1) إرسال التعديلات المعلقة على دفعات
      const entries = [...outbox.entries()];
      for (let i = 0; i < entries.length; i += 300) {
        const chunk = entries.slice(i, i + 300);
        const sent = new Map(chunk.map(([k, v]) => [k, v.row.updatedAt]));
        const res = await api('batchWrite', { ops: chunk.map(([, v]) => ({ entity: v.entity, row: v.row })) });
        const done = [];
        for (const r of res.results) {
          const k = r.entity + ':' + r.id;
          const cur = outbox.get(k);
          if (!cur || cur.row.updatedAt !== sent.get(k)) continue; // اتعدّل تاني أثناء الإرسال
          outbox.delete(k); done.push(k);
          if (r.error) lastError = r.error;
          else changed += await mergeRows(r.entity, [r.row], true);
        }
        if (done.length) await tx(['outbox'], t => done.forEach(k => t.objectStore('outbox').delete(k)));
      }
      // 2) سحب التغييرات من الخادم
      const since = await meta('since');
      const d = since ? await api('syncSince', { since: since - 120000 }) : await api('bootstrap');
      for (const e of Object.keys(d.tables)) {
        const { cols, rows } = d.tables[e];
        changed += await mergeRows(e, rows.map(a => Object.fromEntries(cols.map((c, i) => [c, a[i]]))), false);
      }
      await setMeta('since', d.serverTime);
      syncing = false;
      setStatus(outbox.size ? 'pending' : 'synced');
    } catch (e) {
      syncing = false;
      if (e.code === 'AUTH') { setToken(null); setStatus('idle'); emit(true); return; }
      setStatus(e.code === 'NET' ? 'offline' : 'error', e.message);
    }
    if (changed) emit(true);
  }

  async function clearAll() {
    setToken(null);
    if (db) db.close();
    await req(indexedDB.deleteDatabase(KEY)).catch(() => {});
    location.reload();
  }

  function exportLocal() {
    const out = {};
    ENTS.forEach(e => out[e] = list(e));
    return { exportedAt: new Date().toISOString(), data: out };
  }

  return {
    init, on, api, sync, list, get, setting, save, saveMany, remove, saveSetting, token, setToken, clearAll, exportLocal,
    get status() { return status; }, get lastError() { return lastError; },
    get pending() { return outbox.size; }, get version() { return version; }
  };
})();
