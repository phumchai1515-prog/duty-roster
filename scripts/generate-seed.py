#!/usr/bin/env python3
"""
แปลงไฟล์ตารางเวร .xlsx ของเดิม เป็น supabase/04_seed.sql

ใช้:  python3 scripts/generate-seed.py "ตารางเวรตรวจการ ปี 2568.xlsx"

อ่านทุก sheet ที่หัวตารางขึ้นต้นด้วย "ตารางเวรปฏิบัติงาน..." แล้วดึง
คอลัมน์ A=วัน B=วันที่ C=เวรเช้า D=เวรบ่าย E=เวรดึก F=หมายเหตุ
ตั้งแต่แถวที่ 5 เป็นต้นไป โดยไม่พึ่ง library ภายนอก (อ่าน XML ตรงจาก .xlsx)
"""
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
FIRST_DATA_ROW = 5
MAX_DATA_ROW = 60

MONTHS_TH = {
    'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4,
    'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8,
    'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12,
}
THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
PREFIXES = ('นางสาว', 'นาง', 'นาย')
SLOT_COLUMNS = {'C': 'day', 'D': 'evening', 'E': 'night'}

# ตัวสะกดอังกฤษของชื่อต้น ใช้ทำ slug สำหรับอีเมลแฝงตอนล็อกอิน
# ชื่อที่ไม่อยู่ในนี้จะถูกตั้ง slug เป็น nurseNN แทน แล้วแก้ทีหลังได้
NAME_SLUGS = {
    'กัญญาภัทร': 'kanyapat', 'จรินทร์ยา': 'jarinya', 'จันจิลา': 'janjila',
    'ฉลองรัตน์': 'chalongrat', 'รัตนา': 'rattana', 'กรรณิการ์': 'kannika',
    'ณัฏฐพัชร': 'natthaphat', 'ปาณิสรา': 'panisara', 'สมจินตนา': 'somjintana',
    'เบ็ญจา': 'benja', 'สุนันทา': 'sunantha', 'เพ็ญสุดา': 'phensuda',
    'ชาญชัย': 'chanchai', 'ณรงค์': 'narong', 'นพพร': 'nopporn',
    'วิรัช': 'wirat', 'สงคราม': 'songkram', 'อดิศักดิ์': 'adisak',
    'มนันญา': 'manunya', 'เยาวลักษณ์': 'yaowaluk',
}


def thai_to_arabic(text):
    return ''.join(str(THAI_DIGITS.index(ch)) if ch in THAI_DIGITS else ch for ch in text)


def sql_quote(value):
    if value is None:
        return 'null'
    return "'" + str(value).replace("'", "''") + "'"


def read_shared_strings(archive):
    root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
    return [''.join(t.text or '' for t in si.iter(NS + 't')) for si in root.iter(NS + 'si')]


def read_cells(archive, path, shared):
    """คืน dict {'A1': 'ค่า'} เฉพาะเซลล์ที่มีข้อมูล"""
    root = ET.fromstring(archive.read(path))
    cells = {}
    for cell in root.iter(NS + 'c'):
        value_node = cell.find(NS + 'v')
        if value_node is None or value_node.text is None:
            continue
        raw = shared[int(value_node.text)] if cell.get('t') == 's' else value_node.text
        text = str(raw).strip()
        if text:
            cells[cell.get('r')] = text
    return cells


def parse_title(title):
    """ดึง (เดือน, ปี พ.ศ.) จากหัวตาราง — รองรับทั้งเลขไทยและเลขอารบิก"""
    month = next((num for name, num in MONTHS_TH.items() if name in title), None)
    digits = ''.join(ch for ch in thai_to_arabic(title) if ch.isdigit())
    year_be = int(digits[-4:]) if len(digits) >= 4 else None
    return month, year_be


def split_name(full_name):
    prefix = next((p for p in PREFIXES if full_name.startswith(p)), '')
    parts = full_name[len(prefix):].strip().split()
    return prefix, parts[0], ' '.join(parts[1:])


def collect(xlsx_path):
    archive = zipfile.ZipFile(xlsx_path)
    shared = read_shared_strings(archive)
    sheet_paths = sorted(
        name for name in archive.namelist()
        if name.startswith('xl/worksheets/sheet') and name.endswith('.xml')
    )

    people = {}
    bookings = []

    for path in sheet_paths:
        cells = read_cells(archive, path, shared)
        month, year_be = parse_title(cells.get('A1', ''))
        if not month or not year_be:
            print(f'  ข้าม {path} — อ่านเดือน/ปีจากหัวตารางไม่ได้', file=sys.stderr)
            continue

        year_ce = year_be - 543
        found = 0
        for row in range(FIRST_DATA_ROW, MAX_DATA_ROW):
            day_text = cells.get(f'B{row}')
            if not day_text:
                continue
            day = int(float(thai_to_arabic(day_text)))
            note = cells.get(f'F{row}')

            for column, slot in SLOT_COLUMNS.items():
                name = cells.get(f'{column}{row}')
                if not name:
                    continue
                people.setdefault(name, split_name(name))
                bookings.append({
                    'date': f'{year_ce:04d}-{month:02d}-{day:02d}',
                    'slot': slot,
                    'name': name,
                    'note': note,
                })
                found += 1
        print(f'  {path}: {month}/{year_be} → {found} เวร', file=sys.stderr)

    return people, bookings


def build_sql(people, bookings):
    used_slugs = {}
    rows = []
    for index, (full_name, (prefix, first, last)) in enumerate(sorted(people.items()), start=1):
        slug = NAME_SLUGS.get(first, f'nurse{index:02d}')
        # กัน slug ซ้ำเมื่อมีชื่อต้นเหมือนกัน
        if slug in used_slugs:
            slug = f'{slug}{index:02d}'
        used_slugs[slug] = full_name
        rows.append((slug, prefix, first, last, index * 10))

    lines = [
        '-- ============================================================',
        '-- ข้อมูลตั้งต้น — สร้างอัตโนมัติจาก scripts/generate-seed.py',
        '-- ห้ามแก้ไฟล์นี้ด้วยมือ ให้แก้ที่ .xlsx ต้นทางแล้ว generate ใหม่',
        '-- รันหลัง 03_functions.sql',
        '-- ============================================================',
        '',
        '-- ---------- พยาบาลตรวจการ ----------',
        'insert into public.nurses (slug, prefix, first_name, last_name, sort_order) values',
    ]
    lines.append(',\n'.join(
        f'  ({sql_quote(slug)}, {sql_quote(prefix)}, {sql_quote(first)}, '
        f'{sql_quote(last)}, {order})'
        for slug, prefix, first, last, order in rows
    ) + '\non conflict (slug) do nothing;')

    lines += [
        '',
        '-- ---------- เวรเดิมจากไฟล์ Excel (ตั้งเป็นอนุมัติแล้ว) ----------',
        'insert into public.shifts (duty_date, slot, nurse_id, status, note)',
        'select v.duty_date::date, v.slot::shift_slot, n.id, \'approved\'::shift_status, v.note',
        'from (values',
    ]
    lines.append(',\n'.join(
        f'  ({sql_quote(b["date"])}, {sql_quote(b["slot"])}, '
        f'{sql_quote(b["name"])}, {sql_quote(b["note"])})'
        for b in bookings
    ))
    lines += [
        ') as v(duty_date, slot, full_name, note)',
        'join public.nurses n on n.full_name = v.full_name',
        'on conflict do nothing;',
        '',
    ]
    return '\n'.join(lines) + '\n'


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    xlsx_path = Path(sys.argv[1])
    if not xlsx_path.exists():
        print(f'ไม่พบไฟล์: {xlsx_path}', file=sys.stderr)
        return 1

    print(f'อ่าน {xlsx_path.name}', file=sys.stderr)
    people, bookings = collect(xlsx_path)
    if not bookings:
        print('ไม่พบข้อมูลเวรในไฟล์นี้', file=sys.stderr)
        return 1

    output = Path(__file__).resolve().parent.parent / 'supabase' / '04_seed.sql'
    output.write_text(build_sql(people, bookings), encoding='utf-8')
    print(f'\nเขียน {output} — พยาบาล {len(people)} คน, เวร {len(bookings)} รายการ', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
