/**
 * ui.js — ชิ้นส่วน UI ที่ใช้ร่วมทุกหน้า: แถบหัว, เมนู, toast, โหมดมืด
 */
import { getSession, signOut } from './auth.js';
import { icon } from './icons.js';

const NAV_ITEMS = [
  { href: 'index.html',     label: 'ปฏิทินเวร',    icon: 'calendar' },
  { href: 'my.html',        label: 'เวรของฉัน',    icon: 'user' },
  { href: 'print.html',     label: 'พิมพ์ตารางเวร', icon: 'printer' },
  { href: 'swap-form.html', label: 'ใบแลกเวร',     icon: 'swap' },
  { href: 'admin.html',     label: 'ผู้ดูแลระบบ',  icon: 'settings', adminOnly: true },
];

const ORGANIZATION = 'โรงพยาบาลจิตเวชเลยราชนครินทร์ · กรมสุขภาพจิต';

const THEME_KEY = 'duty-roster-theme';

// ลงทะเบียน Service Worker ครั้งเดียวตอนโหลดหน้าแรกที่ import ไฟล์นี้
// ข้ามไปเงียบๆ ถ้าเบราว์เซอร์ไม่รองรับ หรือเปิดจาก file:// (ไม่ใช่ https/localhost)
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('[duty-roster] ลงทะเบียน service worker ไม่สำเร็จ', error);
    });
  });
}

export function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.dataset.theme = stored;
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.dataset.theme = 'dark';
  }
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  return next;
}

/**
 * วาดแถบหัว + เมนู ลงใน element ที่กำหนด
 * @param {{ mount: HTMLElement, current: string, session: object }} options
 */
/** อักษรย่อของชื่อ ใช้ในวงกลมประจำตัว — ตัดคำนำหน้าออกก่อน */
export function initialsOf(fullName = '') {
  const withoutPrefix = String(fullName).replace(/^(นางสาว|นาง|นาย)/, '').trim();
  return withoutPrefix.charAt(0) || '?';
}

export function renderShell({ mount, current, session }) {
  const isAdmin = Boolean(session?.nurse?.is_admin);
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const fullName = session?.nurse?.full_name ?? '';

  mount.innerHTML = `
    <header class="masthead">
      <div class="masthead-inner">
        <img class="crest" src="assets/icons/logo.png" alt="ตราโรงพยาบาลจิตเวชเลยราชนครินทร์" width="40" height="40">
        <div class="masthead-titles">
          <div class="masthead-org">${ORGANIZATION}</div>
          <div class="masthead-name">ระบบจองเวรตรวจการ</div>
        </div>
        <div class="spacer"></div>
        <span class="user-chip ${isAdmin ? 'is-admin' : ''}"
              title="${escapeHtml(fullName)}${isAdmin ? ' — ผู้ดูแลระบบ' : ''}">
          <span class="avatar" aria-hidden="true">${escapeHtml(initialsOf(fullName))}</span>
          <span class="user-name">${escapeHtml(fullName)}</span>
        </span>
        <button class="icon-btn" id="theme-toggle" type="button" aria-label="สลับโหมดสว่าง/มืด">
          ${icon('contrast', { size: 18 })}
        </button>
        <button class="icon-btn" id="sign-out" type="button" aria-label="ออกจากระบบ" title="ออกจากระบบ">
          ${icon('logout', { size: 18 })}
        </button>
      </div>
    </header>
    <div class="nav-bar">
      <nav class="nav" aria-label="เมนูหลัก">
        ${items.map((item) => `
          <a href="${item.href}"${item.href === current ? ' aria-current="page"' : ''}>
            ${icon(item.icon, { size: 16 })}<span>${item.label}</span>
          </a>
        `).join('')}
      </nav>
    </div>
  `;

  mount.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
  mount.querySelector('#sign-out').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'login.html';
  });
}

/** บังคับให้ต้องล็อกอินก่อน — คืน session หรือเด้งไปหน้า login */
export async function requireSession({ adminOnly = false } = {}) {
  const session = await getSession();
  if (!session) {
    const target = encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html');
    window.location.replace(`login.html?next=${target}`);
    return null;
  }
  if (adminOnly && !session.nurse.is_admin) {
    window.location.replace('index.html');
    return null;
  }
  return session;
}

/** ข้อความแจ้งเตือนชั่วคราว — ประกาศให้ screen reader ด้วย */
export function toast(message, variant = '') {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const node = document.createElement('div');
  node.className = `toast ${variant}`.trim();
  node.textContent = message;
  region.append(node);
  setTimeout(() => node.remove(), 4500);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** แสดงกล่อง error เต็มหน้าจอเมื่อระบบยังไม่ถูกตั้งค่า */
export function renderSetupNotice(mount) {
  mount.innerHTML = `
    <div class="card">
      <h1>ยังไม่ได้ตั้งค่าระบบ</h1>
      <p class="muted">ระบบยังเชื่อมต่อฐานข้อมูลไม่ได้ เพราะยังไม่ได้กรอกค่าใน <code>assets/js/env.js</code></p>
      <div class="alert warn">
        <div>
          <strong>ผู้ดูแลระบบ:</strong> เปิดไฟล์ <code>assets/js/env.js</code>
          แล้วกรอก <code>supabaseUrl</code> และ <code>supabaseAnonKey</code>
          ตามขั้นตอนใน <code>docs/SETUP.md</code>
        </div>
      </div>
    </div>
  `;
}
