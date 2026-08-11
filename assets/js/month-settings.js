/**
 * month-settings.js — ตั้งค่ารายเดือน: โควตาเวร, ล็อกการจอง, เปิดจอง OFF
 */
import { getClient } from './supabase.js';
import { toBuddhistYear } from './thai.js';

/**
 * โควตาตั้งต้น 2 เวร/คน/เดือน ทุกเดือนรวมกุมภาพันธ์
 * (ต้องตรงกับ default_shift_quota ใน SQL)
 *
 * กุมภาพันธ์เคยตั้งไว้ 1 เวร แต่ผู้ขึ้นเวร 18 คน × 1 = 18 ที่นั่ง
 * ไม่พอกับ 28 วัน จึงขาดผู้ปฏิบัติงาน 10 วัน — แก้เป็น 2 เมื่อ 2026-08-11
 * ผู้ดูแลระบบปรับรายเดือนได้เองที่หน้า "ผู้ดูแลระบบ"
 */
export const DEFAULT_QUOTA = 2;
export const defaultQuota = () => DEFAULT_QUOTA;

/**
 * อ่านค่าตั้งค่าของเดือน (ปี ค.ศ.) — ถ้ายังไม่เคยตั้งจะได้ค่าตั้งต้นกลับมา
 * @returns {Promise<{year_be:number, month:number, shift_quota:number, shifts_locked:boolean, off_booking_open:boolean, note:string|null}>}
 */
export async function loadMonthSetting(year, month) {
  const { data, error } = await getClient().rpc('month_setting', {
    p_year_be: toBuddhistYear(year),
    p_month: month,
  });
  if (error) throw error;

  return data ?? {
    year_be: toBuddhistYear(year),
    month,
    shift_quota: defaultQuota(month),
    shifts_locked: false,
    off_booking_open: false,
    note: null,
    auto_fill_at: null,
    auto_filled_at: null,
  };
}

/** บันทึกค่าตั้งค่า (เฉพาะผู้ดูแลระบบ — RLS บังคับอีกชั้น) */
export async function saveMonthSetting(year, month, changes) {
  const { error } = await getClient()
    .from('month_settings')
    .upsert({
      year_be: toBuddhistYear(year),
      month,
      shift_quota: changes.shiftQuota,
      shifts_locked: changes.shiftsLocked,
      off_booking_open: changes.offBookingOpen,
      note: changes.note ?? null,
      auto_fill_at: changes.autoFillAt || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'year_be,month' });

  if (error) throw error;
}

/** ค่าตั้งค่าหลายเดือนพร้อมกัน สำหรับตารางในหน้า Admin */
export async function loadSettingsRange(fromYearBe, toYearBe) {
  const { data, error } = await getClient()
    .from('month_settings')
    .select('*')
    .gte('year_be', fromYearBe)
    .lte('year_be', toYearBe);

  if (error) throw error;
  return new Map((data ?? []).map((row) => [`${row.year_be}-${row.month}`, row]));
}

/** สถานะการจองของเดือน — ผู้ดูแลใช้ดูว่าเหลือวันว่างกี่วัน ใครยังไม่จอง */
export async function loadBookingStatus(year, month) {
  const { data, error } = await getClient().rpc('month_booking_status', {
    p_year_be: toBuddhistYear(year),
    p_month: month,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** เติมเวรที่ยังว่างให้ทันที (เฉพาะผู้ดูแล) — คืนรายการที่เติม */
export async function autoFillMonth(year, month) {
  const { data, error } = await getClient().rpc('auto_fill_month', {
    p_year_be: toBuddhistYear(year),
    p_month: month,
  });
  if (error) throw error;
  return data ?? [];
}
