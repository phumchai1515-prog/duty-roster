/**
 * swaps.js — คำขอแลกเวร (ชั้นข้อมูล)
 */
import { getClient } from './supabase.js';

const SWAP_FIELDS = `
  id, status, reason, created_at,
  shift:shifts ( id, duty_date, slot, status ),
  from_nurse:nurses!swap_requests_from_nurse_id_fkey ( id, full_name ),
  to_nurse:nurses!swap_requests_to_nurse_id_fkey ( id, full_name )
`;

/** คำขอที่ส่งมาถึงฉันและยังไม่ได้ตอบ */
export async function loadIncomingSwaps(nurseId) {
  const { data, error } = await getClient()
    .from('swap_requests')
    .select(SWAP_FIELDS)
    .eq('to_nurse_id', nurseId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** คำขอที่ฉันส่งออกไปและยังรอคำตอบ — คืน Map: shiftId → คำขอ */
export async function loadOutgoingSwaps(nurseId) {
  const { data, error } = await getClient()
    .from('swap_requests')
    .select(SWAP_FIELDS)
    .eq('from_nurse_id', nurseId)
    .eq('status', 'pending');

  if (error) throw error;
  return new Map((data ?? []).map((request) => [request.shift.id, request]));
}

export async function createSwapRequest({ shiftId, fromNurseId, toNurseId, reason }) {
  const { data, error } = await getClient()
    .from('swap_requests')
    .insert({
      shift_id: shiftId,
      from_nurse_id: fromNurseId,
      to_nurse_id: toNurseId,
      reason: reason || null,
    })
    .select(SWAP_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

/** ตอบรับ / ปฏิเสธ — ทำผ่าน RPC เพราะต้องย้ายเจ้าของเวรด้วย */
export async function respondToSwap(requestId, accept) {
  const { data, error } = await getClient().rpc('respond_swap', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw error;
  return data;
}

export async function cancelSwapRequest(requestId) {
  const { error } = await getClient()
    .from('swap_requests')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
}

/** รายชื่อพยาบาลคนอื่นที่ยังใช้งานอยู่ (ไว้เลือกเป็นผู้รับแลกเวร) */
export async function loadColleagues(excludeNurseId) {
  const { data, error } = await getClient()
    .from('nurses')
    .select('id, full_name')
    .eq('is_active', true)
    .neq('id', excludeNurseId)
    .order('sort_order');

  if (error) throw error;
  return data ?? [];
}
