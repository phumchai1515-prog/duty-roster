/** admin-page.js — หน้าผู้ดูแลระบบ (admin.html) */
import { isConfigured, humanError, getClient } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, escapeHtml, applyStoredTheme } from './ui.js';
import { loadWorkloadSummary } from './shifts.js';
import { loadMonthSetting, saveMonthSetting, loadBookingStatus, autoFillMonth } from './month-settings.js';
import {
  formatThaiDateShort, toBuddhistYear, toGregorianYear, todayKey,
  parseDateKey, dateKey, DOW_TH, dayOfWeek, MONTHS_TH,
} from './thai.js';
import { SLOTS, STATUS_LABEL } from './config.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  alert: document.getElementById('page-alert'),
  // ตั้งค่ารายเดือน
  msMonth: document.getElementById('ms-month'),
  msYear: document.getElementById('ms-year'),
  msQuota: document.getElementById('ms-quota'),
  msOffOpen: document.getElementById('ms-off-open'),
  msLocked: document.getElementById('ms-locked'),
  msNote: document.getElementById('ms-note'),
  msAutoFill: document.getElementById('ms-autofill'),
  msAutoFillStatus: document.getElementById('ms-autofill-status'),
  msFillNow: document.getElementById('ms-fill-now'),
  msSave: document.getElementById('ms-save'),
  statusPanel: document.getElementById('status-panel'),
  // เพิ่มพยาบาล
  addForm: document.getElementById('add-form'),
  addError: document.getElementById('add-error'),
  addPrefix: document.getElementById('add-prefix'),
  addFirst: document.getElementById('add-first'),
  addLast: document.getElementById('add-last'),
  addSlug: document.getElementById('add-slug'),
  addPin: document.getElementById('add-pin'),
  addAdmin: document.getElementById('add-admin'),
  addSubmit: document.getElementById('add-submit'),
  // ตาราง
  nurses: document.getElementById('nurses-body'),
  workload: document.getElementById('workload-body'),
  holidays: document.getElementById('holidays-body'),
  holidayForm: document.getElementById('holiday-form'),
  holidayDate: document.getElementById('holiday-date'),
  holidayName: document.getElementById('holiday-name'),
  exportYear: document.getElementById('export-year'),
  exportBtn: document.getElementById('export-btn'),
};

const SLOT_LABEL = new Map(SLOTS.map((slot) => [slot.key, slot.label]));
const YEAR_RANGE_BACK = 2;
const YEAR_RANGE_FORWARD = 2;

let session = null;

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

// ---------- ตั้งค่ารายเดือน ----------

const selectedYear = () => toGregorianYear(Number(dom.msYear.value));
const selectedMonth = () => Number(dom.msMonth.value);

function fillMonthSelectors() {
  const { year, month } = parseDateKey(todayKey());
  const currentBe = toBuddhistYear(year);

  dom.msMonth.innerHTML = MONTHS_TH
    .map((name, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${name}</option>`)
    .join('');

  const years = [];
  for (let be = currentBe - YEAR_RANGE_BACK; be <= currentBe + YEAR_RANGE_FORWARD; be += 1) years.push(be);
  dom.msYear.innerHTML = years
    .map((be) => `<option value="${be}"${be === currentBe ? ' selected' : ''}>${be}</option>`)
    .join('');

  const exportYears = [];
  for (let be = currentBe + 1; be >= currentBe - YEAR_RANGE_BACK - 1; be -= 1) exportYears.push(be);
  dom.exportYear.innerHTML = exportYears
    .map((be) => `<option value="${be}"${be === currentBe ? ' selected' : ''}>${be}</option>`)
    .join('');
}

/** แปลง timestamptz จากฐานข้อมูล → ค่าที่ <input type="datetime-local"> รับได้ (เวลาเครื่องผู้ใช้) */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadMonthForm() {
  try {
    const setting = await loadMonthSetting(selectedYear(), selectedMonth());
    dom.msQuota.value = setting.shift_quota;
    dom.msOffOpen.checked = Boolean(setting.off_booking_open);
    dom.msLocked.checked = Boolean(setting.shifts_locked);
    dom.msNote.value = setting.note ?? '';
    dom.msAutoFill.value = toLocalInput(setting.auto_fill_at);

    dom.msAutoFillStatus.textContent = setting.auto_filled_at
      ? `เติมอัตโนมัติไปแล้วเมื่อ ${new Date(setting.auto_filled_at).toLocaleString('th-TH')}`
      : (setting.auto_fill_at ? 'ยังไม่ถึงกำหนด' : '');
  } catch (error) {
    showAlert(humanError(error, 'โหลดการตั้งค่าเดือนไม่สำเร็จ'));
  }
}

/** แผงสถานะการจองของเดือนที่เลือก */
async function refreshStatus() {
  dom.statusPanel.innerHTML = '<p class="empty">กำลังโหลด…</p>';
  try {
    const s = await loadBookingStatus(selectedYear(), selectedMonth());
    const emptyBlock = s.empty_days
      ? `<div class="alert warn">
           <div><strong>ยังไม่มีผู้จอง ${s.empty_days} วัน</strong><br>
           <span class="caption">วันที่ ${escapeHtml(s.empty_list)}</span></div>
         </div>`
      : '<div class="alert success"><div><strong>จองครบทุกวันแล้ว</strong></div></div>';

    const noneBlock = s.nurses_none
      ? `<div class="alert warn">
           <div><strong>ยังไม่จองเลย ${s.nurses_none} คน</strong><br>
           <span class="caption">${escapeHtml(s.none_list)}</span></div>
         </div>`
      : '<div class="alert success"><div><strong>ทุกคนจองแล้วอย่างน้อย 1 เวร</strong></div></div>';

    dom.statusPanel.innerHTML = `
      <div class="row" style="gap:24px">
        <div><strong style="font-size:22px">${s.filled_days}/${s.total_days}</strong>
             <span class="caption"> วันที่มีผู้ปฏิบัติงาน</span></div>
        <div><strong style="font-size:22px">${s.nurses_at_quota}/${s.nurses_total}</strong>
             <span class="caption"> คนจองครบโควตา (${s.quota} เวร)</span></div>
      </div>
      ${emptyBlock}
      ${noneBlock}
    `;
  } catch (error) {
    dom.statusPanel.innerHTML = '';
    showAlert(humanError(error, 'โหลดสถานะการจองไม่สำเร็จ'));
  }
}

async function saveMonthForm() {
  const quota = Number(dom.msQuota.value);
  if (!Number.isInteger(quota) || quota < 0 || quota > 31) {
    toast('โควตาต้องเป็นจำนวนเต็ม 0–31', 'error');
    return;
  }

  dom.msSave.disabled = true;
  dom.msSave.textContent = 'กำลังบันทึก…';
  try {
    await saveMonthSetting(selectedYear(), selectedMonth(), {
      shiftQuota: quota,
      shiftsLocked: dom.msLocked.checked,
      offBookingOpen: dom.msOffOpen.checked,
      note: dom.msNote.value.trim() || null,
      autoFillAt: dom.msAutoFill.value ? new Date(dom.msAutoFill.value).toISOString() : null,
    });
    toast('บันทึกการตั้งค่าแล้ว', 'success');
    await loadMonthForm();
  } catch (error) {
    toast(humanError(error, 'บันทึกไม่สำเร็จ'), 'error');
  } finally {
    dom.msSave.disabled = false;
    dom.msSave.textContent = 'บันทึกการตั้งค่าเดือนนี้';
  }
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
        <td><span class="pill ${nurse.is_admin ? 'gold' : 'neutral'}">${nurse.is_admin ? 'ผู้ดูแลระบบ' : 'ผู้ขึ้นเวร'}</span></td>
        <td><span class="pill ${nurse.is_active ? 'ok' : 'danger'}">${nurse.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span></td>
        <td>
          <div class="row" style="flex-wrap:wrap">
            <button class="btn btn-sm btn-ghost" data-action="reset-pin" data-id="${nurse.id}"
                    data-name="${escapeHtml(nurse.full_name)}"
                    ${nurse.auth_user_id ? '' : 'disabled title="ยังไม่มีบัญชีเข้าระบบ"'}>รีเซ็ต PIN</button>
            <button class="btn btn-sm btn-ghost" data-action="toggle-admin" data-id="${nurse.id}"
                    data-value="${nurse.is_admin}" ${isSelf ? 'disabled title="เปลี่ยนสิทธิ์ของตัวเองไม่ได้"' : ''}>
              ${nurse.is_admin ? 'ถอดสิทธิ์ผู้ดูแล' : 'ตั้งเป็นผู้ดูแล'}
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

/** เดาตัวสะกดอังกฤษไม่ได้ จึงให้ผู้ดูแลกรอกเอง แต่ช่วยตรวจรูปแบบให้ */
function validateNewNurse() {
  if (!dom.addFirst.value.trim() || !dom.addLast.value.trim()) return 'กรุณากรอกชื่อและนามสกุล';
  if (!/^[a-z][a-z0-9]{2,29}$/.test(dom.addSlug.value.trim())) {
    return 'รหัสผู้ใช้ต้องเป็นตัวอักษรอังกฤษพิมพ์เล็ก/ตัวเลข 3–30 ตัว และขึ้นต้นด้วยตัวอักษร';
  }
  if (!/^\d{6}$/.test(dom.addPin.value)) return 'PIN ตั้งต้นต้องเป็นตัวเลข 6 หลัก';
  return null;
}

async function addNurse(event) {
  event.preventDefault();
  dom.addError.classList.add('hidden');

  const invalid = validateNewNurse();
  if (invalid) {
    dom.addError.textContent = invalid;
    dom.addError.classList.remove('hidden');
    return;
  }

  dom.addSubmit.disabled = true;
  dom.addSubmit.textContent = 'กำลังเพิ่ม…';

  try {
    const { error } = await getClient().rpc('admin_create_nurse', {
      p_prefix: dom.addPrefix.value,
      p_first_name: dom.addFirst.value.trim(),
      p_last_name: dom.addLast.value.trim(),
      p_slug: dom.addSlug.value.trim().toLowerCase(),
      p_pin: dom.addPin.value,
      p_is_admin: dom.addAdmin.checked,
    });
    if (error) throw error;

    toast(`เพิ่ม ${dom.addPrefix.value}${dom.addFirst.value} แล้ว — PIN ตั้งต้น ${dom.addPin.value}`, 'success');
    dom.addForm.reset();
    dom.addPin.value = '112233';
    await refresh();
  } catch (error) {
    dom.addError.textContent = humanError(error, 'เพิ่มรายชื่อไม่สำเร็จ');
    dom.addError.classList.remove('hidden');
  } finally {
    dom.addSubmit.disabled = false;
    dom.addSubmit.textContent = 'เพิ่มรายชื่อ';
  }
}

async function resetPin(nurseId, fullName) {
  const pin = window.prompt(`ตั้ง PIN ใหม่ให้ ${fullName}\nตัวเลข 6 หลัก — เจ้าตัวจะถูกบังคับเปลี่ยนอีกครั้งเมื่อเข้าระบบ`, '112233');
  if (pin === null) return;
  if (!/^\d{6}$/.test(pin)) {
    toast('PIN ต้องเป็นตัวเลข 6 หลัก', 'error');
    return;
  }

  try {
    const { error } = await getClient().rpc('admin_reset_pin', { p_nurse_id: nurseId, p_pin: pin });
    if (error) throw error;
    toast(`รีเซ็ต PIN ของ ${fullName} เป็น ${pin} แล้ว`, 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'รีเซ็ต PIN ไม่สำเร็จ'), 'error');
  }
}

// ---------- ภาระงาน ----------

function renderWorkload(rows) {
  if (!rows.length) {
    dom.workload.innerHTML = '<tr><td colspan="2" class="empty">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  const max = rows[0].count;
  dom.workload.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.fullName)}</td>
      <td>
        <span class="mono"><strong>${row.count}</strong></span>
        <span class="caption"> เวร</span>
        ${row.count === max ? ' <span class="pill warn">มากที่สุด</span>' : ''}
      </td>
    </tr>
  `).join('');
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
        <td><button class="btn btn-sm btn-danger" data-action="delete-holiday" data-date="${holiday.duty_date}">ลบ</button></td>
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

/** เติมเวรที่ว่างทันที แล้วรายงานว่าใครได้วันไหน */
async function fillNow() {
  if (!window.confirm(
    'ให้ระบบเติมเวรที่ยังว่างของเดือนนี้เลยหรือไม่?\n\n'
    + 'ระบบจะเลือกคนให้อัตโนมัติ โดยข้ามคนที่แจ้ง OFF\n'
    + 'ผู้ที่ถูกจัดให้จะเห็นว่าเป็นเวรที่ระบบเติมให้')) return;

  dom.msFillNow.disabled = true;
  dom.msFillNow.textContent = 'กำลังเติม…';
  try {
    const rows = await autoFillMonth(selectedYear(), selectedMonth());
    if (!rows.length) {
      toast('ไม่มีวันว่างให้เติม หรือไม่มีผู้ที่ว่างพอ', 'error');
    } else {
      toast(`เติมให้แล้ว ${rows.length} วัน`, 'success');
    }
    await Promise.all([loadMonthForm(), refreshStatus(), refresh()]);
  } catch (error) {
    toast(humanError(error, 'เติมเวรไม่สำเร็จ'), 'error');
  } finally {
    dom.msFillNow.disabled = false;
    dom.msFillNow.textContent = 'เติมเวรที่ว่างเลยตอนนี้';
  }
}

const onMonthChange = () => Promise.all([loadMonthForm(), refreshStatus()]);
dom.msMonth.addEventListener('change', onMonthChange);
dom.msYear.addEventListener('change', onMonthChange);
dom.msFillNow.addEventListener('click', fillNow);
dom.msSave.addEventListener('click', saveMonthForm);
dom.addForm.addEventListener('submit', addNurse);
dom.exportBtn.addEventListener('click', exportYearCsv);

dom.nurses.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (button.dataset.action === 'reset-pin') {
    await resetPin(button.dataset.id, button.dataset.name);
    return;
  }

  const field = button.dataset.action === 'toggle-admin' ? 'is_admin' : 'is_active';
  const nextValue = button.dataset.value !== 'true';

  if (field === 'is_admin' && nextValue
      && !window.confirm('ให้สิทธิ์ผู้ดูแลระบบกับคนนี้ใช่หรือไม่? จะแก้ตารางและจัดการรายชื่อของทุกคนได้')) return;

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

// ---------- เริ่มทำงาน ----------

async function refresh() {
  dom.alert.classList.add('hidden');
  try {
    const today = parseDateKey(todayKey());
    const [nurses, holidays, workload] = await Promise.all([
      loadNurses(),
      loadHolidays(),
      loadWorkloadSummary(dateKey(today.year - 1, today.month, 1), dateKey(today.year + 1, today.month, 28)),
    ]);
    renderNurses(nurses);
    renderHolidays(holidays);
    renderWorkload(workload);
  } catch (error) {
    showAlert(humanError(error, 'โหลดข้อมูลไม่สำเร็จ'));
  }
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

  fillMonthSelectors();
  await Promise.all([loadMonthForm(), refreshStatus(), refresh()]);
}

boot().catch((error) => showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ')));
