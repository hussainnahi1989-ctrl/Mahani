/* =========================================================
   إعدادات النشر الأونلاين — مشروع Mahani (Firebase)
   ✅ مُكتملة وجاهزة — لا تعديل مطلوب هنا
   ========================================================= */
window.MAHANI_CONFIG = {

  /* إعدادات Firebase — من Project settings ← Your apps */
  firebase: {
    apiKey: "AIzaSyChHkinZ_FjiFTqUs5X1BoIKTPpAaMdNXU",
    authDomain: "mahani-b6902.firebaseapp.com",
    databaseURL: "https://mahani-b6902-default-rtdb.firebaseio.com",
    projectId: "mahani-b6902",
    storageBucket: "mahani-b6902.firebasestorage.app",
    messagingSenderId: "840413454944",
    appId: "1:840413454944:web:3956ec04d968d37d4a1905",
    measurementId: "G-B1RBHZM9TP"
  },

  /* معرّف التطبيق داخل قاعدة البيانات */
  appId: "vts-professional-timetable",

  /* سر توقيع رخصة الأوفلاين (أي نص تختاره) — يمنع التلاعب البسيط بالتخزين المحلي */
  onlineSecret: "VTS-ONLINE-HN-2026-9B7",

  /* عند التشغيل: يسجّل التطبيق نفسه تلقائياً في لوحة التحكم كطلب تفعيل */
  autoRegisterOnStart: true,

  /* عدد الثواني بين كل فحص أثناء فتح نافذة التفعيل */
  pollSecondsWhileDialogOpen: 8,

  /* عدد الثواني بين كل فحص في الخلفية (والصفحة مفتوحة) */
  pollSecondsBackground: 25,

  /* بعد التفعيل: التحقق من الإلغاء مرة كل هذه الساعات (0 = بلا تحقق) */
  revokeCheckHours: 6,

  /* إذا ألغيت التفعيل من اللوحة: يُقفل التطبيق عند أول اتصال بالإنترنت */
  enforceRevocation: true
};
