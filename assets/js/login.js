/** login.js — หน้าเข้าสู่ระบบ */
import { isConfigured, humanError } from './supabase.js';
import { listNursesForLogin, signIn, validatePin, getSession } from './auth.js';
import { applyStoredTheme, renderSetupNotice, escapeHtml } from './ui.js';

applyStoredTheme();

const card = document.getElementById('login-card');
const form = document.getElementById('login-form');
const select = document.getElementById('nurse-select');
const pinInput = document.getElementById('pin-input');
const submitBtn = document.getElementById('submit-btn');
const errorBox = document.getElementById('login-error');

const LAST_NURSE_KEY = 'duty-roster-last-nurse';

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
}

/** ปลายทางหลังล็อกอิน — รับเฉพาะชื่อไฟล์ในโปรเจกต์ กัน open redirect */
function nextPage() {
  const requested = new URLSearchParams(window.location.search).get('next') ?? '';
  const allowed = ['index.html', 'my.html', 'approve.html', 'print.html', 'admin.html'];
  return allowed.includes(requested) ? requested : 'index.html';
}

async function boot() {
  if (!isConfigured()) {
    renderSetupNotice(card.parentElement);
    return;
  }

  // ล็อกอินค้างอยู่แล้วก็ข้ามหน้านี้ไปเลย
  try {
    if (await getSession()) {
      window.location.replace(nextPage());
      return;
    }
  } catch (error) {
    console.warn('[duty-roster] ตรวจ session เดิมไม่ได้', error);
  }

  try {
    const nurses = await listNursesForLogin();
    if (!nurses.length) {
      showError('ยังไม่มีรายชื่อพยาบาลในระบบ กรุณาแจ้งผู้ดูแลระบบ');
      select.innerHTML = '<option value="">— ไม่มีรายชื่อ —</option>';
      return;
    }

    const lastSlug = localStorage.getItem(LAST_NURSE_KEY) ?? '';
    select.innerHTML = [
      '<option value="">— เลือกชื่อของคุณ —</option>',
      ...nurses.map((nurse) =>
        `<option value="${escapeHtml(nurse.slug)}"${nurse.slug === lastSlug ? ' selected' : ''}>` +
        `${escapeHtml(nurse.full_name)}</option>`),
    ].join('');

    if (lastSlug) pinInput.focus();
  } catch (error) {
    showError(humanError(error, 'โหลดรายชื่อไม่สำเร็จ กรุณารีเฟรชหน้าจอ'));
    select.innerHTML = '<option value="">— โหลดรายชื่อไม่สำเร็จ —</option>';
  }
}

// รับเฉพาะตัวเลข ป้องกันการวางข้อความแปลกปลอม
pinInput.addEventListener('input', () => {
  const digitsOnly = pinInput.value.replace(/\D/g, '');
  if (pinInput.value !== digitsOnly) pinInput.value = digitsOnly;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const slug = select.value;
  const pin = pinInput.value;

  if (!slug) {
    showError('กรุณาเลือกชื่อของคุณ');
    select.focus();
    return;
  }
  const pinError = validatePin(pin);
  if (pinError) {
    showError(pinError);
    pinInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังเข้าสู่ระบบ…';

  try {
    await signIn(slug, pin);
    localStorage.setItem(LAST_NURSE_KEY, slug);
    window.location.replace(nextPage());
  } catch (error) {
    showError(humanError(error, 'เข้าสู่ระบบไม่สำเร็จ'));
    pinInput.value = '';
    pinInput.focus();
    submitBtn.disabled = false;
    submitBtn.textContent = 'เข้าสู่ระบบ';
  }
});

boot();
