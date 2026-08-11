/**
 * sw.js — Service Worker
 *
 * กลยุทธ์: cache เฉพาะไฟล์หน้าเว็บ (shell) ไว้เปิดออฟไลน์ได้
 * ส่วนข้อมูลเวรจาก Supabase ไม่ cache เด็ดขาด เพราะตารางเวรที่ค้างอยู่
 * อาจทำให้จองซ้ำหรือเข้าใจผิดว่าวันนั้นยังว่าง
 */
const CACHE_VERSION = 'duty-roster-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'login.html',
  'my.html',
  'approve.html',
  'print.html',
  'admin.html',
  'offline.html',
  'manifest.json',
  'assets/icons/icon.svg',
  'assets/css/tokens.css',
  'assets/css/base.css',
  'assets/css/login.css',
  'assets/css/calendar.css',
  'assets/css/print.css',
  'assets/js/env.js',
  'assets/js/config.js',
  'assets/js/thai.js',
  'assets/js/supabase.js',
  'assets/js/auth.js',
  'assets/js/ui.js',
  'assets/js/pin-gate.js',
  'assets/js/shifts.js',
  'assets/js/swaps.js',
  'assets/js/calendar-view.js',
  'assets/js/calendar-page.js',
  'assets/js/print-document.js',
  'assets/js/print-page.js',
  'assets/js/my-page.js',
  'assets/js/approve-page.js',
  'assets/js/admin-page.js',
  'assets/js/login.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // ไฟล์ใดโหลดไม่ได้ก็ข้ามไป ไม่ให้ install ล้มทั้งชุด
      .then((cache) => Promise.allSettled(SHELL_FILES.map((file) => cache.add(file))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ข้อมูลจาก Supabase และ CDN ต้องสดเสมอ ปล่อยผ่านไปเครือข่ายตรงๆ
  if (url.origin !== self.location.origin) return;

  // หน้าเว็บ: ลองเครือข่ายก่อน ถ้าไม่ได้ค่อยใช้ cache แล้วค่อยตกไปหน้า offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match('offline.html'))),
    );
    return;
  }

  // ไฟล์ static: ใช้ cache ก่อนเพื่อความเร็ว แล้วอัปเดตเบื้องหลัง
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached ?? network;
    }),
  );
});
