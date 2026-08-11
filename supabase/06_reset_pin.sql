-- ============================================================
-- รีเซ็ต PIN ให้พยาบาลที่ลืมรหัส
--
-- แก้ 2 ค่าข้างล่างก่อนรัน แล้วรันใน SQL Editor
--   v_slug → ตัวสะกดอังกฤษของคนที่ต้องการรีเซ็ต (ดูจากตาราง nurses)
--   v_pin  → PIN ใหม่ อย่างน้อย 6 หลัก
--
-- ระบบจะบังคับให้เจ้าตัวตั้ง PIN ใหม่อีกครั้งตอนเข้าครั้งถัดไป
-- ============================================================

set search_path = public, extensions, auth;

do $$
declare
  v_slug text := 'benja';       -- ← แก้ตรงนี้
  v_pin  text := '112233';      -- ← และตรงนี้
  v_user uuid;
  v_name text;
begin
  select auth_user_id, full_name into v_user, v_name
    from public.nurses where slug = v_slug;

  if v_user is null then
    raise exception 'ไม่พบพยาบาล slug = "%" หรือยังไม่มีบัญชีเข้าระบบ', v_slug;
  end if;

  if length(v_pin) < 6 or v_pin !~ '^\d+$' then
    raise exception 'PIN ต้องเป็นตัวเลขอย่างน้อย 6 หลัก';
  end if;

  update auth.users
     set encrypted_password = crypt(v_pin, gen_salt('bf')),
         updated_at = now()
   where id = v_user;

  update public.nurses set must_change_pin = true where slug = v_slug;

  raise notice 'รีเซ็ต PIN ของ % เรียบร้อย — PIN ใหม่คือ %', v_name, v_pin;
end $$;
