#!/usr/bin/env bash
#
# setup-users.sh — สร้างบัญชีเข้าระบบให้พยาบาลทุกคน
#
# สคริปต์นี้จะถาม secret key แบบไม่แสดงบนหน้าจอ และไม่บันทึกลงไฟล์ใดๆ
# คีย์จะอยู่ในหน่วยความจำเฉพาะระหว่างที่สคริปต์ทำงานเท่านั้น
#
# ใช้:  bash scripts/setup-users.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

SUPABASE_URL="https://ogamyepqxgxjkkicmwmk.supabase.co"
AUTH_EMAIL_DOMAIN="duty.example.com"
DEFAULT_PIN="${DEFAULT_PIN:-112233}"

echo
echo "═══════════════════════════════════════════════════════"
echo "  สร้างบัญชีเข้าระบบให้พยาบาลตรวจการ"
echo "═══════════════════════════════════════════════════════"
echo
echo "ต้องใช้ secret key จาก Supabase:"
echo "  Project Settings → API Keys → หัวข้อ 'Secret keys'"
echo "  กดปุ่ม Reveal แล้วคัดลอก (ขึ้นต้นด้วย sb_secret_ หรือ eyJ...)"
echo
echo "⚠️  คีย์นี้มีสิทธิ์เต็มฐานข้อมูล — อย่าส่งให้ใคร อย่า commit"
echo

read -r -s -p "วาง secret key ที่นี่ (จะไม่แสดงบนหน้าจอ) แล้วกด Enter: " SERVICE_KEY
echo
echo

if [ -z "$SERVICE_KEY" ]; then
  echo "✗ ไม่ได้ใส่คีย์ — ยกเลิก"
  exit 1
fi

case "$SERVICE_KEY" in
  sb_publishable_*)
    echo "✗ นี่คือ publishable key ไม่ใช่ secret key — ยกเลิก"
    exit 1
    ;;
esac

# ติดตั้ง library เฉพาะครั้งแรก
if [ ! -d node_modules/@supabase/supabase-js ]; then
  echo "กำลังติดตั้ง @supabase/supabase-js (ครั้งเดียว)…"
  npm install --silent --no-fund --no-audit @supabase/supabase-js
  echo
fi

export SUPABASE_URL SERVICE_KEY AUTH_EMAIL_DOMAIN DEFAULT_PIN
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"

echo "── ขั้นที่ 1: ตรวจสอบก่อน (ยังไม่แก้อะไร) ──"
echo
node scripts/provision-users.mjs
echo

read -r -p "ดำเนินการสร้างบัญชีจริงหรือไม่? (พิมพ์ yes เพื่อยืนยัน): " CONFIRM
echo

if [ "$CONFIRM" != "yes" ]; then
  echo "ยกเลิกแล้ว ไม่มีอะไรถูกเปลี่ยน"
  exit 0
fi

echo "── ขั้นที่ 2: สร้างบัญชีจริง ──"
echo
node scripts/provision-users.mjs --apply

unset SERVICE_KEY SUPABASE_SERVICE_ROLE_KEY

echo
echo "═══════════════════════════════════════════════════════"
echo "  เสร็จแล้ว — PIN ตั้งต้นของทุกคนคือ: $DEFAULT_PIN"
echo "  ระบบจะบังคับให้เปลี่ยน PIN ตอนเข้าครั้งแรก"
echo "═══════════════════════════════════════════════════════"
echo
