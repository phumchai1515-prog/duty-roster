-- ============================================================
-- แก้โควตาเดือนกุมภาพันธ์จาก 1 เป็น 2 เวร
--
-- เหตุผล: มีผู้ขึ้นเวร 18 คน — โควตา 1 ให้ที่นั่งรวมแค่ 18 เวร
--         แต่กุมภาพันธ์มี 28 วัน จึงขาดผู้ปฏิบัติงาน 10 วัน
--         โควตา 2 ให้ 36 ที่นั่ง ครอบคลุม 28 วันได้พอดี
--         (10 คนได้ 2 เวร · 8 คนได้ 1 เวร)
--
-- รันหลัง 07_selfservice.sql
-- ============================================================

set search_path = public, extensions;

create or replace function public.default_shift_quota(p_month integer)
returns integer language sql immutable as $$
  select 2;
$$;

-- เดือนกุมภาพันธ์ที่เคยตั้งค่าไว้แล้วด้วยโควตาเดิม ให้ปรับตาม
update public.month_settings
   set shift_quota = 2, updated_at = now()
 where month = 2 and shift_quota = 1;

select month as เดือน, year_be as "ปี พ.ศ.", shift_quota as โควตา
  from public.month_settings
 where month = 2;
