/**
 * config.js — ค่าตั้งต้นของระบบ
 *
 * SUPABASE_ANON_KEY เป็นคีย์สาธารณะโดยการออกแบบ (เปิดเผยได้)
 * ความปลอดภัยอยู่ที่ Row Level Security ในฐานข้อมูล ไม่ใช่การซ่อนคีย์นี้
 * ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด
 */

export const SUPABASE_URL = window.__DUTY_CONFIG__?.supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = window.__DUTY_CONFIG__?.supabaseAnonKey ?? '';

/** โดเมนอีเมลแฝง — ผู้ใช้ไม่เห็น ใช้ผูกชื่อพยาบาลเข้ากับ Supabase Auth */
export const AUTH_EMAIL_DOMAIN = window.__DUTY_CONFIG__?.authEmailDomain ?? 'duty.example.com';

/**
 * คอลัมน์เวลาในเอกสารราชการ — ฟอร์มมี 3 ช่องเสมอ ห้ามเปลี่ยน
 * ใช้เฉพาะตอนสร้างเอกสารพิมพ์เท่านั้น ไม่ใช่รายการที่จองได้
 */
export const SLOTS = Object.freeze([
  { key: 'day',     label: '08.30 น. - 16.30 น.', short: 'เวรเช้า', labelThai: '๐๘.๓๐ น.-๑๖.๓๐ น.' },
  { key: 'evening', label: '16.30 น. - 00.30 น.', short: 'เวรตรวจการ', labelThai: '๑๖.๓๐ น.- ๐๐.๓๐ น.' },
  { key: 'night',   label: '00.30 น. - 08.30 น.', short: 'เวรดึก',  labelThai: '๐๐.๓๐ น.- ๐๘.๓๐ น.' },
]);

/**
 * เวรตรวจการมีช่วงเดียว คือ 16.30 น. - 00.30 น.
 * อีก 2 คอลัมน์ในเอกสารเว้นว่างไว้ตามแบบฟอร์มเดิม
 */
export const BOOKABLE_SLOTS = Object.freeze(['evening']);

export const SLOT_BY_KEY = Object.freeze(
  Object.fromEntries(SLOTS.map((slot) => [slot.key, slot])),
);

/** ช่วงเวลาเดียวที่ใช้จริง — ใช้แสดงบนหน้าจอ */
export const DUTY_SLOT = SLOT_BY_KEY.evening;

export const STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const STATUS_LABEL = Object.freeze({
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
});

/** class ของ .pill ที่ใช้กับแต่ละสถานะ — ห้ามสื่อความหมายด้วยสีอย่างเดียว ต้องมีข้อความกำกับ */
export const STATUS_PILL = Object.freeze({
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
});

/** กติกาการจอง */
export const RULES = Object.freeze({
  /** จองล่วงหน้าได้ไกลสุดกี่วัน */
  maxDaysAhead: 180,
  /** ยกเลิกเวรที่อนุมัติแล้วเองไม่ได้ ต้องขอหัวหน้า */
  selfCancelApproved: false,
  /** เตือนเมื่อจองเวรติดกันเกินกี่คืน */
  consecutiveWarnAt: 3,
});

export const PIN_LENGTH = 6;
