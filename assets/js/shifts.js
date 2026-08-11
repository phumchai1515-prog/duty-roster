/**
 * shifts.js — ชั้นเข้าถึงข้อมูลเวร (ไม่มี DOM ในไฟล์นี้)
 * ทุกฟังก์ชันคืนค่าเป็นออบเจ็กต์ใหม่เสมอ ไม่แก้ข้อมูลเดิมในที่เดิม
 */
import { getClient } from './supabase.js';
import { BOOKABLE_SLOTS } from './config.js';
import { dateKey, daysInMonth } from './thai.js';

const SHIFT_FIELDS = `
  id, duty_date, slot, status, note, reviewed_at, review_note,
  nurse:nurses!shifts_nurse_id_fkey ( id, full_name, is_admin )
`;

/** ขอบเขตวันที่ของเดือน (ปี ค.ศ.) แบบ [เริ่ม, สิ้นสุด] */
function monthRange(year, month) {
  return [dateKey(year, month, 1), dateKey(year, month, daysInMonth(year, month))];
}

/** โหลดเวรทั้งเดือน คืน Map: "YYYY-MM-DD" → { slotKey: shift } */
export async function loadMonthShifts(year, month) {
  const [from, to] = monthRange(year, month);
  const { data, error } = await getClient()
    .from('shifts')
    .select(SHIFT_FIELDS)
    .gte('duty_date', from)
    .lte('duty_date', to)
    .neq('status', 'rejected')
    .order('duty_date');

  if (error) throw error;

  const byDate = new Map();
  for (const shift of data ?? []) {
    const existing = byDate.get(shift.duty_date) ?? {};
    byDate.set(shift.duty_date, { ...existing, [shift.slot]: shift });
  }
  return byDate;
}

/** วันหยุดราชการในเดือน คืน Map: "YYYY-MM-DD" → ชื่อวันหยุด */
export async function loadMonthHolidays(year, month) {
  const [from, to] = monthRange(year, month);
  const { data, error } = await getClient()
    .from('holidays')
    .select('duty_date, name')
    .gte('duty_date', from)
    .lte('duty_date', to);

  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.duty_date, row.name]));
}

/**
 * จองเวรตรวจการของวันนั้น (ช่วง 16.30 - 00.30 น.)
 * ถ้ามีคนจองไปแล้ว ฐานข้อมูลจะปฏิเสธด้วย unique constraint
 */
export async function bookShift(dutyDateKey, { slots = BOOKABLE_SLOTS, note = null } = {}) {
  const { data, error } = await getClient().rpc('book_shift', {
    p_duty_date: dutyDateKey,
    p_slots: [...slots],
    p_note: note,
  });
  if (error) throw error;
  return data ?? [];
}

/** ยกเลิกเวรที่ยังรออนุมัติ (ทำได้ทั้งชุดของวันนั้น) */
export async function cancelShifts(shiftIds) {
  if (!shiftIds.length) return;
  const { error } = await getClient().from('shifts').delete().in('id', shiftIds);
  if (error) throw error;
}

/** หัวหน้าอนุมัติ / ไม่อนุมัติ */
export async function reviewShifts(shiftIds, { approve, reviewerId, note = null }) {
  if (!shiftIds.length) return;
  const { error } = await getClient()
    .from('shifts')
    .update({
      status: approve ? 'approved' : 'rejected',
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .in('id', shiftIds);
  if (error) throw error;
}

/** อนุมัติทุกเวรที่รออยู่ในเดือนนั้นรวดเดียว คืนจำนวนที่อนุมัติ */
export async function approveMonth(year, month) {
  const { data, error } = await getClient().rpc('approve_month', {
    p_year: year,
    p_month: month,
  });
  if (error) throw error;
  return data ?? 0;
}

/** เวรที่รออนุมัติทั้งหมด (หน้าหัวหน้า) */
export async function loadPendingShifts() {
  const { data, error } = await getClient()
    .from('shifts')
    .select(SHIFT_FIELDS)
    .eq('status', 'pending')
    .order('duty_date');

  if (error) throw error;
  return data ?? [];
}

/** เวรของพยาบาลคนหนึ่ง ตั้งแต่วันที่กำหนดเป็นต้นไป */
export async function loadNurseShifts(nurseId, { from = null } = {}) {
  let query = getClient()
    .from('shifts')
    .select(SHIFT_FIELDS)
    .eq('nurse_id', nurseId)
    .neq('status', 'rejected')
    .order('duty_date');

  if (from) query = query.gte('duty_date', from);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** สรุปจำนวนเวรต่อคนในช่วงที่กำหนด — ใช้ดูความเป็นธรรมของการกระจายเวร */
export async function loadWorkloadSummary(from, to) {
  const { data, error } = await getClient()
    .from('shifts')
    .select('nurse:nurses!shifts_nurse_id_fkey ( id, full_name )')
    .gte('duty_date', from)
    .lte('duty_date', to)
    .eq('slot', 'evening')          // นับเวรบ่ายเป็นตัวแทน 1 คืน กันนับซ้ำกับเวรดึก
    .neq('status', 'rejected');

  if (error) throw error;

  const counts = new Map();
  for (const row of data ?? []) {
    if (!row.nurse) continue;
    const current = counts.get(row.nurse.id);
    counts.set(row.nurse.id, {
      id: row.nurse.id,
      fullName: row.nurse.full_name,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * ฟังการเปลี่ยนแปลงของตาราง shifts แบบ realtime
 * คืนฟังก์ชันสำหรับยกเลิกการฟัง
 */
export function subscribeToShifts(onChange) {
  const channel = getClient()
    .channel('shifts-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, onChange)
    .subscribe();

  return () => { getClient().removeChannel(channel); };
}
