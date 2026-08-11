/**
 * off-days.js — วัน OFF (วันที่พยาบาลแจ้งว่าขึ้นเวรไม่ได้)
 * กันเฉพาะเจ้าตัว ไม่กระทบการจองของคนอื่น
 */
import { getClient } from './supabase.js';
import { dateKey, daysInMonth } from './thai.js';

const OFF_FIELDS = `
  id, off_date, reason,
  nurse:nurses!off_days_nurse_id_fkey ( id, full_name )
`;

/** วัน OFF ทั้งเดือน คืน Map: "YYYY-MM-DD" → รายการ off ของวันนั้น */
export async function loadMonthOffDays(year, month) {
  const { data, error } = await getClient()
    .from('off_days')
    .select(OFF_FIELDS)
    .gte('off_date', dateKey(year, month, 1))
    .lte('off_date', dateKey(year, month, daysInMonth(year, month)))
    .order('off_date');

  if (error) throw error;

  const byDate = new Map();
  for (const row of data ?? []) {
    byDate.set(row.off_date, [...(byDate.get(row.off_date) ?? []), row]);
  }
  return byDate;
}

/** วัน OFF ของพยาบาลคนหนึ่ง ตั้งแต่วันที่กำหนด */
export async function loadNurseOffDays(nurseId, { from = null } = {}) {
  let query = getClient()
    .from('off_days')
    .select(OFF_FIELDS)
    .eq('nurse_id', nurseId)
    .order('off_date');

  if (from) query = query.gte('off_date', from);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** แจ้ง OFF — ผ่าน RPC เพราะต้องตรวจว่าเปิดให้จองแล้วและไม่ชนกับเวรที่จองไว้ */
export async function bookOffDay(offDateKey, reason = null) {
  const { data, error } = await getClient().rpc('book_off_day', {
    p_off_date: offDateKey,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function cancelOffDay(offDayId) {
  const { error } = await getClient().from('off_days').delete().eq('id', offDayId);
  if (error) throw error;
}
