-- ============================================================
-- กันโปรเจกต์ Supabase ถูกพัก
--
-- แพ็กเกจฟรีจะพักโปรเจกต์เมื่อไม่มีคำขอเข้ามา 7 วัน
-- ถ้าถูกพัก ไม่ใช่แค่เว็บใช้ไม่ได้ — pg_cron จะหยุดด้วย
-- แปลว่า "เติมเวรอัตโนมัติ" ตอนสิ้นเดือนจะไม่ทำงาน ซึ่งร้ายแรงกว่า
--
-- วิธีแก้: ให้ฐานข้อมูลยิงคำขอ HTTP หาตัวเองผ่าน pg_net วันละครั้ง
-- นับเป็นคำขอจริงเข้าโปรเจกต์ จึงไม่เข้าเกณฑ์ "ไม่มีการใช้งาน"
--
-- รันหลัง 10_lock_functions.sql
-- ============================================================

set search_path = public, extensions;

create extension if not exists pg_net;

-- URL และ publishable key เป็นค่าสาธารณะอยู่แล้ว (อยู่ในเว็บ) ไม่ใช่ความลับ
create or replace function public.keep_project_awake()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_url text := 'https://ogamyepqxgxjkkicmwmk.supabase.co/rest/v1/nurse_directory?select=id&limit=1';
  v_key text := 'sb_publishable_DUqD7tDyRPZhnaqit0-VOg_i_-G9lUk';
begin
  perform net.http_get(
    url     := v_url,
    headers := jsonb_build_object('apikey', v_key)
  );
end $$;

revoke all on function public.keep_project_awake() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('duty-keep-alive')
    where exists (select 1 from cron.job where jobname = 'duty-keep-alive');

  -- ทุกวัน 02:11 UTC = 09:11 น. เวลาไทย
  perform cron.schedule('duty-keep-alive', '11 2 * * *',
                        $job$ select public.keep_project_awake(); $job$);

  raise notice 'ตั้ง keep-alive เรียบร้อย — ปลุกโปรเจกต์ทุกวัน 09:11 น.';
exception when others then
  raise notice 'ตั้ง keep-alive ไม่ได้ (%) — ต้องเข้าเว็บอย่างน้อยสัปดาห์ละครั้งเอง', sqlerrm;
end $$;

-- ตรวจผล
select jobname as "ชื่องาน", schedule as "ตารางเวลา", active as "เปิดใช้"
  from cron.job
 where jobname in ('duty-auto-fill', 'duty-keep-alive')
 order by jobname;
