/** swap-form-page.js — หน้าใบแลกเวร F–NU–005 (swap-form.html) */
import { isConfigured, humanError, getClient } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, applyStoredTheme, escapeHtml } from './ui.js';
import { renderSwapForm } from './swap-document.js';
import { todayKey, formatThaiDateShort } from './thai.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  alert: document.getElementById('page-alert'),
  doc: document.getElementById('document'),
  source: document.getElementById('source-select'),
  printBtn: document.getElementById('print-btn'),
  writtenOn: document.getElementById('written-on'),
  requesterName: document.getElementById('requester-name'),
  requesterRole: document.getElementById('requester-role'),
  absentDate: document.getElementById('absent-date'),
  replacementName: document.getElementById('replacement-name'),
  returnFor: document.getElementById('return-for'),
  returnDate: document.getElementById('return-date'),
  orgName: document.getElementById('org-name'),
};

const ROLE_KEY = 'duty-roster-my-role';

let session = null;
let swapRequests = [];

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

function paint() {
  dom.doc.innerHTML = renderSwapForm({
    organizationName: dom.orgName.value,
    writtenOn: dom.writtenOn.value,
    requesterName: dom.requesterName.value,
    requesterRole: dom.requesterRole.value,
    absentDate: dom.absentDate.value,
    replacementName: dom.replacementName.value,
    returnForName: dom.returnFor.value,
    returnDate: dom.returnDate.value,
  });
}

/** คำขอแลกเวรที่เกี่ยวข้องกับเรา ใช้กรอกฟอร์มอัตโนมัติ */
async function loadSwapRequests() {
  const { data, error } = await getClient()
    .from('swap_requests')
    .select(`
      id, status, created_at,
      shift:shifts!swap_requests_shift_id_fkey ( id, duty_date ),
      offer:shifts!swap_requests_offer_shift_id_fkey ( id, duty_date ),
      from_nurse:nurses!swap_requests_from_nurse_id_fkey ( id, full_name ),
      to_nurse:nurses!swap_requests_to_nurse_id_fkey ( id, full_name )
    `)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) throw error;
  return data ?? [];
}

function fillFromRequest(request) {
  dom.requesterName.value = request.from_nurse?.full_name ?? '';
  dom.replacementName.value = request.to_nurse?.full_name ?? '';
  dom.absentDate.value = request.shift?.duty_date ?? '';
  // การแลกแบบ 2 ทาง: ผู้ขอจะไปขึ้นเวรแทนผู้รับ ในวันของผู้รับ
  dom.returnFor.value = request.offer ? (request.to_nurse?.full_name ?? '') : '';
  dom.returnDate.value = request.offer?.duty_date ?? '';
  paint();
}

// ---------- Event ----------

for (const input of [
  dom.writtenOn, dom.requesterName, dom.requesterRole, dom.absentDate,
  dom.replacementName, dom.returnFor, dom.returnDate, dom.orgName,
]) {
  input.addEventListener('input', paint);
}

// จำตำแหน่งของตัวเองไว้ ไม่ต้องพิมพ์ซ้ำทุกครั้ง (เก็บเฉพาะตำแหน่ง ไม่ใช่ข้อมูลอ่อนไหว)
dom.requesterRole.addEventListener('change', () => {
  localStorage.setItem(ROLE_KEY, dom.requesterRole.value);
});

dom.source.addEventListener('change', () => {
  const request = swapRequests.find((row) => row.id === dom.source.value);
  if (request) fillFromRequest(request);
});

dom.printBtn.addEventListener('click', () => window.print());

// ---------- เริ่มทำงาน ----------

async function boot() {
  if (!isConfigured()) {
    renderSetupNotice(document.getElementById('main'));
    return;
  }

  session = await requireSession();
  if (!session) return;

  renderShell({ mount: dom.shell, current: 'swap-form.html', session });
  await enforcePinChange(session);

  // ตั้งค่าเริ่มต้นจากข้อมูลผู้ใช้ปัจจุบัน
  dom.writtenOn.value = todayKey();
  dom.requesterName.value = session.nurse.full_name;
  dom.requesterRole.value = localStorage.getItem(ROLE_KEY) ?? '';
  paint();

  try {
    swapRequests = await loadSwapRequests();
    const usable = swapRequests.filter((row) => row.shift);
    dom.source.innerHTML = [
      '<option value="">— กรอกเอง —</option>',
      ...usable.map((row) => {
        const label = `${row.from_nurse?.full_name ?? '?'} → ${row.to_nurse?.full_name ?? '?'}`
          + ` · ${formatThaiDateShort(row.shift.duty_date)}`;
        return `<option value="${row.id}">${escapeHtml(label)}</option>`;
      }),
    ].join('');
  } catch (error) {
    showAlert(humanError(error, 'โหลดรายการคำขอแลกเวรไม่สำเร็จ — ยังกรอกเองได้'));
  }
}

boot().catch((error) => showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ')));
