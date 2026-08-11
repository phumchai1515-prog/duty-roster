/**
 * calendar-page.js — หน้าปฏิทินจองเวร (index.html)
 * รับผิดชอบเฉพาะการต่อสาย: โหลดข้อมูล → เรียก view → รับ event
 */
import { isConfigured, humanError } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, escapeHtml, applyStoredTheme } from './ui.js';
import { loadMonthShifts, loadMonthHolidays, bookShift, cancelShifts, subscribeToShifts } from './shifts.js';
import { renderMonthGrid, monthSummary, renderSlotRows, primaryShift, shiftIdsOwnedBy } from './calendar-view.js';
import { formatThaiMonthYear, formatThaiDateFull, todayKey, shiftMonth, parseDateKey, DOW_TH, dayOfWeek } from './thai.js';
import { PAIRED_SLOTS, DAY_SLOT_HOLIDAY_ONLY, RULES } from './config.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  boot: document.getElementById('boot'),
  page: document.getElementById('page'),
  alert: document.getElementById('page-alert'),
  grid: document.getElementById('calendar-grid'),
  monthLabel: document.getElementById('month-label'),
  monthSummary: document.getElementById('month-summary'),
  prev: document.getElementById('prev-month'),
  next: document.getElementById('next-month'),
  today: document.getElementById('today-btn'),
  backdrop: document.getElementById('sheet-backdrop'),
  sheetTitle: document.getElementById('sheet-title'),
  sheetSub: document.getElementById('sheet-sub'),
  sheetBody: document.getElementById('sheet-body'),
  sheetClose: document.getElementById('sheet-close'),
  sheetConfirm: document.getElementById('sheet-confirm'),
};

let session = null;
let state = { year: 0, month: 0, shifts: new Map(), holidays: new Map() };
let openDateKey = null;
let lastFocused = null;
let refreshTimer = null;

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

function clearAlert() {
  dom.alert.classList.add('hidden');
  dom.alert.textContent = '';
}

// ---------- โหลด & วาด ----------

async function loadMonth(year, month) {
  const [shifts, holidays] = await Promise.all([
    loadMonthShifts(year, month),
    loadMonthHolidays(year, month),
  ]);
  state = { year, month, shifts, holidays };
}

function paint() {
  const { year, month, shifts, holidays } = state;
  const currentNurseId = session.nurse.id;

  dom.monthLabel.textContent = formatThaiMonthYear(year, month);
  dom.monthSummary.textContent = monthSummary({ year, month, shifts, currentNurseId });
  dom.grid.innerHTML = renderMonthGrid({ year, month, shifts, holidays, currentNurseId });
}

async function goToMonth(year, month) {
  clearAlert();
  try {
    await loadMonth(year, month);
    paint();
  } catch (error) {
    showAlert(humanError(error, 'โหลดตารางเวรไม่สำเร็จ'));
  }
}

/** โหลดซ้ำแบบหน่วงเวลา ใช้ตอนได้สัญญาณ realtime ถี่ๆ */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    loadMonth(state.year, state.month).then(paint).catch(() => {});
  }, 400);
}

// ---------- กล่องยืนยัน ----------

/** เวรเช้าเปิดจองเฉพาะวันหยุดราชการ ตามการปฏิบัติจริง */
function slotsToBook(key) {
  return state.holidays.has(key) || !DAY_SLOT_HOLIDAY_ONLY
    ? ['day', ...PAIRED_SLOTS]
    : [...PAIRED_SLOTS];
}

/** นับจำนวนคืนติดกันที่พยาบาลคนนี้จองไว้รอบๆ วันที่กำหนด */
function consecutiveNights(key) {
  const { year, month, day } = parseDateKey(key);
  let streak = 1;
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= RULES.consecutiveWarnAt; step += 1) {
      const probe = new Date(year, month - 1, day + direction * step);
      const probeKey = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, '0')}-${String(probe.getDate()).padStart(2, '0')}`;
      const shift = primaryShift(state.shifts.get(probeKey) ?? {});
      if (shift?.nurse?.id !== session.nurse.id) break;
      streak += 1;
    }
  }
  return streak;
}

function openSheet(key) {
  const dayShifts = state.shifts.get(key) ?? {};
  const shift = primaryShift(dayShifts);
  const myShiftIds = shiftIdsOwnedBy(dayShifts, session.nurse.id);
  const { year, month, day } = parseDateKey(key);
  const holidayName = state.holidays.get(key);

  openDateKey = key;
  lastFocused = document.activeElement;

  dom.sheetTitle.textContent = `วัน${DOW_TH[dayOfWeek(year, month, day)]}ที่ ${formatThaiDateFull(key)}`;
  dom.sheetSub.textContent = holidayName ? `วันหยุดราชการ — ${holidayName}` : '';
  dom.sheetBody.innerHTML = renderSlotRows(dayShifts);

  const isPast = key < todayKey();
  const isMine = myShiftIds.length > 0;
  const isTakenByOther = Boolean(shift) && !isMine;

  let hint = '';
  let confirmLabel = 'ยืนยันจองเวร';
  let confirmDisabled = false;
  let mode = 'book';

  if (isTakenByOther) {
    hint = `<div class="alert info">เวรวันนี้มีผู้ปฏิบัติงานแล้ว หากต้องการสลับเวร กรุณาติดต่อ ${escapeHtml(shift.nurse?.full_name ?? '')} หรือหัวหน้าเวร</div>`;
    confirmDisabled = true;
  } else if (isMine && shift.status === 'approved' && !session.nurse.is_admin) {
    hint = '<div class="alert warn">เวรนี้ได้รับอนุมัติแล้ว ยกเลิกเองไม่ได้ กรุณาแจ้งหัวหน้าเวร</div>';
    confirmDisabled = true;
  } else if (isMine) {
    mode = 'cancel';
    confirmLabel = 'ยกเลิกการจอง';
    hint = shift.status === 'approved'
      ? '<div class="alert warn">เวรนี้อนุมัติแล้ว การยกเลิกจะทำให้วันนี้ไม่มีผู้ปฏิบัติงาน</div>'
      : '<div class="alert warn">นี่คือเวรของคุณที่ยังรออนุมัติ</div>';
  } else if (isPast) {
    hint = '<div class="alert warn">จองย้อนหลังไม่ได้ หากต้องบันทึกย้อนหลัง กรุณาแจ้งหัวหน้าเวร</div>';
    confirmDisabled = true;
  } else {
    const slots = slotsToBook(key);
    const streak = consecutiveNights(key);
    hint = `<div class="alert info">จะจอง ${slots.length} ช่วงเวลาพร้อมกัน (${slots.includes('day') ? 'เช้า+บ่าย+ดึก' : 'บ่าย+ดึก'})</div>`;
    if (streak >= RULES.consecutiveWarnAt) {
      hint += `<div class="alert warn">คุณจะอยู่เวรติดกัน ${streak} คืน กรุณาพิจารณาความปลอดภัยในการปฏิบัติงาน</div>`;
    }
  }

  dom.sheetBody.insertAdjacentHTML('beforeend', hint);
  dom.sheetConfirm.textContent = confirmLabel;
  dom.sheetConfirm.disabled = confirmDisabled;
  dom.sheetConfirm.dataset.mode = mode;
  dom.sheetConfirm.dataset.shiftIds = myShiftIds.join(',');
  dom.sheetConfirm.className = mode === 'cancel' ? 'btn btn-danger' : 'btn btn-primary';

  dom.backdrop.classList.remove('hidden');
  (confirmDisabled ? dom.sheetClose : dom.sheetConfirm).focus();
}

function closeSheet() {
  dom.backdrop.classList.add('hidden');
  openDateKey = null;
  lastFocused?.focus();
}

async function confirmSheet() {
  const key = openDateKey;
  if (!key) return;

  const mode = dom.sheetConfirm.dataset.mode;
  dom.sheetConfirm.disabled = true;
  dom.sheetConfirm.textContent = 'กำลังบันทึก…';

  try {
    if (mode === 'cancel') {
      const ids = dom.sheetConfirm.dataset.shiftIds.split(',').filter(Boolean);
      await cancelShifts(ids);
      toast('ยกเลิกการจองแล้ว', 'success');
    } else {
      await bookShift(key, { slots: slotsToBook(key) });
      toast('จองเวรสำเร็จ รอหัวหน้าอนุมัติ', 'success');
    }
    closeSheet();
    await goToMonth(state.year, state.month);
  } catch (error) {
    toast(humanError(error, 'บันทึกไม่สำเร็จ'), 'error');
    dom.sheetConfirm.disabled = false;
    dom.sheetConfirm.textContent = mode === 'cancel' ? 'ยกเลิกการจอง' : 'ยืนยันจองเวร';
    // ข้อมูลอาจไม่ตรงกับฐานข้อมูลแล้ว โหลดใหม่ให้เห็นสถานะจริง
    await goToMonth(state.year, state.month);
  }
}

// ---------- Event ----------

dom.grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.day[data-date]');
  if (cell) openSheet(cell.dataset.date);
});

dom.prev.addEventListener('click', () => {
  const { year, month } = shiftMonth(state.year, state.month, -1);
  goToMonth(year, month);
});

dom.next.addEventListener('click', () => {
  const { year, month } = shiftMonth(state.year, state.month, 1);
  goToMonth(year, month);
});

dom.today.addEventListener('click', () => {
  const { year, month } = parseDateKey(todayKey());
  goToMonth(year, month);
});

dom.sheetClose.addEventListener('click', closeSheet);
dom.sheetConfirm.addEventListener('click', confirmSheet);
dom.backdrop.addEventListener('click', (event) => {
  if (event.target === dom.backdrop) closeSheet();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !dom.backdrop.classList.contains('hidden')) closeSheet();
});

// ---------- เริ่มทำงาน ----------

async function boot() {
  if (!isConfigured()) {
    dom.boot.classList.add('hidden');
    dom.page.classList.remove('hidden');
    renderSetupNotice(document.getElementById('main'));
    return;
  }

  session = await requireSession();
  if (!session) return;

  renderShell({ mount: dom.shell, current: 'index.html', session });
  await enforcePinChange(session);

  const { year, month } = parseDateKey(todayKey());
  await goToMonth(year, month);

  dom.boot.classList.add('hidden');
  dom.page.classList.remove('hidden');

  subscribeToShifts(scheduleRefresh);
}

boot().catch((error) => {
  dom.boot.classList.add('hidden');
  dom.page.classList.remove('hidden');
  showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ กรุณารีเฟรช'));
});
