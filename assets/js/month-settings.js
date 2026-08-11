/**
 * month-settings.js — ตั้งค่ารายเดือน: โควตาเวร, ล็อกการจอง, เปิดจอง OFF
 */
import { getClient } from './supabase.js';
import { toBuddhistYear } from './thai.js';

/** โควตาตั้งต้น — กุมภาพันธ์ 1 เวร เดือนอื่น 2 เวร (ต้องตรงกับ default_shift_quota ใน SQL) */
export const FEBRUARY = 2;
export const defaultQuota = (month) => (month === FEBRUARY ? 1 : 2);

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
