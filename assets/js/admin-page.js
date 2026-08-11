/** admin-page.js — หน้าตั้งค่าสำหรับหัวหน้าเวร (admin.html) */
import { isConfigured, humanError, getClient } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, escapeHtml, applyStoredTheme } from './ui.js';
import { formatThaiDateShort, toBuddhistYear, toGregorianYear, todayKey, parseDateKey, dateKey, DOW_TH, dayOfWeek, MONTHS_TH } from './thai.js';
import { SLOTS, STATUS_LABEL } from './config.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  alert: document.getElementById('page-alert'),
  nurses: document.getElementById('nurses-body'),
  holidays: document.getElementById('holidays-body'),
  holidayForm: document.getElementById('holiday-form'),
  holidayDate: document.getElementById('holiday-date'),
  holidayName: document.getElementById('holiday-name'),
  exportYear: document.getElementById('export-year'),
  exportBtn: document.getElementById('export-btn'),
};

const SLOT_LABEL = new Map(SLOTS.map((slot) => [slot.key, slot.label]));
const YEAR_RANGE_BACK = 3;

let session = null;

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

// ---------- พยาบาล ----------

async function loadNurses() {
  const { data, error } = await getClient()
    .from('nurses')
    .select('id, full_name, is_admin, is_active, must_change_pin, auth_user_id')
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

function renderNurses(nurses) {
  if (!nurses.length) {
    dom.nurses.innerHTML = '<tr><td colspan="4" class="empty">ยังไม่มีรายชื่อ</td></tr>';
    return;
  }

  dom.nurses.innerHTML = nurses.map((nurse) => {
    const isSelf = nurse.id === session.nurse.id;
    return `
      <tr>
        <td>
          ${escapeHtml(nurse.full_name)}
          ${isSelf ? ' <span class="caption">(คุณ)</span>' : ''}
          ${!nurse.auth_user_id ? '<br><span class="pill danger">ยังไม่มีบัญชีเข้าระบบ</span>' : ''}
          ${nurse.must_change_pin ? '<br><span class="pill warn">ยังใช้ PIN ตั้งต้น</span>' : ''}
        </td>
        <td><span class="pill ${nurse.is_admin ? 'gold' : 'neutral'}">${nurse.is_admin ? 'หัวหน้าเวร' : 'พยาบาลตรวจการ'}</span></td>
        <td><span class="pill ${nurse.is_active ? 'ok' : 'danger'}">${nurse.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span></td>
        <td>
          <div class="row" style="flex-wrap:nowrap">
            <button class="btn btn-sm btn-ghost" data-action="toggle-admin" data-id="${nurse.id}"
                    data-value="${nurse.is_admin}" ${isSelf ? 'disabled title="เปลี่ยนสิทธิ์ของตัวเองไม่ได้"' : ''}>
              ${nurse.is_admin ? 'ถอดสิทธิ์หัวหน้า' : 'ตั้งเป็นหัวหน้า'}
            </button>
            <button class="btn btn-sm btn-ghost" data-action="toggle-active" data-id="${nurse.id}"
                    data-value="${nurse.is_active}" ${isSelf ? 'disabled title="ปิดใช้งานตัวเองไม่ได้"' : ''}>
              ${nurse.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------- วันหยุด ----------

async function loadHolidays() {
  const today = parseDateKey(todayKey());
  const { data, error } = await getClient()
    .from('holidays')
    .select('duty_date, name')
    .gte('duty_date', dateKey(today.year - 1, 1, 1))
    .order('duty_date');
  if (error) throw error;
  return data ?? [];
}

function renderHolidays(holidays) {
  if (!holidays.length) {
    dom.holidays.innerHTML = '<tr><td colspan="3" class="empty">ยังไม่ได้กำหนดวันหยุด</td></tr>';
    return;
  }
  dom.holidays.innerHTML = holidays.map((holiday) => {
    const { year, month, day } = parseDateKey(holiday.duty_date);
    return `
      <tr>
        <td>วัน${DOW_TH[dayOfWeek(year, month, day)]} ${formatThaiDateShort(holiday.duty_date)}</td>
        <td>${escapeHtml(holiday.name)}</td>
        <td>
          <button class="btn btn-sm btn-danger" data-action="delete-holiday" data-date="${holiday.duty_date}">ลบ</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------- ส่งออก CSV ----------

function toCsvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportYearCsv() {
  const yearBe = Number(dom.exportYear.value);
  const year = toGregorianYear(yearBe);

  dom.exportBtn.disabled = true;
  dom.exportBtn.textContent = 'กำลังเตรียมไฟล์…';

  try {
    const { data, error } = await getClient()
      .from('shifts')
      .select('duty_date, slot, status, note, nurse:nurses!shifts_nurse_id_fkey ( full_name )')
      .gte('duty_date', dateKey(year, 1, 1))
      .lte('duty_date', dateKey(year, 12, 31))
      .order('duty_date');
    if (error) throw error;

    if (!data?.length) {
      toast(`ไม่มีข้อมูลเวรในปี ${yearBe}`, 'error');
      return;
    }

    const header = ['วันที่', 'วัน', 'เดือน', 'ช่วงเวลา', 'ผู้ปฏิบัติงาน', 'สถานะ', 'หมายเหตุ'];
    const rows = data.map((shift) => {
      const { year: y, month, day } = parseDateKey(shift.duty_date);
      return [
        shift.duty_date,
        DOW_TH[dayOfWeek(y, month, day)],
        MONTHS_TH[month - 1],
        SLOT_LABEL.get(shift.slot) ?? shift.slot,
        shift.nurse?.full_name ?? '',
        STATUS_LABEL[shift.status] ?? shift.status,
        shift.note ?? '',
      ].map(toCsvCell).join(',');
    });

    // BOM ให้ Excel ภาษาไทยอ่านออกโดยไม่ต้องตั้งค่า encoding
    const csv = `﻿${[header.map(toCsvCell).join(','), ...rows].join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `ตารางเวรตรวจการ-${yearBe}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast(`ดาวน์โหลดแล้ว ${data.length} รายการ`, 'success');
  } catch (error) {
    toast(humanError(error, 'ส่งออกไม่สำเร็จ'), 'error');
  } finally {
    dom.exportBtn.disabled = false;
    dom.exportBtn.textContent = 'ดาวน์โหลด CSV ทั้งปี';
  }
}

// ---------- Event ----------

dom.nurses.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const field = button.dataset.action === 'toggle-admin' ? 'is_admin' : 'is_active';
  const nextValue = button.dataset.value !== 'true';

  if (field === 'is_admin' && nextValue && !window.confirm('ให้สิทธิ์หัวหน้าเวรกับคนนี้ใช่หรือไม่? จะอนุมัติและแก้ตารางของทุกคนได้')) return;

  button.disabled = true;
  try {
    const { error } = await getClient().from('nurses').update({ [field]: nextValue }).eq('id', button.dataset.id);
    if (error) throw error;
    toast('บันทึกแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'บันทึกไม่สำเร็จ'), 'error');
    button.disabled = false;
  }
});

dom.holidayForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const dutyDate = dom.holidayDate.value;
  const name = dom.holidayName.value.trim();
  if (!dutyDate || !name) return;

  try {
    const { error } = await getClient()
      .from('holidays')
      .upsert({ duty_date: dutyDate, name }, { onConflict: 'duty_date' });
    if (error) throw error;
    dom.holidayForm.reset();
    toast('เพิ่มวันหยุดแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'เพิ่มวันหยุดไม่สำเร็จ'), 'error');
  }
});

dom.holidays.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="delete-holiday"]');
  if (!button || !window.confirm('ลบวันหยุดนี้ใช่หรือไม่?')) return;

  button.disabled = true;
  try {
    const { error } = await getClient().from('holidays').delete().eq('duty_date', button.dataset.date);
    if (error) throw error;
    toast('ลบแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'ลบไม่สำเร็จ'), 'error');
    button.disabled = false;
  }
});

dom.exportBtn.addEventListener('click', exportYearCsv);

// ---------- เริ่มทำงาน ----------

async function refresh() {
  dom.alert.classList.add('hidden');
  try {
    const [nurses, holidays] = await Promise.all([loadNurses(), loadHolidays()]);
    renderNurses(nurses);
    renderHolidays(holidays);
  } catch (error) {
    showAlert(humanError(error, 'โหลดข้อมูลไม่สำเร็จ'));
  }
}

function fillYearSelect() {
  const currentBe = toBuddhistYear(parseDateKey(todayKey()).year);
  const years = [];
  for (let be = currentBe + 1; be >= currentBe - YEAR_RANGE_BACK; be -= 1) years.push(be);
  dom.exportYear.innerHTML = years
    .map((be) => `<option value="${be}"${be === currentBe ? ' selected' : ''}>${be}</option>`)
    .join('');
}

async function boot() {
  if (!isConfigured()) {
    renderSetupNotice(document.getElementById('main'));
    return;
  }

  session = await requireSession({ adminOnly: true });
  if (!session) return;

  renderShell({ mount: dom.shell, current: 'admin.html', session });
  await enforcePinChange(session);

  fillYearSelect();
  await refresh();
}

boot().catch((error) => showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ')));
