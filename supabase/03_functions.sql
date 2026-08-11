-- ============================================================
-- RPC — งานที่ต้องตรวจกติกาหลายชั้น ทำผ่านฟังก์ชันแทนการ update ตรง
-- เพื่อไม่ต้องเปิดสิทธิ์เขียนคอลัมน์อ่อนไหวให้ client
-- รันหลัง 02_rls.sql
-- ============================================================

-- ---------- ล้างธง "ต้องเปลี่ยน PIN" หลังเปลี่ยน PIN สำเร็จ ----------
-- เปิดเป็น RPC เพราะถ้าให้ update ตาราง nurses ตรงๆ
-- ผู้ใช้จะแก้ is_admin ของตัวเองได้ด้วย
create or replace function public.mark_pin_changed()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.nurses
     set must_change_pin = false
   where auth_user_id = auth.uid();
end $$;

revoke all on function public.mark_pin_changed() from public;
grant execute on function public.mark_pin_changed() to authenticated;


-- ---------- จองเวร (บ่าย+ดึกพร้อมกัน) ----------
-- คืนจำนวนช่วงเวลาที่จองสำเร็จ ถ้าชนกับคนอื่นจะ rollback ทั้งชุด
create or replace function public.book_shift(
  p_duty_date date,
  p_slots     shift_slot[],
  p_note      text default null
)
returns setof public.shifts
language plpgsql security invoker set search_path = public
as $$
declare
  v_nurse uuid := public.current_nurse_id();
  v_slot  shift_slot;
begin
  if v_nurse is null then
    raise exception 'ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;

  if array_length(p_slots, 1) is null then
    raise exception 'ไม่ได้ระบุช่วงเวลาเวร' using errcode = '22023';
  end if;

  foreach v_slot in array p_slots loop
    return query
      insert into public.shifts (duty_date, slot, nurse_id, status, note, booked_by)
      values (p_duty_date, v_slot, v_nurse, 'pending', p_note, v_nurse)
      returning *;
  end loop;
end $$;

revoke all on function public.book_shift(date, shift_slot[], text) from public;
grant execute on function public.book_shift(date, shift_slot[], text) to authenticated;


-- ---------- ตอบรับ / ปฏิเสธคำขอแลกเวร ----------
-- ถ้าตอบรับ ให้ย้ายเจ้าของเวรไปเป็นผู้รับ และรีเซ็ตสถานะกลับเป็นรออนุมัติ
create or replace function public.respond_swap(
  p_request_id uuid,
  p_accept     boolean
)
returns public.swap_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_nurse   uuid := public.current_nurse_id();
  v_request public.swap_requests;
begin
  select * into v_request from public.swap_requests where id = p_request_id for update;

  if v_request.id is null then
    raise exception 'ไม่พบคำขอแลกเวรนี้' using errcode = 'P0002';
  end if;
  if v_request.to_nurse_id <> v_nurse then
    raise exception 'คุณไม่ใช่ผู้ถูกขอแลกเวรนี้' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'คำขอนี้ถูกตอบไปแล้ว' using errcode = '22023';
  end if;

  update public.swap_requests
     set status = case when p_accept then 'accepted' else 'declined' end::swap_status,
         responded_at = now()
   where id = p_request_id
   returning * into v_request;

  if p_accept then
    update public.shifts
       set nurse_id    = v_nurse,
           status      = 'pending',
           reviewed_by = null,
           reviewed_at = null,
           review_note = null
     where id = v_request.shift_id;
  end if;

  return v_request;
end $$;

revoke all on function public.respond_swap(uuid, boolean) from public;
grant execute on function public.respond_swap(uuid, boolean) to authenticated;


-- ---------- หัวหน้าอนุมัติทั้งเดือนในครั้งเดียว ----------
create or replace function public.approve_month(
  p_year  integer,   -- ปี ค.ศ.
  p_month integer
)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare
  v_admin uuid := public.current_nurse_id();
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'เฉพาะหัวหน้าเวรเท่านั้นที่อนุมัติได้' using errcode = '42501';
  end if;

  with updated as (
    update public.shifts
       set status = 'approved', reviewed_by = v_admin, reviewed_at = now()
     where status = 'pending'
       and duty_date >= make_date(p_year, p_month, 1)
       and duty_date <  (make_date(p_year, p_month, 1) + interval '1 month')
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end $$;

revoke all on function public.approve_month(integer, integer) from public;
grant execute on function public.approve_month(integer, integer) to authenticated;
