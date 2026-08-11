/**
 * env.js — ค่าเชื่อมต่อ Supabase ของแต่ละหน่วยงาน
 *
 * แก้ 3 บรรทัดนี้ให้ตรงกับโปรเจกต์ Supabase ของคุณ (ดูขั้นตอนใน docs/SETUP.md)
 * anon key เป็นคีย์สาธารณะ ปลอดภัยที่จะ commit — ความปลอดภัยอยู่ที่ RLS
 * ห้ามใส่ service_role key ที่นี่เด็ดขาด
 */
window.__DUTY_CONFIG__ = {
  supabaseUrl: 'https://ogamyepqxgxjkkicmwmk.supabase.co',
  supabaseAnonKey: 'sb_publishable_DUqD7tDyRPZhnaqit0-VOg_i_-G9lUk',
  authEmailDomain: 'duty.example.com',
};
