/**
 * calendar-page.js — หน้าปฏิทินจองเวร (index.html)
 *
 * มี 2 โหมด: จองเวร กับ แจ้ง OFF สลับด้วยปุ่มบนแถบเดือน
 * จองแล้วมีผลทันที ไม่มีขั้นหัวหน้าอนุมัติ
 */
import { isConfigured, humanError } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, applyStoredTheme, escapeHtml } from './ui.js';
import { loadMonthShifts, loadMonthHolidays, bookShift, cancelShifts, subscribeToShifts } from './shifts.js';
import { loadMonthOffDays, bookOffDay, cancelOffDay } from './off-days.js';
import { loadMonthSetting } from './month-settings.js';
import {
  renderMonthGrid, renderDowHead, renderStatStrip, monthSummary,
  renderSlotRows, primaryShift, shiftIdsOwnedBy, myOffDay,
} from './calendar-view.js';
import { icon } from './icons.js';
import { formatThaiMonthYear, formatThaiDateFull, todayKey, shiftMonth, parseDateKey, DOW_TH, dayOfWeek } from './thai.js';
import { BOOKABLE_SLOTS, DUTY_SLOT, RULES } from './config.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  boot: document.getElementById('boot'),
  page: document.getElementById('page'),
  alert: document.getElementById('page-alert'),
  notice: document.getElementById('month-notice'),
  grid: document.getElementById('calendar-grid'),
  monthLabel: document.getElementById('month-label'),
  statStrip: document.getElementById('stat-strip'),
  dowHead: document.getElementById('dow-head'),
  prev: document.getElementById('prev-month'),
  next: document.getElementById('next-month'),
  today: document.getElementById('today-btn'),
  modeShift: document.getElementById('mode-shift'),
  modeOff: document.getElementById('mode-off'),
  backdrop: document.getElementById('sheet-backdrop'),
  sheetTitle: document.getElementById('sheet-title'),
  sheetSub: document.getElementById('sheet-sub'),
  sheetBody: document.getElementById('sheet-body'),
  sheetClose: document.getElementById('sheet-close'),
  sheetConfirm: document.getElementById('sheet-confirm'),
};

const MODE = { SHIFT: 'shift', OFF: 'off' };

let session = null;
let mode = MODE.SHIFT;
let state = {
  year: 0, month: 0,
  shifts: new Map(), holidays: new Map(), offDays: new Map(),
  setting: { shift_quota: 2, shifts_locked: false, off_booking_open: false },
};
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
  const [shifts, holidays, offDays, setting] = await Promise.all([
    loadMonthShifts(year, month),
    loadMonthHolidays(year, month),
    loadMonthOffDays(year, month),
    loadMonthSetting(year, month),
  ]);
  state = { year, month, shifts, holidays, offDays, setting };
}

function paint() {
  const { year, month, shifts, holidays, offDays, setting } = state;
  const currentNurseId = session.nurse.id;

  dom.monthLabel.textContent = formatThaiMonthYear(year, month);
  dom.statStrip.innerHTML = renderStatStrip(monthSummary({
    year, month, shifts, offDays, currentNurseId, quota: setting.shift_quota,
  }));
  dom.grid.innerHTML = renderMonthGrid({ year, month, shifts, holidays, offDays, currentNurseId });

  // แจ้งสถานะของเดือนนั้น เช่น ปิดจองแล้ว หรือ ยังไม่เปิดให้จอง OFF
  const notices = [];
  if (setting.shifts_locked) notices.push('เดือนนี้ปิดการจองเวรแล้ว');
  if (mode === MODE.OFF && !setting.off_booking_open) notices.push('ยังไม่เปิดให้จองวัน OFF ของเดือนนี้');
  if (setting.note) notices.push(setting.note);

  if (notices.length) {
    dom.notice.textContent = notices.join(' · ');
    dom.notice.classList.remove('hidden');
  } else {
    dom.notice.classList.add('hidden');
  }
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

function setMode(next) {
  mode = next;
  dom.modeShift.setAttribute('aria-pressed', String(next === MODE.SHIFT));
  dom.modeOff.setAttribute('aria-pressed', String(next === MODE.OFF));
  document.body.dataset.mode = next;
  paint();
}

// ---------- กล่องยืนยัน ----------

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

/** จำนวนเวรที่จองไปแล้วในเดือนนี้ */
function myShiftCount() {
  return monthSummary({
    year: state.year, month: state.month,
    shifts: state.shifts, offDays: state.offDays,
    currentNurseId: session.nurse.id, quota: state.setting.shift_quota,
  }).mine;
}

/** ตัดสินใจว่ากล่องยืนยันควรแสดงอะไร — คืน { mode, label, hint, disabled, payload } */
function sheetPlan(key) {
  const dayShifts = state.shifts.get(key) ?? {};
  const offList = state.offDays.get(key) ?? [];
  const shift = primaryShift(dayShifts);
  const myShiftIds = shiftIdsOwnedBy(dayShifts, session.nurse.id);
  const myOff = myOffDay(offList, session.nurse.id);
  const isPast = key < todayKey();
  const isAdmin = session.nurse.is_admin;

  // ---- โหมดแจ้ง OFF ----
  if (mode === MODE.OFF) {
    if (myOff) {
      return {
        action: 'cancel-off', label: 'ยกเลิกวัน OFF', payload: myOff.id,
        hint: '<div class="alert info">คุณแจ้ง OFF ไว้ในวันนี้ ยกเลิกได้ถ้าเปลี่ยนใจ</div>',
      };
    }
    if (myShiftIds.length) {
      return {
        action: 'none', label: 'แจ้ง OFF', disabled: true,
        hint: '<div class="alert warn">คุณจองเวรไว้ในวันนี้แล้ว ต้องยกเลิกเวรก่อนจึงแจ้ง OFF ได้</div>',
      };
    }
    if (isPast) {
      return {
        action: 'none', label: 'แจ้ง OFF', disabled: true,
        hint: '<div class="alert warn">แจ้ง OFF ย้อนหลังไม่ได้</div>',
      };
    }
    if (!state.setting.off_booking_open && !isAdmin) {
      return {
        action: 'none', label: 'แจ้ง OFF', disabled: true,
        hint: '<div class="alert warn">ยังไม่เปิดให้จองวัน OFF ของเดือนนี้ กรุณารอผู้ดูแลระบบเปิด</div>',
      };
    }
    return {
      action: 'book-off', label: 'แจ้ง OFF วันนี้',
      hint: '<div class="alert info">แจ้งว่าวันนี้ขึ้นเวรไม่ได้ — คนอื่นยังจองเวรวันนี้ได้ตามปกติ</div>',
    };
  }

  // ---- โหมดจองเวร ----
  if (myShiftIds.length) {
    return {
      action: 'cancel-shift', label: 'ยกเลิกการจอง', payload: myShiftIds,
      danger: true,
      hint: isPast
        ? '<div class="alert warn">เวรนี้ผ่านไปแล้ว ยกเลิกไม่ได้</div>'
        : '<div class="alert warn">ยกเลิกแล้ววันนี้จะไม่มีผู้ปฏิบัติงานทันที</div>',
      disabled: isPast,
    };
  }
  if (shift) {
    return {
      action: 'none', label: 'จองเวร', disabled: true,
      hint: `<div class="alert info">เวรวันนี้มีผู้ปฏิบัติงานแล้ว หากต้องการแลกเวร กรุณาติดต่อ ${escapeHtml(shift.nurse?.full_name ?? '')} ผ่านเมนู "เวรของฉัน"</div>`,
    };
  }
  if (myOff) {
    return {
      action: 'none', label: 'จองเวร', disabled: true,
      hint: '<div class="alert warn">คุณแจ้ง OFF ไว้ในวันนี้ ต้องยกเลิกวัน OFF ก่อนจึงจองเวรได้</div>',
    };
  }
  if (isPast) {
    return {
      action: 'none', label: 'จองเวร', disabled: true,
      hint: '<div class="alert warn">จองย้อนหลังไม่ได้ หากต้องบันทึกย้อนหลัง กรุณาแจ้งผู้ดูแลระบบ</div>',
    };
  }
  if (state.setting.shifts_locked && !isAdmin) {
    return {
      action: 'none', label: 'จองเวร', disabled: true,
      hint: '<div class="alert warn">เดือนนี้ปิดการจองแล้ว กรุณาติดต่อผู้ดูแลระบบ</div>',
    };
  }

  // จองได้ — รวมคำเตือนโควตาและเวรติดกัน
  const quota = state.setting.shift_quota;
  const mine = myShiftCount();
  const streak = consecutiveNights(key);

  let hint = `<div class="alert info">จะจองเวรตรวจการ ${DUTY_SLOT.label}</div>`;
  if (mine >= quota) {
    hint += `<div class="alert warn">คุณจองครบโควตาเดือนนี้แล้ว (${mine}/${quota} เวร) `
          + 'จองเพิ่มได้ แต่จะทำให้เวรกระจายไม่เท่ากัน</div>';
  }
  if (streak >= RULES.consecutiveWarnAt) {
    hint += `<div class="alert warn">คุณจะอยู่เวรติดกัน ${streak} คืน กรุณาพิจารณาความปลอดภัยในการปฏิบัติงาน</div>`;
  }
  return { action: 'book-shift', label: 'ยืนยันจองเวร', hint };
}

function openSheet(key) {
  const dayShifts = state.shifts.get(key) ?? {};
  const offList = state.offDays.get(key) ?? [];
  const { year, month, day } = parseDateKey(key);
  const holidayName = state.holidays.get(key);
  const plan = sheetPlan(key);

  openDateKey = key;
  lastFocused = document.activeElement;

  dom.sheetTitle.textContent = `วัน${DOW_TH[dayOfWeek(year, month, day)]}ที่ ${formatThaiDateFull(key)}`;
  dom.sheetSub.textContent = holidayName ? `วันหยุดราชการ — ${holidayName}` : '';
  dom.sheetBody.innerHTML = renderSlotRows(dayShifts, offList) + plan.hint;

  dom.sheetConfirm.textContent = plan.label;
  dom.sheetConfirm.disabled = Boolean(plan.disabled);
  dom.sheetConfirm.dataset.action = plan.action;
  dom.sheetConfirm.dataset.payload = Array.isArray(plan.payload)
    ? plan.payload.join(',')
    : (plan.payload ?? '');
  dom.sheetConfirm.className = plan.danger ? 'btn btn-danger' : 'btn btn-primary';

  dom.backdrop.classList.remove('hidden');
  (plan.disabled ? dom.sheetClose : dom.sheetConfirm).focus();
}

function closeSheet() {
  dom.backdrop.classList.add('hidden');
  openDateKey = null;
  lastFocused?.focus();
}

async function confirmSheet() {
  const key = openDateKey;
  const { action, payload } = dom.sheetConfirm.dataset;
  if (!key || action === 'none') return;

  const originalLabel = dom.sheetConfirm.textContent;
  dom.sheetConfirm.disabled = true;
  dom.sheetConfirm.textContent = 'กำลังบันทึก…';

  try {
    if (action === 'book-shift') {
      await bookShift(key, { slots: BOOKABLE_SLOTS });
      toast('จองเวรเรียบร้อย', 'success');
    } else if (action === 'cancel-shift') {
      await cancelShifts(payload.split(',').filter(Boolean));
      toast('ยกเลิกการจองแล้ว', 'success');
    } else if (action === 'book-off') {
      await bookOffDay(key);
      toast('แจ้ง OFF เรียบร้อย', 'success');
    } else if (action === 'cancel-off') {
      await cancelOffDay(payload);
      toast('ยกเลิกวัน OFF แล้ว', 'success');
    }
    closeSheet();
  } catch (error) {
    toast(humanError(error, 'บันทึกไม่สำเร็จ'), 'error');
    dom.sheetConfirm.disabled = false;
    dom.sheetConfirm.textContent = originalLabel;
  } finally {
    // โหลดใหม่เสมอ เพราะข้อมูลอาจถูกคนอื่นแก้ไประหว่างนั้น
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

dom.modeShift.addEventListener('click', () => setMode(MODE.SHIFT));
dom.modeOff.addEventListener('click', () => setMode(MODE.OFF));

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

  dom.prev.innerHTML = icon('chevronLeft', { size: 18 });
  dom.next.innerHTML = icon('chevronRight', { size: 18 });
  dom.dowHead.innerHTML = renderDowHead();

  const { year, month } = parseDateKey(todayKey());
  await goToMonth(year, month);
  setMode(MODE.SHIFT);

  dom.boot.classList.add('hidden');
  dom.page.classList.remove('hidden');

  subscribeToShifts(scheduleRefresh);
}

boot().catch((error) => {
  dom.boot.classList.add('hidden');
  dom.page.classList.remove('hidden');
  showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ กรุณารีเฟรช'));
});
