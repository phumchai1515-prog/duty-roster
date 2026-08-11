/**
 * calendar-view.js — ฟังก์ชันวาดปฏิทิน (บริสุทธิ์ ไม่ยุ่งกับเครือข่าย/สถานะ)
 */
import { STATUS_LABEL, STATUS_PILL, BOOKABLE_SLOTS, DUTY_SLOT } from './config.js';
import { dateKey, daysInMonth, dayOfWeek, todayKey } from './thai.js';
import { escapeHtml } from './ui.js';

/** เวรของวันนั้น — เวรตรวจการมีช่วงเดียว (16.30 - 00.30 น.) */
export function primaryShift(dayShifts = {}) {
  for (const slot of BOOKABLE_SLOTS) {
    if (dayShifts[slot]) return dayShifts[slot];
  }
  return null;
}

/** เวรของวันนั้นทั้งหมดที่เป็นของพยาบาลคนนี้ */
export function shiftIdsOwnedBy(dayShifts = {}, nurseId) {
  return Object.values(dayShifts)
    .filter((shift) => shift?.nurse?.id === nurseId)
    .map((shift) => shift.id);
}

function dayCell({ year, month, day, key, dayShifts, holidayName, isMine }) {
  const shift = primaryShift(dayShifts);
  const classes = ['day'];

  // ใช้ dayOfWeek แทน new Date(key) เพราะ "YYYY-MM-DD" ถูกตีความเป็น UTC
  // ซึ่งทำให้วันเสาร์/อาทิตย์เพี้ยนไป 1 วันในบางไทม์โซน
  if ([0, 6].includes(dayOfWeek(year, month, day))) classes.push('weekend');
  if (holidayName) classes.push('holiday');
  if (key === todayKey()) classes.push('today');
  if (isMine) classes.push('is-mine');

  const statusPill = shift
    ? `<span class="pill ${STATUS_PILL[shift.status]}">${STATUS_LABEL[shift.status]}</span>`
    : '<span class="day-free">+ ว่าง</span>';

  const ownerLine = shift
    ? `<span class="day-owner">${escapeHtml(shift.nurse?.full_name ?? '—')}</span>`
    : '';

  const ariaLabel = shift
    ? `วันที่ ${day} ${shift.nurse?.full_name ?? ''} ${STATUS_LABEL[shift.status]}`
    : `วันที่ ${day} ยังไม่มีผู้จองเวร กดเพื่อจอง`;

  return `
    <button type="button" class="${classes.join(' ')}" data-date="${key}"
            aria-label="${escapeHtml(ariaLabel)}">
      <span class="day-num">${day}</span>
      ${holidayName ? `<span class="day-holiday-name">${escapeHtml(holidayName)}</span>` : ''}
      ${ownerLine}
      <span class="day-foot">${statusPill}</span>
    </button>
  `;
}

/**
 * สร้าง HTML ของตารางทั้งเดือน
 * @param {{year:number, month:number, shifts:Map, holidays:Map, currentNurseId:string}} options
 */
export function renderMonthGrid({ year, month, shifts, holidays, currentNurseId }) {
  const total = daysInMonth(year, month);
  const leadingBlanks = dayOfWeek(year, month, 1);

  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) {
    cells.push('<span class="day blank" aria-hidden="true"></span>');
  }
  for (let day = 1; day <= total; day += 1) {
    const key = dateKey(year, month, day);
    const dayShifts = shifts.get(key) ?? {};
    cells.push(dayCell({
      year,
      month,
      day,
      key,
      dayShifts,
      holidayName: holidays.get(key),
      isMine: shiftIdsOwnedBy(dayShifts, currentNurseId).length > 0,
    }));
  }
  return cells.join('');
}

/** สรุปสถิติของเดือนไว้แสดงใต้ชื่อเดือน */
export function monthSummary({ year, month, shifts, currentNurseId }) {
  const total = daysInMonth(year, month);
  let booked = 0;
  let pending = 0;
  let mine = 0;

  for (let day = 1; day <= total; day += 1) {
    const dayShifts = shifts.get(dateKey(year, month, day)) ?? {};
    const shift = primaryShift(dayShifts);
    if (!shift) continue;
    booked += 1;
    if (shift.status === 'pending') pending += 1;
    if (shift.nurse?.id === currentNurseId) mine += 1;
  }

  const free = total - booked;
  return `ทั้งเดือน ${total} วัน · ว่าง ${free} วัน · รออนุมัติ ${pending} · เวรของฉัน ${mine}`;
}

/** รายละเอียดเวรของวันนั้น สำหรับกล่องยืนยัน */
export function renderSlotRows(dayShifts = {}) {
  const shift = primaryShift(dayShifts);
  return `
    <div class="slot-list">
      <div class="slot-row">
        <span class="slot-time mono">${DUTY_SLOT.label}</span>
        <span class="slot-who">${
          shift
            ? escapeHtml(shift.nurse?.full_name ?? '—')
            : '<span class="muted">ยังไม่มีผู้ปฏิบัติงาน</span>'
        }</span>
        ${shift ? `<span class="pill ${STATUS_PILL[shift.status]}">${STATUS_LABEL[shift.status]}</span>` : ''}
      </div>
    </div>
  `;
}
