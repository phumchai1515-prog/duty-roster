/**
 * sw.js — Service Worker
 *
 * กลยุทธ์: **network-first ทุกไฟล์** แล้วค่อยตกมาใช้ cache เมื่อออฟไลน์
 *
 * ทำไมไม่ใช้ cache-first ที่เร็วกว่า: โปรเจกต์นี้ไม่มี build step ชื่อไฟล์จึงไม่มี
 * hash ต่อท้าย ถ้า cache ไว้ก่อน ผู้ใช้จะได้โค้ดเก่าทุกครั้งที่ deploy
 * โดยเฉพาะ env.js ที่เก็บค่าเชื่อมต่อฐานข้อมูล — เคยทำให้เว็บขึ้น
 * "ยังไม่ได้ตั้งค่าระบบ" ทั้งที่ตั้งค่าไปแล้ว
 *
 * ข้อมูลเวรจาก Supabase ไม่ cache เด็ดขาด เพราะตารางเวรที่ค้างอยู่
 * อาจทำให้จองซ้ำหรือเข้าใจผิดว่าวันนั้นยังว่าง
 */
const CACHE_VERSION = 'duty-roster-v5';

const SHELL_FILES = [
  './',
  'index.html',
  'login.html',
  'my.html',
  'swap-form.html',
  'print.html',
  'admin.html',
  'offline.html',
  'manifest.json',
  'assets/icons/icon.svg',
  'assets/icons/logo.png',
  'assets/css/tokens.css',
  'assets/css/base.css',
  'assets/css/login.css',
  'assets/css/calendar.css',
  'assets/css/print.css',
  'assets/css/swap-form.css',
  'assets/js/env.js',
  'assets/js/config.js',
  'assets/js/icons.js',
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
  'assets/js/admin-page.js',
  'assets/js/login.js',
  'assets/js/off-days.js',
  'assets/js/month-settings.js',
  'assets/js/swap-document.js',
  'assets/js/swap-form-page.js',
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

  // network-first: เอาไฟล์สดเสมอเมื่อออนไลน์ แล้วเก็บสำเนาไว้เผื่อออฟไลน์
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        return request.mode === 'navigate' ? caches.match('offline.html') : Response.error();
      })),
  );
});
