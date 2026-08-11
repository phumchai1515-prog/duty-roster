-- ============================================================
-- รีเซ็ตข้อมูลการจอง + ตั้ง PIN ใหม่เป็น 112233 ทุกคน
--
-- ⚠️ สคริปต์นี้ลบข้อมูลถาวร กู้คืนไม่ได้ รันครั้งเดียวใน SQL Editor
--
-- ⚠️ ตอนกด Run — Supabase จะเด้งกล่อง "Potential issues detected"
--    เพราะมีคำสั่ง delete และ update ที่ไม่มี where
--    ต้องกดปุ่ม **Run query** ในกล่องนั้นด้วย ไม่งั้นคำสั่งจะไม่ทำงานเลย
--    (อาการ: กด Run แล้วเงียบ ข้อมูลยังอยู่ครบเหมือนเดิม)
--
-- ลบ    : เวรทั้งหมด (รวมประวัติปี 2568) · วัน OFF · คำขอแลกเวร · log การใช้งาน
-- เก็บ  : รายชื่อผู้ขึ้นเวร · วันหยุดราชการ · ตั้งค่าเดือน + เวลาเติมอัตโนมัติ
-- ตั้งใหม่: PIN ของทุกคน = 112233 และบังคับให้เปลี่ยนตอนเข้าครั้งถัดไป
--
-- รันหลัง 11_keep_alive.sql
-- ============================================================

set search_path = public, extensions, auth;

do $$
declare
  RESET_PIN constant text := '112233';

  v_shifts integer;
  v_offs   integer;
  v_swaps  integer;
  v_logs   integer;
  v_pins   integer;
  v_admin  text;
begin
  -- ---------- 1) ลบข้อมูลการจอง (เรียงตาม foreign key) ----------
  delete from public.swap_requests;
  get diagnostics v_swaps = row_count;

  delete from public.off_days;
  get diagnostics v_offs = row_count;

  -- trigger shifts_audit จะเขียน audit_log ระหว่างลบ จึงต้องล้าง log ทีหลัง
  delete from public.shifts;
  get diagnostics v_shifts = row_count;

  delete from public.audit_log;
  get diagnostics v_logs = row_count;

  raise notice 'ลบแล้ว — เวร % · OFF % · แลกเวร % · log %',
               v_shifts, v_offs, v_swaps, v_logs;

  -- ---------- 2) ตั้ง PIN ใหม่ให้ทุกคนที่มีบัญชีเข้าระบบ ----------
  update auth.users u
     set encrypted_password = crypt(RESET_PIN, gen_salt('bf')),
         updated_at         = now()
    from public.nurses n
   where n.auth_user_id = u.id;
  get diagnostics v_pins = row_count;

  -- บังคับให้ทุกคนตั้ง PIN ของตัวเองตอนเข้าครั้งถัดไป
  update public.nurses set must_change_pin = true;

  raise notice 'ตั้ง PIN ใหม่ % บัญชี = %', v_pins, RESET_PIN;

  -- ---------- 3) ตรวจว่าสิทธิ์ผู้ดูแลระบบยังอยู่ครบถ้วน ----------
  -- ไม่แตะ is_admin เลย เพราะของเดิมถูกอยู่แล้ว — แค่ยืนยันว่ายังมีคนเดียว
  -- ถ้าผิดจากที่คาด จะยกเลิกทั้ง transaction รวมถึงการลบข้างบนด้วย
  select string_agg(full_name, ', ') into v_admin
    from public.nurses where is_admin and is_active;

  if v_admin is null then
    raise exception 'ไม่เหลือผู้ดูแลระบบเลย — ยกเลิกทั้งหมด';
  end if;

  if (select count(*) from public.nurses where is_admin) <> 1 then
    raise exception 'ผู้ดูแลระบบไม่ได้มีคนเดียว (%) — ยกเลิกทั้งหมด', v_admin;
  end if;

  raise notice 'ผู้ดูแลระบบ (คงเดิม) = %', v_admin;
end $$;


-- ============================================================
-- ตรวจผล — ทุกบรรทัดต้องตรงกับคอลัมน์ "ควรเป็น"
-- ============================================================
select 'เวร'          as "รายการ", count(*) as "คงเหลือ", 0  as "ควรเป็น" from public.shifts
union all
select 'วัน OFF',            count(*), 0  from public.off_days
union all
select 'คำขอแลกเวร',         count(*), 0  from public.swap_requests
union all
select 'log การใช้งาน',      count(*), 0  from public.audit_log
union all
select 'รายชื่อผู้ขึ้นเวร',  count(*), 18 from public.nurses
union all
select 'วันหยุดราชการ',      count(*), 5  from public.holidays
union all
select 'ตั้งค่าเดือน',       count(*), 5  from public.month_settings
union all
select 'ผู้ดูแลระบบ',        count(*), 1  from public.nurses where is_admin
union all
select 'ยังใช้ PIN ตั้งต้น', count(*), 18 from public.nurses where must_change_pin;

-- ตารางเวลาเติมอัตโนมัติที่ยังอยู่ (ต้องเห็น ก.ย.–ธ.ค. 2569 ครบ 4 เดือน)
select month as "เดือน", year_be as "ปี", shift_quota as "โควตา",
       auto_fill_at as "เติมอัตโนมัติเมื่อ", auto_filled_at as "เติมแล้วเมื่อ"
  from public.month_settings
 where auto_fill_at is not null
 order by year_be, month;
