-- ============================================================
-- Row Level Security — ความปลอดภัยทั้งหมดของระบบอยู่ที่ไฟล์นี้
-- anon key เปิดเผยต่อสาธารณะ ดังนั้นทุกตารางต้องเปิด RLS เสมอ
-- รันหลัง 01_schema.sql
-- ============================================================

alter table public.nurses        enable row level security;
alter table public.holidays      enable row level security;
alter table public.shifts        enable row level security;
alter table public.swap_requests enable row level security;
alter table public.order_meta    enable row level security;
alter table public.audit_log     enable row level security;


-- ---------- รายชื่อสำหรับหน้าล็อกอิน ----------
-- เปิดให้ยังไม่ล็อกอินก็อ่านได้ เพราะเป็นชื่อที่ปรากฏบนเอกสารราชการอยู่แล้ว
-- และเปิดเฉพาะ id / slug / ชื่อ ไม่มีข้อมูลอ่อนไหวอื่น
grant select on public.nurse_directory to anon, authenticated;


-- ---------- nurses ----------
drop policy if exists nurses_read on public.nurses;
create policy nurses_read on public.nurses
  for select to authenticated
  using (true);

-- ตั้งใจไม่มี policy ให้พยาบาลแก้แถวตัวเอง
-- ถ้าเปิดให้แก้ จะแก้ is_admin ของตัวเองเป็น true ได้ (ยกระดับสิทธิ์)
-- การล้างธง must_change_pin ทำผ่าน RPC public.mark_pin_changed() แทน
drop policy if exists nurses_self_update on public.nurses;

drop policy if exists nurses_admin_write on public.nurses;
create policy nurses_admin_write on public.nurses
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---------- holidays ----------
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays
  for select to authenticated using (true);

drop policy if exists holidays_admin_write on public.holidays;
create policy holidays_admin_write on public.holidays
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------- shifts ----------
-- ทุกคนเห็นตารางเวรทั้งหมด (จำเป็น เพราะต้องรู้ว่าวันไหนว่าง)
drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts
  for select to authenticated using (true);

-- จองได้เฉพาะเวรของตัวเอง และต้องเริ่มที่สถานะ "รออนุมัติ" เท่านั้น
drop policy if exists shifts_self_insert on public.shifts;
create policy shifts_self_insert on public.shifts
  for insert to authenticated
  with check (
    nurse_id = public.current_nurse_id()
    and status = 'pending'
    and duty_date >= current_date
  );

-- แก้ไขได้เฉพาะเวรตัวเองที่ยังไม่ถูกอนุมัติ และห้ามเปลี่ยนสถานะเอง
drop policy if exists shifts_self_update on public.shifts;
create policy shifts_self_update on public.shifts
  for update to authenticated
  using (nurse_id = public.current_nurse_id() and status = 'pending')
  with check (nurse_id = public.current_nurse_id() and status = 'pending');

-- ยกเลิกได้เฉพาะเวรตัวเองที่ยังรออนุมัติ — เวรที่อนุมัติแล้วต้องให้หัวหน้าจัดการ
drop policy if exists shifts_self_delete on public.shifts;
create policy shifts_self_delete on public.shifts
  for delete to authenticated
  using (nurse_id = public.current_nurse_id() and status = 'pending');

-- หัวหน้าทำได้ทุกอย่าง
drop policy if exists shifts_admin_all on public.shifts;
create policy shifts_admin_all on public.shifts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------- swap_requests ----------
drop policy if exists swaps_read on public.swap_requests;
create policy swaps_read on public.swap_requests
  for select to authenticated
  using (
    from_nurse_id = public.current_nurse_id()
    or to_nurse_id = public.current_nurse_id()
    or public.is_admin()
  );

drop policy if exists swaps_create on public.swap_requests;
create policy swaps_create on public.swap_requests
  for insert to authenticated
  with check (
    from_nurse_id = public.current_nurse_id()
    and exists (
      select 1 from public.shifts s
      where s.id = shift_id and s.nurse_id = public.current_nurse_id()
    )
  );

-- ผู้ถูกขอเป็นคนตอบรับ/ปฏิเสธ ผู้ขอยกเลิกคำขอตัวเองได้
drop policy if exists swaps_respond on public.swap_requests;
create policy swaps_respond on public.swap_requests
  for update to authenticated
  using (to_nurse_id = public.current_nurse_id() or from_nurse_id = public.current_nurse_id())
  with check (to_nurse_id = public.current_nurse_id() or from_nurse_id = public.current_nurse_id());

drop policy if exists swaps_admin_all on public.swap_requests;
create policy swaps_admin_all on public.swap_requests
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------- order_meta ----------
drop policy if exists order_meta_read on public.order_meta;
create policy order_meta_read on public.order_meta
  for select to authenticated using (true);

drop policy if exists order_meta_admin_write on public.order_meta;
create policy order_meta_admin_write on public.order_meta
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ---------- audit_log ----------
-- อ่านได้เฉพาะหัวหน้า เขียนได้เฉพาะ trigger (security definer) เท่านั้น
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());
