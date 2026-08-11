-- ============================================================
-- เติมเวรที่ยังว่างให้อัตโนมัติเมื่อถึงกำหนด
--
-- เกณฑ์เลือกคน เรียงตามลำดับความสำคัญ:
--   1. ข้ามคนที่แจ้ง OFF ไว้วันนั้น (เด็ดขาด)
--   2. เลือกคนที่ยังจองไม่ครบโควตาของเดือนนั้นก่อน
--   3. เลี่ยงคนที่มีเวรติดกัน (วันก่อนหน้าหรือวันถัดไป)
--   4. ถ้าเป็นวันหยุด/เสาร์-อาทิตย์ เลือกคนที่ขึ้นเวรวันแบบนี้มาน้อยที่สุด
--   5. เลือกคนที่มีเวรรวมย้อนหลังน้อยที่สุด
--
-- รันหลัง 08_quota_february.sql
-- ============================================================

set search_path = public, extensions;

-- ---------- ตั้งเวลาเติมอัตโนมัติรายเดือน ----------
alter table public.month_settings
  add column if not exists auto_fill_at   timestamptz,
  add column if not exists auto_filled_at timestamptz;

comment on column public.month_settings.auto_fill_at is
  'ถึงเวลานี้แล้ววันที่ยังว่างจะถูกเติมให้อัตโนมัติ — ว่างไว้ = ไม่เติมอัตโนมัติ';
comment on column public.month_settings.auto_filled_at is
  'เวลาที่เติมอัตโนมัติไปแล้ว ใช้กันการเติมซ้ำ';

-- ---------- ทำเครื่องหมายว่าเวรนี้ระบบจัดให้ ----------
alter table public.shifts
  add column if not exists assigned_by_system boolean not null default false;

comment on column public.shifts.assigned_by_system is
  'true = ระบบเติมให้อัตโนมัติ ไม่ใช่เจ้าตัวกดจองเอง — ต้องแสดงให้ผู้ใช้เห็นชัด';


-- ============================================================
-- ฟังก์ชันหลัก (ภายใน) — ไม่ตรวจสิทธิ์ เพราะ cron ต้องเรียกได้ด้วย
-- ============================================================
create or replace function public._auto_fill_month(
  p_year_be integer,
  p_month   integer
)
returns table (duty_date date, nurse_id uuid, full_name text, note text)
language plpgsql security definer set search_path = public
as $$
declare
  LOOKBACK_MONTHS constant integer := 3;   -- ย้อนหลังกี่เดือนตอนนับความเป็นธรรม
  v_year     integer := p_year_be - 543;
  v_start    date;
  v_end      date;
  v_lookback date;
  v_quota    integer;
  v_day      date;
  v_pick     uuid;
  v_special  boolean;
begin
  v_start    := make_date(v_year, p_month, 1);
  v_end      := (v_start + interval '1 month - 1 day')::date;
  v_lookback := (v_start - make_interval(months => LOOKBACK_MONTHS))::date;

  select coalesce(
           (select m.shift_quota from public.month_settings m
             where m.year_be = p_year_be and m.month = p_month),
           public.default_shift_quota(p_month))
    into v_quota;

  -- ไล่ทีละวันที่ยังว่าง เรียงจากวันแรกของเดือน
  for v_day in
    select gs::date
      from generate_series(v_start, v_end, interval '1 day') gs
     where not exists (
       select 1 from public.shifts s
        where s.duty_date = gs::date
          and s.slot = 'evening'
          and s.status <> 'rejected')
     order by gs
  loop
    -- วันหยุดราชการหรือเสาร์-อาทิตย์ ถือเป็น "วันพิเศษ" ต้องกระจายให้เป็นธรรม
    v_special := extract(isodow from v_day) in (6, 7)
              or exists (select 1 from public.holidays h where h.duty_date = v_day);

    select n.id into v_pick
      from public.nurses n
     where n.is_active
       -- 1) ข้ามคนที่แจ้ง OFF ไว้ (เด็ดขาด)
       and not exists (
             select 1 from public.off_days o
              where o.nurse_id = n.id and o.off_date = v_day)
       -- กันซ้ำ เผื่อมีข้อมูลแปลกปลอม
       and not exists (
             select 1 from public.shifts s
              where s.nurse_id = n.id and s.duty_date = v_day and s.status <> 'rejected')
     order by
       -- 2) คนที่ยังจองไม่ครบโควตาก่อน (false เรียงก่อน true)
       ((select count(*) from public.shifts s
          where s.nurse_id = n.id
            and s.duty_date between v_start and v_end
            and s.status <> 'rejected') >= v_quota),
       -- 3) เลี่ยงเวรติดกัน
       (exists (select 1 from public.shifts s
                 where s.nurse_id = n.id
                   and s.duty_date in (v_day - 1, v_day + 1)
                   and s.status <> 'rejected')),
       -- 4) ถ้าเป็นวันพิเศษ เลือกคนที่ขึ้นเวรวันพิเศษมาน้อยสุด
       (case when v_special then
          (select count(*) from public.shifts s
            where s.nurse_id = n.id
              and s.status <> 'rejected'
              and s.duty_date >= v_lookback
              and (extract(isodow from s.duty_date) in (6, 7)
                   or exists (select 1 from public.holidays h2 where h2.duty_date = s.duty_date)))
        else 0 end),
       -- 5) เวรรวมย้อนหลังน้อยสุด
       (select count(*) from public.shifts s
         where s.nurse_id = n.id
           and s.status <> 'rejected'
           and s.duty_date >= v_lookback),
       n.sort_order
     limit 1;

    -- ไม่มีใครว่างเลย (ทุกคนแจ้ง OFF) — ข้ามวันนี้ไป ให้หัวหน้าจัดการเอง
    continue when v_pick is null;

    insert into public.shifts (duty_date, slot, nurse_id, status, assigned_by_system, note)
    values (v_day, 'evening', v_pick, 'approved', true, 'ระบบเติมให้อัตโนมัติ');

    return query
      select v_day, v_pick, n.full_name,
             case when v_special then 'วันหยุด/สุดสัปดาห์' else 'วันธรรมดา' end
        from public.nurses n where n.id = v_pick;
  end loop;
end $$;

revoke all on function public._auto_fill_month(integer, integer) from public, anon, authenticated;


-- ============================================================
-- RPC สำหรับผู้ดูแลกดเติมเอง
-- ============================================================
create or replace function public.auto_fill_month(
  p_year_be integer,
  p_month   integer
)
returns table (duty_date date, nurse_id uuid, full_name text, note text)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น' using errcode = '42501';
  end if;
  return query select * from public._auto_fill_month(p_year_be, p_month);
end $$;

revoke all on function public.auto_fill_month(integer, integer) from public;
grant execute on function public.auto_fill_month(integer, integer) to authenticated;


-- ============================================================
-- ตัวรันตามกำหนด — เรียกโดย pg_cron
-- ============================================================
create or replace function public.run_due_auto_fills()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r     record;
  added integer;
  total integer := 0;
begin
  for r in
    select year_be, month
      from public.month_settings
     where auto_fill_at is not null
       and auto_fill_at <= now()
       and auto_filled_at is null
     order by year_be, month
  loop
    select count(*) into added from public._auto_fill_month(r.year_be, r.month);

    update public.month_settings
       set auto_filled_at = now()
     where year_be = r.year_be and month = r.month;

    insert into public.audit_log (actor_id, action, entity, detail)
    values (null, 'auto_fill', 'month_settings',
            jsonb_build_object('year_be', r.year_be, 'month', r.month, 'added', added));

    total := total + added;
  end loop;

  return total;
end $$;

revoke all on function public.run_due_auto_fills() from public, anon, authenticated;


-- ============================================================
-- สถานะการจองรายเดือน — ให้ผู้ดูแลเห็นก่อนถึงกำหนด
-- ============================================================
create or replace function public.month_booking_status(
  p_year_be integer,
  p_month   integer
)
returns table (
  total_days     integer,
  filled_days    integer,
  empty_days     integer,
  empty_list     text,
  quota          integer,
  nurses_total   integer,
  nurses_at_quota integer,
  nurses_none    integer,
  none_list      text
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select make_date(p_year_be - 543, p_month, 1) as s,
           (make_date(p_year_be - 543, p_month, 1) + interval '1 month - 1 day')::date as e
  ),
  q as (
    select coalesce(
      (select m.shift_quota from public.month_settings m
        where m.year_be = p_year_be and m.month = p_month),
      public.default_shift_quota(p_month)) as quota
  ),
  days as (
    select gs::date as d,
           exists (select 1 from public.shifts s
                    where s.duty_date = gs::date and s.slot = 'evening'
                      and s.status <> 'rejected') as filled
      from bounds, generate_series(bounds.s, bounds.e, interval '1 day') gs
  ),
  per_nurse as (
    select n.id, n.full_name,
           (select count(*) from public.shifts s, bounds
             where s.nurse_id = n.id and s.status <> 'rejected'
               and s.duty_date between bounds.s and bounds.e) as cnt
      from public.nurses n where n.is_active
  )
  select
    (select count(*)::int from days),
    (select count(*)::int from days where filled),
    (select count(*)::int from days where not filled),
    (select coalesce(string_agg(extract(day from d)::text, ', ' order by d), '')
       from days where not filled),
    (select quota from q),
    (select count(*)::int from per_nurse),
    (select count(*)::int from per_nurse, q where cnt >= q.quota),
    (select count(*)::int from per_nurse where cnt = 0),
    (select coalesce(string_agg(full_name, ', ' order by full_name), '')
       from per_nurse where cnt = 0);
$$;

grant execute on function public.month_booking_status(integer, integer) to authenticated;


-- ============================================================
-- ตั้ง pg_cron ให้ตรวจทุกชั่วโมง
-- ถ้าโปรเจกต์ยังไม่เปิด pg_cron จะข้ามไปเงียบๆ (ใช้ปุ่มกดเองแทนได้)
-- ============================================================
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('duty-auto-fill')
    where exists (select 1 from cron.job where jobname = 'duty-auto-fill');

  perform cron.schedule('duty-auto-fill', '5 * * * *',
                        $job$ select public.run_due_auto_fills(); $job$);

  raise notice 'ตั้ง pg_cron เรียบร้อย — ตรวจทุกชั่วโมงที่นาทีที่ 5';
exception when others then
  raise notice 'เปิด pg_cron ไม่ได้ (%) — ใช้ปุ่ม "เติมเวรที่ว่างเลยตอนนี้" ในหน้าผู้ดูแลแทนได้', sqlerrm;
end $$;
