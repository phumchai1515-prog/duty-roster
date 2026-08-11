/**
 * thai.js — ตัวช่วยเรื่องวันที่/ตัวเลขไทย
 * ใช้ร่วมทุกหน้า โดยเฉพาะหน้าพิมพ์เอกสารราชการที่ต้องใช้เลขไทย
 */

const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];

export const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export const MONTHS_TH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** เรียงตาม getDay() ของ JS: 0 = อาทิตย์ */
export const DOW_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const DOW_TH_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

/** แปลงเลขอารบิกทุกตัวในสตริงเป็นเลขไทย */
export function toThaiDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (d) => THAI_DIGITS[Number(d)]);
}

/** แปลงเลขไทยกลับเป็นอารบิก */
export function toArabicDigits(value) {
  return String(value ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

export const toBuddhistYear = (gregorianYear) => gregorianYear + 543;
export const toGregorianYear = (buddhistYear) => buddhistYear - 543;

/**
 * สร้างคีย์วันที่รูปแบบ YYYY-MM-DD จากปี ค.ศ. / เดือน 1-12 / วัน
 * ใช้ string ล้วนเพื่อเลี่ยงปัญหา timezone ของ Date.toISOString()
 */
export function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** แยกคีย์ YYYY-MM-DD กลับเป็นตัวเลข */
export function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return { year, month, day };
}

/** จำนวนวันในเดือน (month = 1-12) */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** getDay() ของวันที่กำหนด โดยไม่พึ่ง timezone */
export function dayOfWeek(year, month, day) {
  return new Date(year, month - 1, day).getDay();
}

/** "๑๕ สิงหาคม ๒๕๖๘" — ใช้ในเอกสารราชการ */
export function formatThaiDateFull(key) {
  const { year, month, day } = parseDateKey(key);
  return `${toThaiDigits(day)} ${MONTHS_TH[month - 1]} ${toThaiDigits(toBuddhistYear(year))}`;
}

/** "15 ส.ค. 68" — ใช้บนหน้าจอ อ่านเร็วกว่า */
export function formatThaiDateShort(key) {
  const { year, month, day } = parseDateKey(key);
  return `${day} ${MONTHS_TH_SHORT[month - 1]} ${String(toBuddhistYear(year)).slice(-2)}`;
}

/** "สิงหาคม ๒๕๖๘" */
export function formatThaiMonthYear(year, month, { thaiDigits = true } = {}) {
  const be = toBuddhistYear(year);
  return `${MONTHS_TH[month - 1]} ${thaiDigits ? toThaiDigits(be) : be}`;
}

export const isWeekend = (year, month, day) => [0, 6].includes(dayOfWeek(year, month, day));

/** วันนี้ในรูปแบบ YYYY-MM-DD ตามเวลาเครื่องผู้ใช้ */
export function todayKey() {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** บวก/ลบเดือนแบบปลอดภัย คืนค่า { year, month } */
export function shiftMonth(year, month, delta) {
  const index = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
