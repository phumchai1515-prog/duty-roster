-- ============================================================
-- อัปเกรดเป็นระบบจองเอง (ไม่มีขั้นหัวหน้าอนุมัติ)
-- + โควตาเวรรายเดือน + จองวัน OFF + Admin จัดการผู้ใช้ + ใบแลกเวร 2 ทาง
--
-- รันหลัง 01–04 · รันซ้ำได้ปลอดภัย
-- ============================================================

set search_path = public, extensions;

-- ---------- 1. จองแล้วมีผลทันที ----------
-- คงชนิด shift_status ไว้เพื่อไม่ให้ข้อมูลเดิมเสีย แต่ของใหม่จะเป็น approved เลย
alter table public.shifts alter column status set default 'approved';

-- เวรเดิมที่ยังค้าง "รออนุมัติ" ให้ถือว่ายืนยันแล้ว
update public.shifts set status = 'approved' where status = 'pending';

drop function if exists public.approve_month(integer, integer);


-- ---------- 2. ตั้งค่ารายเดือน (โควตา / เปิด-ปิดการจอง) ----------
create table if not exists public.month_settings (
  year_be          integer not null,
  month            integer not null check (month between 1 and 12),
  shift_quota      integer not null default 2 check (shift_quota >= 0),
  shifts_locked    boolean not null default false,   -- ปิดการจองเวรของเดือนนี้
  off_booking_open boolean not null default false,   -- เปิดให้จองวัน OFF
  note             text,
  updated_at       timestamptz not null default now(),
  primary key (year_be, month)
);

comment on column public.month_settings.shift_quota is
  'โควตาเวรต่อคนต่อเดือน — เป็นเพียงคำเตือน จองเกินได้';

-- โควตาตั้งต้น: เดือนทั่วไป 2 เวร, กุมภาพันธ์ 1 เวร
create or replace function public.default_shift_quota(p_month integer)
returns integer language sql immutable as $$
  select case when p_month = 2 then 1 else 2 end;
$$;

-- อ่านค่าตั้งค่าของเดือน ถ้ายังไม่เคยตั้งจะคืนค่าตั้งต้น
create or replace function public.month_setting(p_year_be integer, p_month integer)
returns public.month_settings
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select m from public.month_settings m
      where m.year_be = p_year_be and m.month = p_month),
    row(p_year_be, p_month, public.default_shift_quota(p_month), false, false, null, now())::public.month_settings
  );
$$;

grant execute on function public.month_setting(integer, integer) to authenticated;
grant execute on function public.default_shift_quota(integer) to authenticated;


-- ---------- 3. วัน OFF (วันที่ขึ้นเวรไม่ได้) ----------
create table if not exists public.off_days (
  id         uuid primary key default gen_random_uuid(),
  nurse_id   uuid not null references public.nurses(id) on delete cascade,
  off_date   date not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (nurse_id, off_date)
);

create index if not exists off_days_date_idx on public.off_days (off_date);

comment on table public.off_days is
  'วันที่พยาบาลแจ้งว่าขึ้นเวรไม่ได้ — กันเฉพาะเจ้าตัว ไม่กระทบคนอื่น';


-- ---------- 4. ใบแลกเวรแบบ 2 ทาง ----------
-- offer_shift_id = เวรของผู้รับแลก ที่ผู้ขอจะไปขึ้นแทนเป็นการตอบแทน
alter table public.swap_requests
  add column if not exists offer_shift_id uuid references public.shifts(id) on delete set null;

comment on column public.swap_requests.offer_shift_id is
  'เวรของผู้ถูกขอ ที่ผู้ขอจะขึ้นแทนเป็นการตอบแทน (ตามแบบฟอร์ม F-NU-005) — ว่างได้ถ้าเป็นการยกเวรให้เฉยๆ';


-- ============================================================
-- RLS ของตารางใหม่
-- ============================================================
alter table public.month_settings enable row level security;
alter table public.off_days       enable row level security;

drop policy if exists month_settings_read on public.month_settings;
create policy month_settings_read on public.month_settings
  for select to authenticated using (true);

drop policy if exists month_settings_admin on public.month_settings;
create policy month_settings_admin on public.month_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- วัน OFF: ทุกคนเห็นได้ (ปฏิทินต้องแสดงว่าใครไม่ว่าง) แต่แก้ได้เฉพาะของตัวเอง
drop policy if exists off_days_read on public.off_days;
create policy off_days_read on public.off_days
  for select to authenticated using (true);

drop policy if exists off_days_self on public.off_days;
create policy off_days_self on public.off_days
  for all to authenticated
  using (nurse_id = public.current_nurse_id())
  with check (nurse_id = public.current_nurse_id());

drop policy if exists off_days_admin on public.off_days;
create policy off_days_admin on public.off_days
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ============================================================
-- RLS ของ shifts — ปรับให้จองแล้วมีผลทันที
-- ============================================================

-- จองได้เฉพาะเวรของตัวเอง ในวันที่ยังไม่ผ่านมา และเดือนนั้นต้องไม่ถูกล็อก
drop policy if exists shifts_self_insert on public.shifts;
create policy shifts_self_insert on public.shifts
  for insert to authenticated
  with check (
    nurse_id = public.current_nurse_id()
    and duty_date >= (now() at time zone 'Asia/Bangkok')::date
  );

-- ยกเลิกเวรของตัวเองได้ ตราบใดที่ยังไม่ถึงวัน
drop policy if exists shifts_self_delete on public.shifts;
create policy shifts_self_delete on public.shifts
  for delete to authenticated
  using (
    nurse_id = public.current_nurse_id()
    and duty_date >= (now() at time zone 'Asia/Bangkok')::date
  );

drop policy if exists shifts_self_update on public.shifts;
create policy shifts_self_update on public.shifts
  for update to authenticated
  using (nurse_id = public.current_nurse_id())
  with check (nurse_id = public.current_nurse_id());


-- ============================================================
-- ฟังก์ชันจองเวร (แทนของเดิม)
-- ============================================================
create or replace function public.book_shift(
  p_duty_date date,
  p_slots     shift_slot[],
  p_note      text default null
)
returns setof public.shifts
language plpgsql security invoker set search_path = public
as $$
declare
  v_nurse   uuid := public.current_nurse_id();
  v_slot    shift_slot;
  v_setting public.month_settings;
begin
  if v_nurse is null then
    raise exception 'ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;

  if array_length(p_slots, 1) is null then
    raise exception 'ไม่ได้ระบุช่วงเวลาเวร' using errcode = '22023';
  end if;

  -- เดือนนี้ถูกปิดการจองหรือยัง
  v_setting := public.month_setting(
    extract(year from p_duty_date)::integer + 543,
    extract(month from p_duty_date)::integer
  );
  if v_setting.shifts_locked and not public.is_admin() then
    raise exception 'เดือนนี้ปิดการจองแล้ว กรุณาติดต่อผู้ดูแลระบบ' using errcode = '22023';
  end if;

  -- แจ้ง OFF ไว้แล้วจะจองเวรวันเดียวกันไม่ได้
  if exists (
    select 1 from public.off_days o
     where o.nurse_id = v_nurse and o.off_date = p_duty_date
  ) then
    raise exception 'คุณแจ้ง OFF ไว้ในวันนี้ กรุณายกเลิกวัน OFF ก่อนจองเวร' using errcode = '22023';
  end if;

  foreach v_slot in array p_slots loop
    return query
      insert into public.shifts (duty_date, slot, nurse_id, status, note, booked_by)
      values (p_duty_date, v_slot, v_nurse, 'approved', p_note, v_nurse)
      returning *;
  end loop;
end $$;

revoke all on function public.book_shift(date, shift_slot[], text) from public;
grant execute on function public.book_shift(date, shift_slot[], text) to authenticated;


-- ---------- แจ้งวัน OFF ----------
create or replace function public.book_off_day(
  p_off_date date,
  p_reason   text default null
)
returns public.off_days
language plpgsql security invoker set search_path = public
as $$
declare
  v_nurse   uuid := public.current_nurse_id();
  v_setting public.month_settings;
  v_row     public.off_days;
begin
  if v_nurse is null then
    raise exception 'ไม่พบข้อมูลผู้ใช้ กรุณาเข้าสู่ระบบใหม่' using errcode = '42501';
  end if;

  v_setting := public.month_setting(
    extract(year from p_off_date)::integer + 543,
    extract(month from p_off_date)::integer
  );
  if not v_setting.off_booking_open and not public.is_admin() then
    raise exception 'ยังไม่เปิดให้จองวัน OFF ของเดือนนี้' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.shifts s
     where s.nurse_id = v_nurse and s.duty_date = p_off_date and s.status <> 'rejected'
  ) then
    raise exception 'คุณจองเวรไว้ในวันนี้แล้ว กรุณายกเลิกเวรก่อนแจ้ง OFF' using errcode = '22023';
  end if;

  insert into public.off_days (nurse_id, off_date, reason)
  values (v_nurse, p_off_date, p_reason)
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.book_off_day(date, text) from public;
grant execute on function public.book_off_day(date, text) to authenticated;


-- ============================================================
-- ตอบรับคำขอแลกเวร — รองรับการแลกแบบ 2 ทาง
-- ============================================================
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
    -- เวรของผู้ขอ → โอนให้ผู้รับ
    update public.shifts
       set nurse_id = v_nurse
     where id = v_request.shift_id;

    -- ถ้าเป็นการแลกแบบ 2 ทาง เวรของผู้รับ → โอนกลับให้ผู้ขอ
    if v_request.offer_shift_id is not null then
      update public.shifts
         set nurse_id = v_request.from_nurse_id
       where id = v_request.offer_shift_id;
    end if;
  end if;

  return v_request;
end $$;

revoke all on function public.respond_swap(uuid, boolean) from public;
grant execute on function public.respond_swap(uuid, boolean) to authenticated;


-- ============================================================
-- Admin: เพิ่มพยาบาล + สร้างบัญชีเข้าระบบในคราวเดียว
-- ============================================================
create or replace function public.admin_create_nurse(
  p_prefix     text,
  p_first_name text,
  p_last_name  text,
  p_slug       text,
  p_pin        text,
  p_is_admin   boolean default false
)
returns public.nurses
language plpgsql security definer set search_path = public, extensions, auth
as $$
declare
  v_email text;
  v_user  uuid;
  v_row   public.nurses;
  v_order integer;
begin
  if not public.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น' using errcode = '42501';
  end if;

  p_slug := lower(trim(p_slug));
  if p_slug !~ '^[a-z][a-z0-9]{2,29}$' then
    raise exception 'รหัสผู้ใช้ต้องเป็นตัวอักษรอังกฤษพิมพ์เล็ก/ตัวเลข 3-30 ตัว และขึ้นต้นด้วยตัวอักษร'
      using errcode = '22023';
  end if;
  if p_pin !~ '^\d{6,}$' then
    raise exception 'PIN ต้องเป็นตัวเลขอย่างน้อย 6 หลัก' using errcode = '22023';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_last_name), '') = '' then
    raise exception 'ต้องกรอกชื่อและนามสกุล' using errcode = '22023';
  end if;

  v_email := p_slug || '@duty.example.com';

  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'รหัสผู้ใช้ "%" ถูกใช้ไปแล้ว', p_slug using errcode = '23505';
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_order from public.nurses;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid(),
    'authenticated', 'authenticated', v_email,
    crypt(p_pin, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('slug', p_slug),
    '', '', '', ''
  )
  returning id into v_user;

  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  values (
    v_user::text, v_user,
    jsonb_build_object('sub', v_user::text, 'email', v_email,
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  insert into public.nurses (
    auth_user_id, slug, prefix, first_name, last_name,
    is_admin, must_change_pin, sort_order
  )
  values (
    v_user, p_slug, coalesce(p_prefix, ''), trim(p_first_name), trim(p_last_name),
    coalesce(p_is_admin, false), true, v_order
  )
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.admin_create_nurse(text, text, text, text, text, boolean) from public;
grant execute on function public.admin_create_nurse(text, text, text, text, text, boolean) to authenticated;


-- ---------- Admin: รีเซ็ต PIN ----------
create or replace function public.admin_reset_pin(
  p_nurse_id uuid,
  p_pin      text
)
returns void
language plpgsql security definer set search_path = public, extensions, auth
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น' using errcode = '42501';
  end if;
  if p_pin !~ '^\d{6,}$' then
    raise exception 'PIN ต้องเป็นตัวเลขอย่างน้อย 6 หลัก' using errcode = '22023';
  end if;

  select auth_user_id into v_user from public.nurses where id = p_nurse_id;
  if v_user is null then
    raise exception 'ไม่พบบัญชีเข้าระบบของพยาบาลคนนี้' using errcode = 'P0002';
  end if;

  update auth.users
     set encrypted_password = crypt(p_pin, gen_salt('bf')), updated_at = now()
   where id = v_user;

  update public.nurses set must_change_pin = true where id = p_nurse_id;
end $$;

revoke all on function public.admin_reset_pin(uuid, text) from public;
grant execute on function public.admin_reset_pin(uuid, text) to authenticated;


-- ---------- เปิด Realtime ให้ตารางใหม่ ----------
do $$ begin
  alter publication supabase_realtime add table public.off_days;
exception when duplicate_object then null; end $$;
