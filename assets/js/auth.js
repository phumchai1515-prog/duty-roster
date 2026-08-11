/**
 * auth.js — เข้าสู่ระบบด้วย "เลือกชื่อ + PIN"
 *
 * เบื้องหลังใช้ Supabase Auth จริง (email/password) โดยแปลง
 *   ชื่อพยาบาล → slug → อีเมลแฝง  และ  PIN → password
 * เพื่อให้ได้ JWT จริง และ Row Level Security บังคับสิทธิ์ได้จริง
 * ผู้ใช้ไม่เคยเห็นอีเมลแฝงนี้
 */
import { getClient } from './supabase.js';
import { AUTH_EMAIL_DOMAIN, PIN_LENGTH } from './config.js';

const emailFor = (slug) => `${slug}@${AUTH_EMAIL_DOMAIN}`;

let cachedSession = null;

/** รายชื่อพยาบาลสำหรับหน้าล็อกอิน — อ่านได้โดยยังไม่ต้องล็อกอิน */
export async function listNursesForLogin() {
  const { data, error } = await getClient()
    .from('nurse_directory')
    .select('id, slug, full_name')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export function validatePin(pin) {
  if (!pin) return 'กรุณากรอกรหัส PIN';
  if (!/^\d+$/.test(pin)) return 'รหัส PIN ต้องเป็นตัวเลขเท่านั้น';
  if (pin.length !== PIN_LENGTH) return `รหัส PIN ต้องมี ${PIN_LENGTH} หลัก`;
  return null;
}

export async function signIn(slug, pin) {
  const { error } = await getClient().auth.signInWithPassword({
    email: emailFor(slug),
    password: pin,
  });
  if (error) throw error;
  cachedSession = null;
  return getSession();
}

export async function signOut() {
  cachedSession = null;
  await getClient().auth.signOut();
}

/**
 * คืน { user, nurse } ถ้าล็อกอินอยู่ / คืน null ถ้ายัง
 * แคชไว้ในหน่วยความจำหน้าเดียว ไม่เขียนลง localStorage
 */
export async function getSession({ force = false } = {}) {
  if (cachedSession && !force) return cachedSession;

  const client = getClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    cachedSession = null;
    return null;
  }

  const { data: nurse, error } = await client
    .from('nurses')
    .select('id, slug, full_name, prefix, first_name, last_name, is_admin, is_active, must_change_pin')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error) throw error;

  // มี auth user แต่ไม่มีแถวใน nurses หรือถูกปิดใช้งาน = ใช้ระบบต่อไม่ได้
  if (!nurse || !nurse.is_active) {
    await client.auth.signOut();
    cachedSession = null;
    return null;
  }

  cachedSession = { user: session.user, nurse };
  return cachedSession;
}

/** เปลี่ยน PIN ของตัวเอง */
export async function changePin(newPin) {
  const validationError = validatePin(newPin);
  if (validationError) throw new Error(validationError);

  const client = getClient();
  const { error: authError } = await client.auth.updateUser({ password: newPin });
  if (authError) throw authError;

  // ล้างธงผ่าน RPC — ตาราง nurses ไม่เปิดให้ผู้ใช้ update เองเพื่อกันการยกระดับสิทธิ์
  const { error: flagError } = await client.rpc('mark_pin_changed');
  if (flagError) throw flagError;

  cachedSession = null;
  return getSession({ force: true });
}
