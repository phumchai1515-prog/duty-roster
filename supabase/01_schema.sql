-- ============================================================
-- ระบบจองเวรตรวจการ — โครงสร้างฐานข้อมูล
-- รันไฟล์นี้เป็นไฟล์แรกใน Supabase SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ชนิดข้อมูล ----------
do $$ begin
  create type shift_slot as enum ('day', 'evening', 'night');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shift_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type swap_status as enum ('pending', 'accepted', 'declined', 'cancelled');
exception when duplicate_object then null; end $$;


-- ---------- พยาบาลตรวจการ ----------
create table if not exists public.nurses (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  slug            text not null unique,        -- ใช้สร้างอีเมลแฝงตอนล็อกอิน
  prefix          text not null default '',    -- นาย / นาง / นางสาว
  first_name      text not null,
  last_name       text not null,
  full_name       text generated always as (prefix || first_name || ' ' || last_name) stored,
  is_admin        boolean not null default false,
  is_active       boolean not null default true,
  must_change_pin boolean not null default true,
  sort_order      integer not null default 100,
  created_at      timestamptz not null default now()
);

comment on column public.nurses.slug is 'ตัวสะกดอังกฤษ ใช้ประกอบอีเมลแฝงสำหรับ Supabase Auth ผู้ใช้ไม่เห็น';

-- มุมมองสาธารณะสำหรับหน้าล็อกอิน — เปิดเฉพาะชื่อที่ปรากฏบนเอกสารราชการอยู่แล้ว
create or replace view public.nurse_directory
with (security_invoker = off) as
  select id, slug, full_name, sort_order
  from public.nurses
  where is_active;


-- ---------- วันหยุดราชการ ----------
create table if not exists public.holidays (
  duty_date  date primary key,
  name       text not null,
  created_at timestamptz not null default now()
);


-- ---------- เวร ----------
create table if not exists public.shifts (
  id           uuid primary key default gen_random_uuid(),
  duty_date    date not null,
  slot         shift_slot not null,
  nurse_id     uuid not null references public.nurses(id) on delete restrict,
  status       shift_status not null default 'pending',
  note         text,
  booked_by    uuid references public.nurses(id) on delete set null,
  reviewed_by  uuid references public.nurses(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- หนึ่งวัน หนึ่งช่วงเวลา มีคนเดียว — ยกเว้นแถวที่ถูกปฏิเสธไปแล้ว
-- บังคับที่ระดับฐานข้อมูล จึงกันการจองชนกันได้แม้กดพร้อมกัน
create unique index if not exists shifts_unique_active_slot
  on public.shifts (duty_date, slot)
  where status <> 'rejected';

create index if not exists shifts_nurse_date_idx on public.shifts (nurse_id, duty_date desc);
create index if not exists shifts_date_idx       on public.shifts (duty_date);
create index if not exists shifts_status_idx     on public.shifts (status) where status = 'pending';


-- ---------- คำขอแลกเวร ----------
create table if not exists public.swap_requests (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts(id) on delete cascade,
  from_nurse_id  uuid not null references public.nurses(id) on delete cascade,
  to_nurse_id    uuid not null references public.nurses(id) on delete cascade,
  reason         text,
  status         swap_status not null default 'pending',
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint swap_different_nurses check (from_nurse_id <> to_nurse_id)
);

create index if not exists swap_to_nurse_idx on public.swap_requests (to_nurse_id) where status = 'pending';
create unique index if not exists swap_one_open_per_shift
  on public.swap_requests (shift_id) where status = 'pending';


-- ---------- หัวเอกสารราชการ (ต่อเดือน) ----------
create table if not exists public.order_meta (
  id                uuid primary key default gen_random_uuid(),
  year_be           integer not null,
  month             integer not null check (month between 1 and 12),
  organization_name text not null default 'โรงพยาบาลจิตเวชเลยราชนครินทร์',
  order_no          text,
  signer_name       text,
  signer_position   text,
  updated_at        timestamptz not null default now(),
  unique (year_be, month)
);


-- ---------- บันทึกการใช้งาน ----------
create table if not exists public.audit_log (
  id         bigserial primary key,
  actor_id   uuid references public.nurses(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx on public.audit_log (created_at desc);


-- ---------- ฟังก์ชันช่วย ----------

-- id ของพยาบาลที่ล็อกอินอยู่
create or replace function public.current_nurse_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.nurses where auth_user_id = auth.uid() and is_active limit 1;
$$;

-- ผู้ล็อกอินเป็นหัวหน้าหรือไม่
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select is_admin from public.nurses where auth_user_id = auth.uid() and is_active limit 1),
    false
  );
$$;

-- อัปเดต updated_at อัตโนมัติ
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists shifts_touch on public.shifts;
create trigger shifts_touch before update on public.shifts
  for each row execute function public.touch_updated_at();


-- บันทึก audit ทุกครั้งที่เวรเปลี่ยนสถานะ
create or replace function public.log_shift_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    public.current_nurse_id(),
    lower(tg_op),
    'shift',
    coalesce(new.id, old.id),
    jsonb_build_object(
      'duty_date', coalesce(new.duty_date, old.duty_date),
      'slot',      coalesce(new.slot, old.slot),
      'nurse_id',  coalesce(new.nurse_id, old.nurse_id),
      'from',      old.status,
      'to',        new.status
    )
  );
  return coalesce(new, old);
end $$;

drop trigger if exists shifts_audit on public.shifts;
create trigger shifts_audit after insert or update or delete on public.shifts
  for each row execute function public.log_shift_change();


-- เปิด Realtime ให้หน้าปฏิทินเห็นการจองของคนอื่นทันที
do $$ begin
  alter publication supabase_realtime add table public.shifts;
exception when duplicate_object then null; end $$;
