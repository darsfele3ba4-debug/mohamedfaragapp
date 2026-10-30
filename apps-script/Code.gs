/**
 * متابعة الطلاب (النسخة المبسطة): الخادم على Google Apps Script
 * ---------------------------------------------------------------
 * 1) افتح Google Sheet جديد ← Extensions ← Apps Script، والصق هذا الملف كاملاً واحفظ.
 * 2) Deploy ← New deployment ← Web app ← Execute as: Me ← Who has access: Anyone ← Deploy.
 * 3) انسخ رابط الـ Web app (ينتهي بـ /exec).
 * 4) افتح التطبيق، واضغط «إعداد أول مرة» واختر كلمة المرور (الأوراق تُنشأ تلقائياً).
 * نسيت كلمة المرور؟ شغّل resetPassword() من المحرر، ثم اختر كلمة مرور جديدة من التطبيق.
 */

const BASE = ['id', 'createdAt', 'updatedAt', 'syncedAt', 'deleted'];
const ENT = {
  Groups: ['name', 'note', 'sortOrder', 'fee'],
  Students: ['code', 'name', 'groupId', 'guardianPhone', 'notes', 'status'],
  Classes: ['groupId', 'date', 'title', 'maxScore', 'fee'],
  Records: ['classId', 'studentId', 'attendance', 'homework', 'score', 'note', 'paid', 'amount'],
  Settings: ['value']
};
const RULES = {
  Groups: { req: ['name'] },
  Students: { req: ['name', 'groupId', 'code'], enums: { status: ['active', 'archived'] } },
  Classes: { req: ['groupId', 'date'] },
  Records: { req: ['classId', 'studentId'], enums: { attendance: ['present', 'absent'], homework: ['done', 'missing'], paid: ['1', '0'] }, nums: ['score', 'amount'] },
  Settings: { req: [] }
};
const SETUP_VERSION = 's1';
const SESSION_DAYS = 30;
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = /^[A-Z0-9]{4,12}$/;
const PUBLIC = { ping: 1, login: 1, initPassword: 1, parentPortal: 1 };
const DEFAULTS = { profile: {} };

// ───────────────────────── Router ─────────────────────────
function doGet() { return out({ ok: true, data: { app: 'students-lite-api' } }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    ensureSetup();
    const fn = ACTIONS[req.action];
    if (!fn) throw err('BAD_ACTION', 'إجراء غير معروف');
    if (!PUBLIC[req.action]) requireToken(req.token);
    return out({ ok: true, data: fn(req.payload || {}, req) });
  } catch (x) {
    return out({ ok: false, error: { code: x.code || 'SERVER', message: x.code ? x.message : 'خطأ في الخادم: ' + x.message } });
  }
}

const ACTIONS = { ping: ping, login: login, initPassword: initPassword, logout: logout, changePassword: changePassword, bootstrap: bootstrap, syncSince: syncSince, batchWrite: batchWrite, exportBackup: exportBackup, parentPortal: parentPortal };

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err(code, msg) { const e = new Error(msg); e.code = code; return e; }
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function props() { return PropertiesService.getScriptProperties(); }
function cache() { return CacheService.getScriptCache(); }
function cols(e) { return BASE.concat(ENT[e]); }

// ───────────────────────── Setup ─────────────────────────
function ensureSetup() {
  if (props().getProperty('SETUP_V') === SETUP_VERSION && ss().getSheetByName('Settings')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { if (!ss().getSheetByName('Settings') || props().getProperty('SETUP_V') !== SETUP_VERSION) setup(); }
  finally { lock.releaseLock(); }
}

function setup() {
  Object.keys(ENT).forEach(function (e) { ensureSheet(e, cols(e)); });
  ensureSheet('Sessions', ['tokenHash', 'expiresAt', 'createdAt']);
  ensureSheet('AuditLog', ['at', 'action', 'detail']);
  const t = table('Settings');
  const have = {};
  t.vals.forEach(function (r) { have[String(r[0])] = 1; });
  const now = String(Date.now());
  const add = [];
  Object.keys(DEFAULTS).forEach(function (k) { if (!have[k]) add.push([k, now, now, now, '', JSON.stringify(DEFAULTS[k])]); });
  if (add.length) writeBlock(t.sh, t.vals.length + 2, add);
  props().setProperty('SETUP_V', SETUP_VERSION);
  Logger.log('✅ الأوراق جاهزة.');
}

function resetPassword() {
  const pr = props();
  pr.deleteProperty('PW_HASH');
  pr.deleteProperty('PW_SALT');
  clearSessions();
  Logger.log('🔑 تم مسح كلمة المرور. افتح التطبيق واختر كلمة مرور جديدة.');
}

function ensureSheet(name, header) {
  let sh = ss().getSheetByName(name);
  if (!sh) sh = ss().insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@'); // نص: يحافظ على الصفر في أول رقم الهاتف والتواريخ
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

// ───────────────────────── Sheet helpers ─────────────────────────
function table(e) {
  const sh = ss().getSheetByName(e);
  if (!sh) throw err('NOT_SETUP', 'لم يتم الإعداد: شغّل setup() من محرر Apps Script');
  const h = ENT[e] ? cols(e) : sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const last = sh.getLastRow();
  const vals = last > 1 ? sh.getRange(2, 1, last - 1, h.length).getValues().map(function (r) { return r.map(String); }) : [];
  return { sh: sh, h: h, vals: vals };
}
function toObj(h, r) { const o = {}; h.forEach(function (k, i) { o[k] = r[i] == null ? '' : String(r[i]); }); return o; }
function rows(e) { const t = table(e); return t.vals.map(function (r) { return toObj(t.h, r); }); }

function writeBlock(sh, startRow, data) {
  const need = startRow + data.length - 1;
  const max = sh.getMaxRows();
  if (need > max) {
    sh.insertRowsAfter(max, need - max);
    sh.getRange(max + 1, 1, need - max, data[0].length).setNumberFormat('@');
  }
  sh.getRange(startRow, 1, data.length, data[0].length).setValues(data);
}

function audit(action, detail) {
  const sh = ss().getSheetByName('AuditLog');
  if (sh) sh.appendRow([new Date().toISOString(), action, String(detail || '').slice(0, 500)]);
}

// ───────────────────────── Auth ─────────────────────────
function sha(s) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hashPw(pw, salt) { let h = salt + pw; for (let i = 0; i < 300; i++) h = sha(salt + h); return h; }
function genCode() {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random());
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_CHARS[(b[i] + 256) % CODE_CHARS.length];
  return s;
}
function gen() { return props().getProperty('SESSION_GEN') || '1'; }

function newSession() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  ss().getSheetByName('Sessions').appendRow([sha(token), String(Date.now() + SESSION_DAYS * 864e5), String(Date.now())]);
  return token;
}

function requireToken(token) {
  if (!token) throw err('AUTH', 'يجب تسجيل الدخول');
  const th = sha(String(token));
  const key = 't_' + gen() + '_' + th;
  if (cache().get(key)) return;
  const sh = ss().getSheetByName('Sessions');
  const last = sh.getLastRow();
  const vals = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  const now = Date.now();
  const ok = vals.some(function (r) { return String(r[0]) === th && Number(r[1]) > now; });
  if (!ok) throw err('AUTH', 'انتهت الجلسة، سجّل الدخول مرة أخرى');
  cache().put(key, '1', 21600);
}

function clearSessions() {
  const sh = ss().getSheetByName('Sessions');
  if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  props().setProperty('SESSION_GEN', String(Number(gen()) + 1));
}

function checkLock() {
  const fails = Number(cache().get('loginFails') || 0);
  if (fails >= 5) throw err('LOCKED', 'محاولات خاطئة كثيرة، حاول بعد 15 دقيقة');
  return fails;
}
function failLogin(fails, code, msg) {
  cache().put('loginFails', String(fails + 1), 900);
  Utilities.sleep(800);
  throw err(code, msg);
}

function setPassword(pw) {
  pw = String(pw || '');
  if (pw.length < 6) throw err('BAD', 'كلمة المرور يجب ألا تقل عن 6 أحرف');
  const salt = Utilities.getUuid();
  props().setProperties({ PW_SALT: salt, PW_HASH: hashPw(pw, salt) });
}
function verifyPassword(pw) {
  const pr = props();
  return hashPw(String(pw || ''), pr.getProperty('PW_SALT')) === pr.getProperty('PW_HASH');
}

function ping() { return { serverTime: Date.now(), needsSetup: !props().getProperty('PW_HASH') }; }

function initPassword(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (props().getProperty('PW_HASH')) throw err('ALREADY', 'كلمة المرور معيّنة بالفعل، سجّل الدخول');
    setPassword(p.password);
  } finally { lock.releaseLock(); }
  audit('initPassword', '');
  return { token: newSession() };
}

function login(p) {
  const fails = checkLock();
  if (!props().getProperty('PW_HASH')) throw err('NEEDS_SETUP', 'لم يتم تعيين كلمة المرور بعد');
  if (!verifyPassword(p.password)) failLogin(fails, 'BAD_LOGIN', 'كلمة المرور غير صحيحة');
  cache().remove('loginFails');
  audit('login', '');
  return { token: newSession() };
}

function logout(p, req) {
  const th = sha(String(req.token));
  const sh = ss().getSheetByName('Sessions');
  const last = sh.getLastRow();
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === th) sh.deleteRow(i + 2);
  }
  cache().remove('t_' + gen() + '_' + th);
  return {};
}

function changePassword(p) {
  if (!verifyPassword(p.oldPassword)) { Utilities.sleep(800); throw err('BAD_LOGIN', 'كلمة المرور الحالية غير صحيحة'); }
  setPassword(p.newPassword);
  clearSessions();
  audit('changePassword', '');
  return { token: newSession() };
}

// ───────────────────────── Data ─────────────────────────
function packTables(filterFn) {
  const tables = {};
  Object.keys(ENT).forEach(function (e) {
    const t = table(e);
    tables[e] = { cols: t.h, rows: t.vals.filter(filterFn) };
  });
  return tables;
}

function bootstrap() {
  return { serverTime: Date.now(), tables: packTables(function (r) { return r[4] !== '1'; }) };
}

function syncSince(p) {
  const now = Date.now();
  const since = Number(p.since) || 0;
  return { serverTime: now, tables: packTables(function (r) { return Number(r[3]) > since; }) };
}

function validate(e, row) {
  if (!row || typeof row !== 'object') throw err('BAD', 'بيانات غير صالحة');
  const o = {};
  cols(e).forEach(function (k) {
    let v = row[k];
    if (v === true) v = '1'; else if (v === false) v = '0'; else if (v == null) v = '';
    v = String(v);
    if (k !== 'value' && v.length > 2000) v = v.slice(0, 2000);
    o[k] = v;
  });
  if (!/^[\w-]{1,90}$/.test(o.id)) throw err('BAD', 'معرّف غير صالح');
  if (!o.updatedAt) o.updatedAt = String(Date.now());
  if (!o.createdAt) o.createdAt = o.updatedAt;
  if (o.deleted !== '1') {
    const r = RULES[e];
    r.req.forEach(function (k) { if (!o[k]) throw err('BAD', 'حقل مطلوب ناقص: ' + k); });
    Object.keys(r.enums || {}).forEach(function (k) {
      if (o[k] && r.enums[k].indexOf(o[k]) < 0) throw err('BAD', 'قيمة غير صالحة في: ' + k);
    });
    (r.nums || []).forEach(function (k) { if (o[k] !== '' && !(Number(o[k]) >= 0)) throw err('BAD', 'رقم غير صالح في: ' + k); });
  }
  if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw err('BAD', 'تاريخ غير صالح');
  if (e === 'Settings' && o.value.length > 50000) throw err('BAD', 'الإعدادات أكبر من المسموح');
  return o;
}

function batchWrite(p) {
  const ops = p.ops || [];
  if (!Array.isArray(ops) || ops.length > 500) throw err('BAD', 'عدد عمليات غير صالح');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const now = String(Date.now());
    const results = [];
    const auditRows = [];
    const byE = {};
    ops.forEach(function (o) {
      if (!o || !ENT[o.entity]) { results.push({ entity: o && o.entity, id: o && o.row && o.row.id, error: 'كيان غير معروف' }); return; }
      (byE[o.entity] = byE[o.entity] || []).push(o.row);
    });

    Object.keys(byE).forEach(function (e) {
      const t = table(e), h = t.h, idx = {};
      t.vals.forEach(function (r, i) { idx[r[0]] = i; });
      const baseLen = t.vals.length;
      const changed = {};
      const codeOwner = {};
      if (e === 'Students') {
        const ci = h.indexOf('code');
        t.vals.forEach(function (r) { if (r[4] !== '1') codeOwner[r[ci]] = r[0]; });
      }

      byE[e].forEach(function (row) {
        try {
          if (e === 'Students' && row && row.code) row.code = String(row.code).trim().toUpperCase();
          const o = validate(e, row);
          const i = idx[o.id];
          if (i !== undefined) {
            const cur = t.vals[i];
            if (Number(cur[2]) > Number(o.updatedAt)) { results.push({ entity: e, id: o.id, row: toObj(h, cur) }); return; }
            o.createdAt = cur[1] || o.createdAt;
          }
          if (e === 'Students' && o.deleted !== '1') {
            const owner = codeOwner[o.code];
            if (!CODE_RE.test(o.code) || (owner && owner !== o.id)) {
              do { o.code = genCode(); } while (codeOwner[o.code]);
            }
            codeOwner[o.code] = o.id;
          }
          o.syncedAt = now;
          const arr = h.map(function (k) { return o[k]; });
          if (i !== undefined) { t.vals[i] = arr; changed[i] = 1; }
          else { idx[o.id] = t.vals.length; t.vals.push(arr); }
          if (o.deleted === '1') auditRows.push([new Date().toISOString(), 'delete', e + ':' + o.id]);
          results.push({ entity: e, id: o.id, row: toObj(h, arr) });
        } catch (x) {
          results.push({ entity: e, id: row && row.id, error: x.message });
        }
      });

      const changedIdx = Object.keys(changed).map(Number).filter(function (i) { return i < baseLen; });
      if (changedIdx.length > 20) {
        writeBlock(t.sh, 2, t.vals);
      } else {
        changedIdx.forEach(function (i) { t.sh.getRange(i + 2, 1, 1, h.length).setValues([t.vals[i]]); });
        if (t.vals.length > baseLen) writeBlock(t.sh, baseLen + 2, t.vals.slice(baseLen));
      }
    });

    if (auditRows.length) { const a = ss().getSheetByName('AuditLog'); writeBlock(a, a.getLastRow() + 1, auditRows); }
    return { results: results, serverTime: Number(now) };
  } finally {
    lock.releaseLock();
  }
}

function exportBackup() {
  const data = {};
  Object.keys(ENT).forEach(function (e) { data[e] = rows(e); });
  audit('exportBackup', '');
  return { exportedAt: new Date().toISOString(), data: data };
}

// ───────────────────────── بوابة ولي الأمر ─────────────────────────
function parentPortal(p) {
  const fails = Number(cache().get('pFails') || 0);
  if (fails >= 60) throw err('LOCKED', 'الخدمة مشغولة، حاول بعد قليل');
  const code = String(p.code || '').trim().toUpperCase();
  const st = CODE_RE.test(code)
    ? rows('Students').filter(function (s) { return s.code === code && s.deleted !== '1' && s.status !== 'archived'; })[0]
    : null;
  if (!st) {
    cache().put('pFails', String(fails + 1), 600);
    Utilities.sleep(700);
    throw err('NOT_FOUND', 'الكود غير صحيح');
  }
  const g = rows('Groups').filter(function (x) { return x.id === st.groupId && x.deleted !== '1'; })[0];
  const cls = {};
  rows('Classes').forEach(function (c) { if (c.deleted !== '1') cls[c.id] = c; });
  const records = rows('Records').filter(function (r) { return r.studentId === st.id && r.deleted !== '1' && cls[r.classId]; })
    .map(function (r) {
      const c = cls[r.classId];
      return { date: c.date, title: c.title, max: c.maxScore, attendance: r.attendance, homework: r.homework, score: r.score, note: r.note, paid: r.paid, amount: r.amount };
    });
  let profile = {};
  rows('Settings').forEach(function (s) { if (s.id === 'profile') { try { profile = JSON.parse(s.value); } catch (x) { } } });
  return { student: { name: st.name, group: g ? g.name : '', code: st.code }, records: records, settings: { profile: profile } };
}
