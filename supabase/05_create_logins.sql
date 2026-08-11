-- ============================================================
-- สร้างบัญชีเข้าระบบให้พยาบาลทุกคนที่ยังไม่มี
--
-- ทางเลือกแทนการรัน scripts/setup-users.sh — ไม่ต้องใช้ secret key
-- รันซ้ำได้ปลอดภัย คนที่มีบัญชีแล้วจะถูกข้าม
--
-- ⚠️ เมื่อ Supabase เตือน "Potential issue detected … auth.identities"
--    ให้กด **Run without RLS** เท่านั้น
--    เป็นการเตือนผิดพลาด เพราะเราแค่ insert ไม่ได้ create table
--    ปุ่ม "Run and enable RLS" จะไปแก้ตารางระบบของ Supabase — ห้ามกด
--
-- แก้ PIN ตั้งต้นได้ที่บรรทัด crypt('112233', …) — อย่างน้อย 6 หลัก
-- ต้องให้ค่าโดเมนตรงกับ authEmailDomain ใน assets/js/env.js
-- ============================================================

set search_path = public, extensions, auth;

with created as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    gen_random_uuid(),
    'authenticated', 'authenticated',
    n.slug || '@duty.example.com',
    crypt('112233', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', n.full_name, 'slug', n.slug),
    '', '', '', ''
  from public.nurses n
  where n.auth_user_id is null
    and not exists (
      select 1 from auth.users u where u.email = n.slug || '@duty.example.com'
    )
  returning id, email, raw_user_meta_data->>'slug' as slug
),
-- GoTrue ต้องมีแถวใน auth.identities ด้วย ไม่งั้นล็อกอินด้วยอีเมลไม่ผ่าน
ident as (
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  select
    c.id::text, c.id,
    jsonb_build_object(
      'sub', c.id::text, 'email', c.email,
      'email_verified', true, 'phone_verified', false
    ),
    'email', now(), now(), now()
  from created c
  returning user_id
),
linked as (
  update public.nurses n
     set auth_user_id = c.id, must_change_pin = true
    from created c
   where n.slug = c.slug
  returning n.id
)
select
  (select count(*) from created) as "สร้างบัญชีใหม่",
  (select count(*) from ident)   as "สร้าง identity",
  (select count(*) from linked)  as "ผูกกับพยาบาล";
