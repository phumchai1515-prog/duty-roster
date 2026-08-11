/**
 * print-document.js — สร้าง HTML ของเอกสารราชการ (ฟังก์ชันบริสุทธิ์)
 *
 * รูปแบบต้องตรงกับต้นฉบับ "บันทึกแนบท้ายคำสั่ง<ชื่อหน่วยงาน>"
 * — เลขไทยทุกตัว, 6 คอลัมน์, แถบเทาวันเสาร์-อาทิตย์
 */
import { SLOTS } from './config.js';
import {
  toThaiDigits, formatThaiMonthYear, dateKey, daysInMonth, dayOfWeek, DOW_TH,
} from './thai.js';
import { escapeHtml } from './ui.js';

const DEFAULT_ORG = 'โรงพยาบาลจิตเวชเลยราชนครินทร์';

function tableHead() {
  return `
    <thead>
      <tr>
        <th class="col-day"  rowspan="2">วัน</th>
        <th class="col-date" rowspan="2">วันที่</th>
        <th colspan="${SLOTS.length}">เวลา</th>
        <th class="col-note" rowspan="2">หมายเหตุ</th>
      </tr>
      <tr>
        ${SLOTS.map((slot) => `<th class="col-slot">${slot.labelThai}</th>`).join('')}
      </tr>
    </thead>
  `;
}

function tableRows({ year, month, shifts, holidays, includePending }) {
  const total = daysInMonth(year, month);
  const rows = [];

  for (let day = 1; day <= total; day += 1) {
    const key = dateKey(year, month, day);
    const dow = dayOfWeek(year, month, day);
    const dayShifts = shifts.get(key) ?? {};
    const holidayName = holidays.get(key);

    const classes = [];
    if ([0, 6].includes(dow)) classes.push('is-weekend');
    else if (holidayName) classes.push('is-holiday');

    const cells = SLOTS.map((slot) => {
      const shift = dayShifts[slot.key];
      const visible = shift && (includePending || shift.status === 'approved');
      return `<td class="col-name">${visible ? escapeHtml(shift.nurse?.full_name ?? '') : ''}</td>`;
    }).join('');

    // หมายเหตุ: ใช้ของเวรใดก็ได้ในวันนั้น ปกติกรอกที่เวรบ่าย
    const note = Object.values(dayShifts).find((shift) => shift?.note)?.note ?? '';

    rows.push(`
      <tr${classes.length ? ` class="${classes.join(' ')}"` : ''}>
        <td>${DOW_TH[dow]}</td>
        <td>${toThaiDigits(day)}</td>
        ${cells}
        <td>${escapeHtml(note)}</td>
      </tr>
    `);
  }
  return `<tbody>${rows.join('')}</tbody>`;
}

function signatureBlock(meta) {
  if (!meta?.signer_name) return '';
  return `
    <div class="doc-sign">
      <div class="doc-sign-box">
        <div class="doc-sign-line">ลงชื่อ ..............................................</div>
        <div>( ${escapeHtml(meta.signer_name)} )</div>
        ${meta.signer_position ? `<div>${escapeHtml(meta.signer_position)}</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * สร้างเอกสารทั้งแผ่น
 * @param {{year:number, month:number, shifts:Map, holidays:Map, meta:object, includePending:boolean}} options
 * @returns {string} HTML ที่พร้อมใส่ใน .sheet-a4
 */
export function renderDocument({ year, month, shifts, holidays, meta = {}, includePending = false }) {
  const org = meta.organization_name || DEFAULT_ORG;
  const orderLine = meta.order_no
    ? `<p class="doc-title">คำสั่งที่ ${escapeHtml(toThaiDigits(meta.order_no))}</p>`
    : '';

  return `
    ${orderLine}
    <p class="doc-title">บันทึกแนบท้ายคำสั่ง${escapeHtml(org)}</p>
    <p class="doc-subtitle">
      ตารางปฏิบัติงานนอกเวลาราชการและในวันหยุดราชการของพยาบาลตรวจการ
      ประจำเดือน ${formatThaiMonthYear(year, month)}
    </p>

    <table class="duty-table">
      ${tableHead()}
      ${tableRows({ year, month, shifts, holidays, includePending })}
    </table>

    ${signatureBlock(meta)}
  `;
}
