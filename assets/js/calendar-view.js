/**
 * calendar-view.js — ฟังก์ชันวาดปฏิทิน (บริสุทธิ์ ไม่ยุ่งกับเครือข่าย/สถานะ)
 */
import { STATUS_LABEL, STATUS_PILL, BOOKABLE_SLOTS, DUTY_SLOT } from './config.js';
import { dateKey, daysInMonth, dayOfWeek, todayKey, DOW_TH_SHORT } from './thai.js';
import { escapeHtml, initialsOf } from './ui.js';
import { icon } from './icons.js';

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

/** วัน OFF ของพยาบาลคนนี้ในวันนั้น (ถ้ามี) */
export function myOffDay(offList = [], nurseId) {
  return offList.find((row) => row.nurse?.id === nurseId) ?? null;
}

/** หัวตาราง วันในสัปดาห์ */
export function renderDowHead() {
  return DOW_TH_SHORT
    .map((label, index) => `<span class="${[0, 6].includes(index) ? 'is-weekend' : ''}">${label}</span>`)
    .join('');
}

function dayCell({ year, month, day, key, dayShifts, holidayName, offList, currentNurseId, index }) {
  const shift = primaryShift(dayShifts);
  const isMine = shiftIdsOwnedBy(dayShifts, currentNurseId).length > 0;
  const myOff = myOffDay(offList, currentNurseId);
  const classes = ['day'];

  // ใช้ dayOfWeek แทน new Date(key) เพราะ "YYYY-MM-DD" ถูกตีความเป็น UTC
  // ซึ่งทำให้วันเสาร์/อาทิตย์เพี้ยนไป 1 วันในบางไทม์โซน
  if ([0, 6].includes(dayOfWeek(year, month, day))) classes.push('weekend');
  if (holidayName) classes.push('holiday');
  if (key === todayKey()) classes.push('today');
  if (shift) classes.push('taken');
  if (isMine) classes.push('is-mine');
  if (myOff) classes.push('is-off');

  let body = '';
  let footer;
  let ariaLabel;

  if (myOff) {
    footer = '<span class="pill neutral">OFF</span>';
    ariaLabel = `วันที่ ${day} คุณแจ้ง OFF ไว้`;
  } else if (shift) {
    const name = shift.nurse?.full_name ?? '—';
    body = `
      <span class="day-person">
        <span class="day-avatar" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>
        <span class="day-owner">${escapeHtml(name)}</span>
      </span>`;
    footer = `<span class="pill ${STATUS_PILL[shift.status]}">${STATUS_LABEL[shift.status]}</span>`;
    ariaLabel = `วันที่ ${day} ${name} ${STATUS_LABEL[shift.status]}`;
  } else {
    footer = `<span class="day-free">${icon('plus', { size: 12 })}ว่าง</span>`;
    ariaLabel = `วันที่ ${day} ยังไม่มีผู้จองเวร กดเพื่อจอง`;
  }

  // จำนวนคนที่แจ้ง OFF วันนั้น ช่วยให้เห็นว่าวันไหนคนไม่ว่างเยอะ
  const offBadge = offList.length
    ? `<span class="day-off-count" title="มีผู้แจ้ง OFF ${offList.length} คน">OFF ${offList.length}</span>`
    : '';

  return `
    <button type="button" class="${classes.join(' ')}" data-date="${key}"
            style="animation-delay:${Math.min(index * 8, 260)}ms"
            aria-label="${escapeHtml(ariaLabel)}">
      <span class="day-num">${day}${offBadge}</span>
      ${holidayName ? `<span class="day-holiday-name">${escapeHtml(holidayName)}</span>` : ''}
      ${body}
      <span class="day-foot">${footer}</span>
    </button>
  `;
}

/**
 * สร้าง HTML ของตารางทั้งเดือน
 * @param {{year:number, month:number, shifts:Map, holidays:Map, offDays:Map, currentNurseId:string}} options
 */
export function renderMonthGrid({ year, month, shifts, holidays, offDays, currentNurseId }) {
  const total = daysInMonth(year, month);
  const leadingBlanks = dayOfWeek(year, month, 1);

  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) {
    cells.push('<span class="day blank" aria-hidden="true"></span>');
  }
  for (let day = 1; day <= total; day += 1) {
    const key = dateKey(year, month, day);
    cells.push(dayCell({
      year,
      month,
      day,
      key,
      dayShifts: shifts.get(key) ?? {},
      holidayName: holidays.get(key),
      offList: offDays.get(key) ?? [],
      currentNurseId,
      index: leadingBlanks + day,
    }));
  }

  // เติมช่องท้ายให้ครบแถว ตารางจะได้เป็นสี่เหลี่ยมเต็ม
  const trailing = (7 - ((leadingBlanks + total) % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) {
    cells.push('<span class="day blank" aria-hidden="true"></span>');
  }

  return cells.join('');
}

/** สรุปสถิติของเดือน */
export function monthSummary({ year, month, shifts, offDays, currentNurseId, quota }) {
  const total = daysInMonth(year, month);
  let booked = 0;
  let mine = 0;
  let myOff = 0;

  for (let day = 1; day <= total; day += 1) {
    const key = dateKey(year, month, day);
    const shift = primaryShift(shifts.get(key) ?? {});
    if (shift) {
      booked += 1;
      if (shift.nurse?.id === currentNurseId) mine += 1;
    }
    if (myOffDay(offDays.get(key) ?? [], currentNurseId)) myOff += 1;
  }

  return { total, booked, free: total - booked, mine, myOff, quota };
}

/** แถบตัวเลขสรุปข้างชื่อเดือน */
export function renderStatStrip(summary) {
  const overQuota = summary.mine > summary.quota;
  return `
    <div class="stat free">
      <b>${summary.free}</b>
      <span>วันว่าง</span>
    </div>
    <div class="stat ${overQuota ? 'over' : 'mine'}">
      <b>${summary.mine}<span aria-hidden="true" style="font-size:15px;opacity:.5">/${summary.quota}</span></b>
      <span>เวรของฉัน</span>
    </div>
    <div class="stat">
      <b>${summary.myOff}</b>
      <span>OFF ของฉัน</span>
    </div>
  `;
}

/** รายละเอียดเวรของวันนั้น สำหรับกล่องยืนยัน */
export function renderSlotRows(dayShifts = {}, offList = []) {
  const shift = primaryShift(dayShifts);
  const offNames = offList.map((row) => row.nurse?.full_name).filter(Boolean);

  return `
    <div class="slot-list">
      <div class="slot-row">
        <span class="slot-time">${DUTY_SLOT.label}</span>
        <span class="slot-who">${
          shift
            ? escapeHtml(shift.nurse?.full_name ?? '—')
            : '<span class="muted">ยังไม่มีผู้ปฏิบัติงาน</span>'
        }</span>
        ${shift ? `<span class="pill ${STATUS_PILL[shift.status]}">${STATUS_LABEL[shift.status]}</span>` : ''}
      </div>
      ${offNames.length ? `
        <div class="slot-row">
          <span class="slot-time">แจ้ง OFF</span>
          <span class="slot-who caption">${escapeHtml(offNames.join(', '))}</span>
        </div>
      ` : ''}
    </div>
  `;
}
