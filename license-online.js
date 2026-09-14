/* =========================================================
   التفعيل الأونلاين — «الجدول الأسبوعي للمدارس المهنية»
   ---------------------------------------------------------
   آلية العمل:
   1) يعمل التطبيق أوفلاين دائماً بعد أول تفعيل.
   2) عند أول تشغيل (أو عند فتح نافذة التفعيل) يُسجّل الجهاز نفسه
      في Realtime Database بحالة pending = «طلب تفعيل».
   3) تفتح أنت admin.html فترى الطلب، وتضغط «تفعيل».
   4) التطبيق يكتشف الحالة تلقائياً (كل 8 ثوان والنافذة مفتوحة،
      وكل 25 ثانية في الخلفية) فيُفعّل نفسه بدون أي رمز.
   5) إن ضغطت «إلغاء» من اللوحة، يُقفل الجهاز عند أول اتصال.
   ========================================================= */

const CDN = 'https://www.gstatic.com/firebasejs/10.14.1/';
const CFG = window.MAHANI_CONFIG || {};
const APP_ID = CFG.appId || 'vts-professional-timetable';
const LICENSE_KEY = 'vts_online_license_v1';
const META_KEY = 'vts_online_meta_v1';
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

let fbApp = null;
let fbDb = null;
let dbModule = null;
let pollTimer = null;
let inFlight = false;
let SESSION_LICENSE = null;   /* رخصة مؤقتة بالجلسة إذا تعذّر الحفظ المحلي (ذاكرة ممتلئة) */

const state = {
  ready: false,
  configured: false,
  status: 'unknown',   // unknown | pending | active | revoked | error | offline
  message: '',
  checking: false
};

/* ---------- أدوات مساعدة ---------- */
function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } }
function nowMs() { return Date.now(); }

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}
function hashWide(text, rounds) {
  let out = '', seed = String(text);
  for (let r = 0; r < (rounds || 7); r++) {
    seed = (CFG.onlineSecret || '') + '|' + r + '|' + seed + '|' + hash32(seed + '|' + r);
    out += ('00000000' + hash32(seed).toString(16)).slice(-8);
  }
  return out.toUpperCase();
}

/* ---------- رمز الجهاز ---------- */
function normalizeDevice(value) {
  const shown = String(value == null ? '' : value)
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim().toUpperCase();
  const compact = shown.replace(/[^A-Z0-9]/g, '');
  return /^VTS(?:[\s_-]|$)/.test(shown) ? compact.slice(3) : compact;
}
function deviceClean() {
  try { if (typeof getActivationDeviceClean === 'function') return getActivationDeviceClean() || ''; } catch (e) {}
  try { if (typeof getActivationDeviceCode === 'function') return normalizeDevice(getActivationDeviceCode()); } catch (e) {}
  return '';
}
function deviceFormatted() {
  const clean = deviceClean();
  if (!clean) return '';
  try { if (typeof vtsFormatDeviceCode === 'function') return vtsFormatDeviceCode(clean); } catch (e) {}
  return 'VTS-' + clean.slice(0, 4) + '-' + clean.slice(4, 8) + '-' + clean.slice(8, 12);
}

/* ---------- الرخصة المحلية (تعمل للأبد بعد التفعيل) ---------- */
function signatureFor(device, grantedAt) {
  return hashWide(device + '|' + APP_ID + '|' + String(grantedAt), 4);
}
function localLicenseValid() {
  const device = deviceClean();
  if (!device) return false;
  /* 1) رخصة الجلسة (تعمل حتى لو التخزين المحلي معطل) */
  if (typeof SESSION_LICENSE !== 'undefined' && SESSION_LICENSE &&
      SESSION_LICENSE.app === APP_ID && SESSION_LICENSE.device === device &&
      SESSION_LICENSE.sig === signatureFor(device, SESSION_LICENSE.grantedAt || '')) return true;
  /* 2) الرخصة المحفوظة دائماً */
  const rec = readJSON(LICENSE_KEY);
  if (!rec || rec.app !== APP_ID) return false;
  if (rec.device !== device) return false;
  return rec.sig === signatureFor(device, rec.grantedAt || '');
}
function grantLocal(info) {
  const device = deviceClean();
  if (!device) return null;
  const grantedAt = new Date().toISOString();
  const rec = {
    app: APP_ID,
    device: device,
    grantedAt: grantedAt,
    expiresAt: Number(info && info.expiresAt) || 0,
    plan: String((info && info.plan) || ''),
    sig: signatureFor(device, grantedAt),
    source: 'online',
    note: (info && info.note) || ''
  };
  const saved = writeJSON(LICENSE_KEY, rec);
  if (!saved) SESSION_LICENSE = rec;   /* الذاكرة ممتلئة: التفعيل يبقى سارياً لهذه الجلسة */
  return rec;
}
function revokeLocal() {
  SESSION_LICENSE = null;
  try { localStorage.removeItem(LICENSE_KEY); } catch (e) {}
}

/* ---------- نوع الجهاز ---------- */
function detectDeviceType(){
  try{
    const ua = String(navigator.userAgent || '');
    const uaData = navigator.userAgentData;
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
    if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
    if (uaData && uaData.mobile === true) return 'mobile';
    if (uaData && uaData.mobile === false) return 'desktop';
    return 'desktop';
  }catch(e){ return 'unknown'; }
}

/* ---------- بيانات المدرسة المرسلة مع الطلب ---------- */
function schoolInfo() {
  const out = { school: '', principal: '', phone: '' };
  try {
    const s = (window.STATE && window.STATE.settings) || {};
    out.school = String(s.schoolName || '').slice(0, 120);
    out.principal = String(s.principalName || '').slice(0, 120);
    out.phone = String(s.schoolPhone || s.phone || '').slice(0, 40);
  } catch (e) {}
  return out;
}

/* ---------- Firebase ---------- */
function configLooksValid() {
  const c = CFG.firebase || {};
  const url = String(c.databaseURL || '');
  return /^https:\/\/[A-Za-z0-9-]+\.firebaseio\.com\/?$/.test(url) ||
         /^https:\/\/[A-Za-z0-9-]+\.[A-Za-z0-9.-]+\.firebaseio\.com\/?$/.test(url);
}
async function ensureDb() {
  if (fbDb && dbModule) return { db: fbDb, mod: dbModule };
  if (!configLooksValid()) throw new Error('إعدادات Firebase غير مكتملة في config.js');
  const { initializeApp } = await import(CDN + 'firebase-app.js');
  dbModule = await import(CDN + 'firebase-database.js');
  fbApp = initializeApp(CFG.firebase);
  fbDb = dbModule.getDatabase(fbApp);
  return { db: fbDb, mod: dbModule };
}
function deviceRef(mod, db, device) {
  return mod.ref(db, 'apps/' + APP_ID + '/devices/' + device);
}

/* ---------- الفحص الرئيسي ---------- */
async function checkNow(options) {
  options = options || {};
  const device = deviceClean();
  if (!device) {
    setStatus('error', 'تعذّر تحديد رمز الجهاز.');
    return 'error';
  }
  if (!configLooksValid()) {
    state.configured = false;
    setStatus('error', 'التفعيل الأونلاين غير مُعدّ — استخدم رمز التفعيل اليدوي أو راسل الدعم.');
    return 'error';
  }
  if (inFlight) return state.status;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus('offline', 'لا يوجد اتصال بالإنترنت — التطبيق يعمل بالوضع الحالي.');
    return 'offline';
  }
  inFlight = true;
  state.checking = true;
  setStatus(state.status === 'active' ? 'active' : 'pending', 'جارٍ الاتصال بخادم التفعيل…');

  try {
    const { db, mod } = await ensureDb();
    const node = deviceRef(mod, db, device);
    const snap = await mod.get(node);
    const data = snap.exists() ? (snap.val() || {}) : null;
    const now = nowMs();
    const info = schoolInfo();

    if (!data) {
      if (!CFG.autoRegisterOnStart && !options.manual) {
        setStatus('pending', 'اضغط «إرسال طلب تفعيل» لإرسال رمز جهازك للإدارة.');
        return 'pending';
      }
      const payload = {
        device: device,
        code: deviceFormatted(),
        status: 'pending',
        school: info.school,
        principal: info.principal,
        phone: info.phone,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        origin: location.origin,
        ua: String(navigator.userAgent || '').slice(0, 180)
      };
      await mod.set(node, payload);
      writeJSON(META_KEY, { lastCheck: now });
      setStatus('pending', 'تم إرسال طلب التفعيل — سيُفعّل تلقائياً فور موافقة الإدارة. لا تُغلق الصفحة.');
      return 'pending';
    }

    if (data.status === 'active') {
      const expiresAt = Number(data.expiresAt || 0);

      /* انتهت الصلاحية؟ يُقفل التطبيق حتى التجديد */
      if (expiresAt && now > expiresAt) {
        revokeLocal();
        writeJSON(META_KEY, { lastCheck: now });
        setStatus('expired', '⏰ انتهت صلاحية التفعيل — يرجى التجديد من الإدارة.');
        try { if (typeof syncActivationUI === 'function') syncActivationUI(); } catch (e) {}
        return 'expired';
      }

      grantLocal({ expiresAt: expiresAt, plan: data.plan, note: data.note });

      /* مزامنة بيانات المدرسة/المدير/الهاتف/نوع الجهاز حتى بعد التفعيل (حقول مسموح بها في القواعد) */
      const dtype = detectDeviceType();
      const patch = { lastSeenAt: now };
      if (info.school && info.school !== String(data.school || '')) patch.school = info.school;
      if (info.principal && info.principal !== String(data.principal || '')) patch.principal = info.principal;
      if (info.phone && info.phone !== String(data.phone || '')) patch.phone = info.phone;
      if (!data.deviceType || data.deviceType !== dtype) patch.deviceType = dtype;
      try { await mod.update(node, patch); } catch (e) {}

      writeJSON(META_KEY, { lastCheck: now, lastSeenAt: now });
      setStatus('active', expiresAt ? ('التطبيق مُفعّل ✓ — حتى ' + new Date(expiresAt).toLocaleDateString('ar-IQ')) : 'التطبيق مُفعّل ✓ (دائم)');
      onActivated();
      return 'active';
    }

    if (data.status === 'revoked') {
      revokeLocal();
      writeJSON(META_KEY, { lastCheck: now });
      setStatus('revoked', 'تم إلغاء تفعيل هذا الجهاز — تواصل مع الدعم.');
      try { if (typeof syncActivationUI === 'function') syncActivationUI(); } catch (e) {}
      return 'revoked';
    }

    /* pending: حدّث آخر ظهور كل نصف ساعة فقط */
    const patch = { lastSeenAt: now, updatedAt: now };
    if (info.school) patch.school = info.school;
    if (info.principal) patch.principal = info.principal;
    if (info.phone) patch.phone = info.phone;
    if (!data.lastSeenAt || now - Number(data.lastSeenAt || 0) > 30 * 60 * 1000) {
      try { await mod.update(node, patch); } catch (e) {}
    }
    writeJSON(META_KEY, { lastCheck: now });
    setStatus('pending', 'طلبك قيد الانتظار ⏳ — سيُفعّل تلقائياً فور موافقة الإدارة.');
    return 'pending';
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    setStatus('error', 'تعذّر الاتصال بخادم التفعيل — يمكنك استخدام رمز التفعيل اليدوي.');
    return 'error';
  } finally {
    inFlight = false;
    state.checking = false;
    state.ready = true;
    renderStatus();
    schedule();
  }
}

function setStatus(status, message) {
  state.status = status;
  state.message = message || '';
  renderStatus();
}

/* ---------- ما بعد التفعيل ---------- */
function onActivated() {
  let pending = null;
  try { pending = (typeof VTS_PENDING_GENERATION !== 'undefined') ? VTS_PENDING_GENERATION : null; } catch (e) {}
  try { VTS_PENDING_GENERATION = null; } catch (e) {}
  try { if (typeof closeActivationDialog === 'function') closeActivationDialog(false); } catch (e) {}
  try { if (typeof syncActivationUI === 'function') syncActivationUI(); } catch (e) {}
  try { if (typeof showLicenseToast === 'function') showLicenseToast('✓ تم تفعيل التطبيق أونلاين.', false); } catch (e) {}
  stopPolling();
  schedule();
  if (pending && typeof runGenerator === 'function') {
    setTimeout(() => { try { runGenerator(pending.newSeed); } catch (e) {} }, 60);
  }
}

/* ---------- واجهة المستخدم داخل نافذة التفعيل ---------- */
const TEXTS = {
  pending: '⏳ طلبك قيد الانتظار — سيُفعّل تلقائياً فور موافقة الإدارة.',
  active: '✓ التطبيق مُفعّل — لا تحتاج أي رمز.',
  revoked: '🚫 تم إلغاء تفعيل هذا الجهاز. تواصل مع الدعم.',
  offline: '📴 لا يوجد إنترنت — يمكنك استخدام رمز التفعيل اليدوي.',
  unknown: 'اضغط «إرسال طلب تفعيل» لإرسال رمز جهازك للإدارة.',
  error: '⚠️ تعذّر الاتصال بالخادم — يمكنك استخدام رمز التفعيل اليدوي.'
};

function renderStatus() {
  const box = document.getElementById('licenseOnlineBox');
  const statusEl = document.getElementById('licenseOnlineStatus');
  const btn = document.getElementById('licenseOnlineBtn');
  if (!box) return;
  box.dataset.status = state.status;
  if (statusEl) {
    statusEl.textContent = state.checking && state.status !== 'active' ? 'جارٍ الاتصال…' : (state.message || TEXTS[state.status] || '');
  }
  if (btn) {
    if (state.status === 'active') {
      btn.textContent = '✓ التطبيق مُفعّل';
      btn.disabled = true;
      btn.classList.add('is-done');
    } else if (state.checking) {
      btn.textContent = '⟳ جارٍ الفحص…';
      btn.disabled = true;
    } else {
      btn.textContent = state.status === 'pending' ? '⟳ تحديث حالة الطلب' : '🌐 إرسال طلب تفعيل أونلاين';
      btn.disabled = false;
      btn.classList.remove('is-done');
    }
  }
}

/* ---------- الجدولة ---------- */
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
function schedule() {
  stopPolling();
  const active = localLicenseValid();
  if (active) {
    const hours = Number(CFG.revokeCheckHours || 0);
    if (!CFG.enforceRevocation || !hours) return;
    const meta = readJSON(META_KEY) || {};
    const gap = hours * 3600 * 1000;
    if (meta.lastCheck && (nowMs() - meta.lastCheck) < gap) {
      const wait = gap - (nowMs() - meta.lastCheck);
      pollTimer = setTimeout(() => { checkNow({}); }, wait);
      return;
    }
    pollTimer = setInterval(() => { checkNow({}); }, gap);
    return;
  }
  const dialogOpen = isDialogOpen();
  const seconds = dialogOpen ? (CFG.pollSecondsWhileDialogOpen || 8) : (CFG.pollSecondsBackground || 25);
  pollTimer = setInterval(() => { checkNow({}); }, seconds * 1000);
}
function isDialogOpen() {
  const modal = document.getElementById('activationModalBg');
  return !!(modal && modal.classList.contains('open'));
}

/* ---------- واجهات عامة للتطبيق ---------- */
window.__VTS_ONLINE__ = {
  isActive: function () { return localLicenseValid(); },
  status: function () { return state.status; },
  message: function () { return state.message; },
  check: function (opts) { return checkNow(opts); }
};

window.vtsOnlineRequest = function () {
  checkNow({ manual: true });
};

window.vtsOnlineDialogOpened = function () {
  renderStatus();
  checkNow({ manual: true });
  schedule();
};

/* ---------- الإقلاع ---------- */
function boot() {
  state.configured = configLooksValid();
  const active = localLicenseValid();
  renderStatus();

  if (!configLooksValid()) {
    setStatus('error', TEXTS.error + ' (الخادم غير مُعدّ)');
    return;
  }
  if (active) {
    setStatus('active', TEXTS.active);
    /* فحص أولي دائماً عند الفتح: مزامنة بيانات المدرسة + فحص الانتهاء/الإلغاء */
    checkNow({});
    schedule();
    return;
  }

  checkNow({});          /* يسجّل الطلب تلقائياً ويبدأ الفحص الدوري */

  window.addEventListener('online', () => { checkNow({}); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !localLicenseValid()) checkNow({});
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
