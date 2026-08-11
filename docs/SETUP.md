# คู่มือติดตั้งระบบ

ทำตามลำดับ 6 ขั้น ใช้เวลารวมประมาณ 20–30 นาที ทำครั้งเดียวจบ

---

## ขั้นที่ 1 — สร้างโปรเจกต์ Supabase (ฐานข้อมูล)

1. สมัคร/เข้าสู่ระบบที่ <https://supabase.com> (ใช้บัญชี GitHub ได้)
2. กด **New project**
   - Name: `duty-roster`
   - Database Password: ตั้งรหัสยาวๆ แล้ว**เก็บไว้ให้ดี**
   - Region: `Southeast Asia (Singapore)` — ใกล้ไทยที่สุด
3. รอสร้างเสร็จประมาณ 2 นาที

> แพ็กเกจฟรีพอสำหรับหน่วยงานขนาดนี้อย่างสบาย (500 MB, 50,000 ผู้ใช้/เดือน)

---

## ขั้นที่ 2 — สร้างตารางฐานข้อมูล

ไปที่เมนู **SQL Editor** ในโปรเจกต์ Supabase แล้วรันไฟล์ **ตามลำดับนี้เท่านั้น**
(เปิดไฟล์จากโฟลเดอร์ `supabase/` คัดลอกเนื้อหาทั้งหมด วางแล้วกด Run)

| ลำดับ | ไฟล์ | ทำอะไร |
|---|---|---|
| 1 | `supabase/01_schema.sql` | สร้างตาราง ดัชนี และ trigger |
| 2 | `supabase/02_rls.sql` | ตั้งกฎความปลอดภัยระดับแถว (**ห้ามข้าม**) |
| 3 | `supabase/03_functions.sql` | ฟังก์ชันจองเวร / อนุมัติ / แลกเวร |
| 4 | `supabase/04_seed.sql` | ใส่รายชื่อพยาบาลและเวรเดิม |

### ไฟล์ `04_seed.sql` ยังไม่มี?

ไฟล์นี้ไม่ได้ commit ขึ้น repo เพราะมีชื่อ-นามสกุลเจ้าหน้าที่ สร้างเองด้วยคำสั่งเดียว:

```bash
python3 scripts/generate-seed.py "ตารางเวรตรวจการ ปี 2568.xlsx"
```

รองรับไฟล์ Excel รูปแบบเดิมทุกไฟล์ (อ่านเดือน/ปีจากหัวตารางเอง)

---

## ขั้นที่ 3 — ปิดการสมัครสมาชิกเอง

**สำคัญมากด้านความปลอดภัย** — ถ้าไม่ปิด ใครก็สมัครบัญชีเข้าระบบได้

1. ไปที่ **Authentication → Sign In / Providers → Email**
2. ปิด **Enable email signup** (หรือ **Allow new users to sign up** ในบางเวอร์ชัน)
3. ปิด **Confirm email** ด้วย เพราะระบบใช้อีเมลแฝงที่ส่งจริงไม่ได้
4. กด Save

---

## ขั้นที่ 4 — สร้างบัญชีให้พยาบาลทุกคน

จากเครื่องของคุณ (ต้องมี Node.js 18 ขึ้นไป):

```bash
npm install @supabase/supabase-js

export SUPABASE_URL="https://xxxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ...."     # Project Settings → API → service_role
export AUTH_EMAIL_DOMAIN="duty.example.com"    # ใช้ค่านี้ให้ตรงกับ env.js
export DEFAULT_PIN="112233"                    # PIN ตั้งต้น อย่างน้อย 6 หลัก

node scripts/provision-users.mjs               # ดูก่อนว่าจะทำอะไร
node scripts/provision-users.mjs --apply       # ลงมือจริง
```

> ⚠️ `service_role key` มีสิทธิ์เต็มฐานข้อมูล — ใช้บนเครื่องตัวเองเท่านั้น
> ห้าม commit และห้ามใส่ในไฟล์ที่ deploy ขึ้นเว็บ

**รีเซ็ต PIN ให้คนที่ลืม:**

```bash
node scripts/provision-users.mjs --apply --reset-pin benja
```

---

## ขั้นที่ 5 — ตั้งค่าให้เว็บเชื่อมฐานข้อมูล

แก้ไฟล์ `assets/js/env.js`:

```js
window.__DUTY_CONFIG__ = {
  supabaseUrl: 'https://xxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGci...',      // Project Settings → API → anon public
  authEmailDomain: 'duty.example.com',  // ต้องตรงกับตอนสร้างบัญชี
};
```

> `anon key` เป็นคีย์สาธารณะโดยการออกแบบ ปลอดภัยที่จะ commit
> ความปลอดภัยทั้งหมดอยู่ที่กฎ RLS ใน `02_rls.sql` — **อย่าปิด RLS เด็ดขาด**

---

## ขั้นที่ 6 — ตั้งหัวหน้าเวรคนแรก

หัวหน้าคนแรกต้องตั้งผ่าน SQL (หลังจากนั้นตั้งคนอื่นผ่านหน้า "ตั้งค่า" ได้เลย)
เปิด **SQL Editor** แล้วรัน โดยเปลี่ยนชื่อเป็นชื่อจริง:

```sql
update public.nurses
   set is_admin = true
 where full_name = 'นางสาวเบ็ญจา นิ่มนวล';
```

---

## เผยแพร่ขึ้น GitHub Pages

1. ไปที่ repo บน GitHub → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / โฟลเดอร์ `/ (root)` → Save
4. รอ 1–2 นาที เว็บจะขึ้นที่ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ-repo>/`

---

## ตรวจก่อนเปิดใช้จริง

- [ ] เข้าสู่ระบบด้วย PIN ตั้งต้นได้ และระบบบังคับให้เปลี่ยน PIN
- [ ] จองเวรวันว่างได้ สถานะขึ้น "รออนุมัติ"
- [ ] เปิดอีกเครื่อง/อีกเบราว์เซอร์แล้วเห็นการจองนั้นทันที
- [ ] จองวันที่มีคนจองแล้วไม่ได้ (ขึ้นข้อความว่าถูกจองไปแล้ว)
- [ ] หัวหน้าเข้าหน้า "อนุมัติเวร" แล้วอนุมัติได้
- [ ] พยาบาลธรรมดาเปิด `approve.html` ตรงๆ แล้วถูกเด้งกลับหน้าปฏิทิน
- [ ] หน้า "พิมพ์เอกสาร" กด Ctrl/Cmd + P แล้วได้เอกสาร A4 เหมือนต้นฉบับ
- [ ] เปิดบนมือถือแล้วใช้งานได้ ไม่มีการเลื่อนซ้าย-ขวา

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| หน้าเว็บขึ้น "ยังไม่ได้ตั้งค่าระบบ" | ยังไม่ได้กรอก `assets/js/env.js` (ขั้นที่ 5) |
| ล็อกอินขึ้น "รหัส PIN ไม่ถูกต้อง" ทั้งที่ถูก | `authEmailDomain` ใน `env.js` ไม่ตรงกับตอนรัน provision-users |
| ล็อกอินขึ้น "Email logins are disabled" | เปิด Email provider ใน Authentication → Providers |
| หน้าล็อกอินไม่มีรายชื่อ | ยังไม่ได้รัน `04_seed.sql` หรือลืมรัน `02_rls.sql` (ต้อง grant view) |
| จองเวรแล้วขึ้น "คุณไม่มีสิทธิ์ทำรายการนี้" | บัญชี auth ยังไม่ผูกกับแถวใน `nurses` — รัน `provision-users.mjs --apply` อีกครั้ง |
| เปิดเว็บ 7 วันแล้วใช้ไม่ได้ | โปรเจกต์ Supabase ฟรีถูกพักเมื่อไม่มีการใช้งาน — เข้า dashboard กด Restore |
| พิมพ์แล้วแถบเทาไม่ออก | ในกล่องพิมพ์ของเบราว์เซอร์ ติ๊ก **Background graphics** |
