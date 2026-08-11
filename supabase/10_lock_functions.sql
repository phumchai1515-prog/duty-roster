-- ============================================================
-- ปิดสิทธิ์เรียกฟังก์ชันจากผู้ที่ยังไม่ล็อกอิน
--
-- PostgreSQL ให้สิทธิ์ EXECUTE กับ PUBLIC เป็นค่าเริ่มต้น
-- การเขียน `grant execute ... to authenticated` เพียงอย่างเดียว
-- จึงไม่ได้ปิดกั้น anon — ต้อง revoke จาก public ก่อนเสมอ
--
-- ที่ตรวจพบจริง: month_booking_status เรียกได้โดยไม่ล็อกอิน
-- และคืนรายชื่อผู้ที่ยังไม่จองเวรออกมา = ข้อมูลบุคคลรั่ว
--
-- รันหลัง 09_auto_fill.sql
-- ============================================================

set search_path = public, extensions;

-- ---------- ฟังก์ชันที่ต้องล็อกอินก่อนเรียก ----------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.month_setting(integer, integer)',
    'public.month_booking_status(integer, integer)',
    'public.default_shift_quota(integer)',
    'public.current_nurse_id()',
    'public.is_admin()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------- ฟังก์ชันที่มีการ์ดในตัว แต่ก็ไม่ควรให้ anon เรียกได้ ----------
-- ทุกตัวตรวจสิทธิ์ในตัวอยู่แล้ว (is_admin / current_nurse_id) แต่ปิดตั้งแต่ประตูดีกว่า
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.book_shift(date, shift_slot[], text)',
    'public.book_off_day(date, text)',
    'public.respond_swap(uuid, boolean)',
    'public.mark_pin_changed()',
    'public.auto_fill_month(integer, integer)',
    'public.admin_create_nurse(text, text, text, text, text, boolean)',
    'public.admin_reset_pin(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------- ฟังก์ชันภายในล้วน ไม่ให้ client เรียกเลย ----------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public._auto_fill_month(integer, integer)',
    'public.run_due_auto_fills()',
    'public.touch_updated_at()',
    'public.log_shift_change()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- ---------- ตรวจผล: ต้องไม่มีแถวไหนที่ anon เรียกได้ ----------
select p.proname as "ฟังก์ชัน",
       has_function_privilege('anon', p.oid, 'execute')          as "anon เรียกได้",
       has_function_privilege('authenticated', p.oid, 'execute') as "ผู้ล็อกอินเรียกได้"
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('month_setting','month_booking_status','default_shift_quota',
                     'current_nurse_id','is_admin','_auto_fill_month','run_due_auto_fills',
                     'auto_fill_month','book_shift','book_off_day','respond_swap',
                     'admin_create_nurse','admin_reset_pin','mark_pin_changed')
 order by 2 desc, 1;
