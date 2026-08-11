/**
 * provision-users.mjs — สร้างบัญชีเข้าสู่ระบบให้พยาบาลทุกคนที่มีในตาราง nurses
 *
 * ใช้:
 *   export SUPABASE_URL="https://xxxx.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   node scripts/provision-users.mjs                 # ดูว่าจะทำอะไรบ้าง (dry run)
 *   node scripts/provision-users.mjs --apply         # ลงมือจริง
 *   node scripts/provision-users.mjs --apply --reset-pin benja   # รีเซ็ต PIN คนเดียว
 *
 * service_role key มีสิทธิ์เต็มฐานข้อมูล — รันจากเครื่องตัวเองเท่านั้น
 * ห้าม commit และห้ามใส่ไว้ในไฟล์ที่ deploy ขึ้นเว็บ
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN ?? 'duty.example.com';
const DEFAULT_PIN = process.env.DEFAULT_PIN ?? '112233';

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const resetIndex = args.indexOf('--reset-pin');
const resetSlug = resetIndex >= 0 ? args[resetIndex + 1] : null;

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  fail('ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ก่อน (ดู docs/SETUP.md)');
}
if (!/^\d{6,}$/.test(DEFAULT_PIN)) {
  fail('DEFAULT_PIN ต้องเป็นตัวเลขอย่างน้อย 6 หลัก');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const emailFor = (slug) => `${slug}@${EMAIL_DOMAIN}`;

/** ดึงผู้ใช้ auth ทั้งหมด (ไล่ทีละหน้า) แล้วทำเป็น map email → user */
async function fetchAuthUsers() {
  const users = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${error.message}`);
    for (const user of data.users) users.set(user.email, user);
    if (data.users.length < 200) break;
  }
  return users;
}

async function main() {
  const { data: nurses, error } = await admin
    .from('nurses')
    .select('id, slug, full_name, auth_user_id')
    .order('sort_order');

  if (error) fail(`อ่านตาราง nurses ไม่สำเร็จ: ${error.message}`);
  if (!nurses?.length) fail('ตาราง nurses ว่าง — รัน supabase/04_seed.sql ก่อน');

  const authUsers = await fetchAuthUsers();
  const targets = resetSlug ? nurses.filter((n) => n.slug === resetSlug) : nurses;

  if (resetSlug && !targets.length) fail(`ไม่พบพยาบาล slug = "${resetSlug}"`);

  console.log(`\nโหมด: ${isApply ? 'ลงมือจริง' : 'ทดลอง (dry run)'}`);
  console.log(`โดเมนอีเมลแฝง: @${EMAIL_DOMAIN}`);
  console.log(`PIN ตั้งต้น: ${DEFAULT_PIN}\n`);

  const summary = { created: 0, reset: 0, linked: 0, skipped: 0 };

  for (const nurse of targets) {
    const email = emailFor(nurse.slug);
    const existing = authUsers.get(email);
    const label = `${nurse.full_name.padEnd(28)} ${email}`;

    if (!existing) {
      if (!isApply) {
        console.log(`  + สร้างใหม่   ${label}`);
        summary.created += 1;
        continue;
      }
      const { data, error: createError } = await admin.auth.admin.createUser({
        email,
        password: DEFAULT_PIN,
        email_confirm: true,
        user_metadata: { full_name: nurse.full_name, slug: nurse.slug },
      });
      if (createError) {
        console.error(`  ✗ ล้มเหลว    ${label} — ${createError.message}`);
        continue;
      }
      await admin.from('nurses')
        .update({ auth_user_id: data.user.id, must_change_pin: true })
        .eq('id', nurse.id);
      console.log(`  + สร้างแล้ว   ${label}`);
      summary.created += 1;
      continue;
    }

    if (resetSlug) {
      if (isApply) {
        await admin.auth.admin.updateUserById(existing.id, { password: DEFAULT_PIN });
        await admin.from('nurses').update({ must_change_pin: true }).eq('id', nurse.id);
      }
      console.log(`  ↻ รีเซ็ต PIN  ${label}`);
      summary.reset += 1;
      continue;
    }

    if (nurse.auth_user_id !== existing.id) {
      if (isApply) {
        await admin.from('nurses').update({ auth_user_id: existing.id }).eq('id', nurse.id);
      }
      console.log(`  ⇄ ผูกบัญชี    ${label}`);
      summary.linked += 1;
      continue;
    }

    console.log(`  · มีอยู่แล้ว  ${label}`);
    summary.skipped += 1;
  }

  console.log(
    `\nสรุป: สร้าง ${summary.created} · ผูก ${summary.linked} · ` +
    `รีเซ็ต ${summary.reset} · ข้าม ${summary.skipped}`,
  );
  if (!isApply) console.log('\nยังไม่ได้แก้อะไรจริง — ใส่ --apply เพื่อลงมือ\n');
  else console.log('\nแจ้ง PIN ตั้งต้นให้พยาบาลแต่ละคน ระบบจะบังคับเปลี่ยนเมื่อเข้าครั้งแรก\n');
}

main().catch((error) => fail(error.message));
