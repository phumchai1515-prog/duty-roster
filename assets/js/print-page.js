/** print-page.js — หน้าพิมพ์เอกสารราชการ (print.html) */
import { isConfigured, humanError, getClient } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, applyStoredTheme } from './ui.js';
import { loadMonthShifts, loadMonthHolidays } from './shifts.js';
import { renderDocument } from './print-document.js';
import { MONTHS_TH, toBuddhistYear, toGregorianYear, parseDateKey, todayKey, daysInMonth, dateKey } from './thai.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  doc: document.getElementById('document'),
  alert: document.getElementById('page-alert'),
  pendingWarning: document.getElementById('pending-warning'),
  monthSelect: document.getElementById('month-select'),
  yearSelect: document.getElementById('year-select'),
  scopeSelect: document.getElementById('scope-select'),
  printBtn: document.getElementById('print-btn'),
  editBtn: document.getElementById('edit-header-btn'),
  backdrop: document.getElementById('header-backdrop'),
  orgInput: document.getElementById('org-input'),
  orderInput: document.getElementById('order-input'),
  signerInput: document.getElementById('signer-input'),
  positionInput: document.getElementById('position-input'),
  headerError: document.getElementById('header-error'),
  headerSave: document.getElementById('header-save'),
  headerCancel: document.getElementById('header-cancel'),
};

const YEAR_RANGE_BACK = 2;
const YEAR_RANGE_FORWARD = 2;

let session = null;
let currentMeta = {};

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

const selectedYear = () => toGregorianYear(Number(dom.yearSelect.value));
const selectedMonth = () => Number(dom.monthSelect.value);

function fillSelectors() {
  const { year, month } = parseDateKey(todayKey());
  const currentBe = toBuddhistYear(year);

  dom.monthSelect.innerHTML = MONTHS_TH
    .map((name, index) => `<option value="${index + 1}"${index + 1 === month ? ' selected' : ''}>${name}</option>`)
    .join('');

  const years = [];
  for (let be = currentBe - YEAR_RANGE_BACK; be <= currentBe + YEAR_RANGE_FORWARD; be += 1) years.push(be);
  dom.yearSelect.innerHTML = years
    .map((be) => `<option value="${be}"${be === currentBe ? ' selected' : ''}>${be}</option>`)
    .join('');
}

/** หัวเอกสารของเดือนนั้น ถ้าไม่มีให้ย้อนไปใช้ของเดือนล่าสุดที่เคยตั้งไว้ */
async function loadMeta(year, month) {
  const client = getClient();
  const yearBe = toBuddhistYear(year);

  const { data: exact, error } = await client
    .from('order_meta')
    .select('*')
    .eq('year_be', yearBe)
    .eq('month', month)
    .maybeSingle();
  if (error) throw error;
  if (exact) return exact;

  const { data: latest } = await client
    .from('order_meta')
    .select('*')
    .order('year_be', { ascending: false })
    .order('month', { ascending: false })
    .limit(1);

  // ใช้ค่าเดิมเป็นแบบ แต่ไม่ยกเลขที่คำสั่งของเดือนอื่นมาใช้ซ้ำ
  return latest?.[0] ? { ...latest[0], order_no: null, year_be: yearBe, month } : {};
}

function countPending(shifts, year, month) {
  let pending = 0;
  let empty = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const dayShifts = shifts.get(dateKey(year, month, day)) ?? {};
    const evening = dayShifts.evening;
    if (!evening) empty += 1;
    else if (evening.status === 'pending') pending += 1;
  }
  return { pending, empty };
}

async function refresh() {
  const year = selectedYear();
  const month = selectedMonth();
  const includePending = dom.scopeSelect.value === 'all';

  dom.alert.classList.add('hidden');
  dom.doc.innerHTML = '<p class="empty">กำลังโหลดเอกสาร…</p>';

  try {
    const [shifts, holidays, meta] = await Promise.all([
      loadMonthShifts(year, month),
      loadMonthHolidays(year, month),
      loadMeta(year, month),
    ]);
    currentMeta = meta;

    dom.doc.innerHTML = renderDocument({ year, month, shifts, holidays, meta, includePending });

    const { pending, empty } = countPending(shifts, year, month);
    const warnings = [];
    if (empty) warnings.push(`ยังไม่มีผู้จอง ${empty} วัน`);
    if (pending && !includePending) warnings.push(`มีเวรรออนุมัติ ${pending} วัน ซึ่งยังไม่แสดงในเอกสารนี้`);
    else if (pending) warnings.push(`มีเวรรออนุมัติ ${pending} วัน แสดงรวมอยู่ในเอกสาร`);

    if (warnings.length) {
      dom.pendingWarning.textContent = `ตรวจสอบก่อนพิมพ์ — ${warnings.join(' · ')}`;
      dom.pendingWarning.classList.remove('hidden');
    } else {
      dom.pendingWarning.classList.add('hidden');
    }
  } catch (error) {
    dom.doc.innerHTML = '<p class="empty">โหลดเอกสารไม่สำเร็จ</p>';
    showAlert(humanError(error, 'โหลดเอกสารไม่สำเร็จ'));
  }
}

// ---------- แก้หัวเอกสาร ----------

function openHeaderDialog() {
  dom.orgInput.value = currentMeta.organization_name ?? 'โรงพยาบาลจิตเวชเลยราชนครินทร์';
  dom.orderInput.value = currentMeta.order_no ?? '';
  dom.signerInput.value = currentMeta.signer_name ?? '';
  dom.positionInput.value = currentMeta.signer_position ?? '';
  dom.headerError.classList.add('hidden');
  dom.backdrop.classList.remove('hidden');
  dom.orgInput.focus();
}

async function saveHeader() {
  const organization = dom.orgInput.value.trim();
  if (!organization) {
    dom.headerError.textContent = 'กรุณากรอกชื่อหน่วยงาน';
    dom.headerError.classList.remove('hidden');
    return;
  }

  dom.headerSave.disabled = true;
  dom.headerSave.textContent = 'กำลังบันทึก…';

  try {
    const { error } = await getClient().from('order_meta').upsert({
      year_be: toBuddhistYear(selectedYear()),
      month: selectedMonth(),
      organization_name: organization,
      order_no: dom.orderInput.value.trim() || null,
      signer_name: dom.signerInput.value.trim() || null,
      signer_position: dom.positionInput.value.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'year_be,month' });
    if (error) throw error;

    dom.backdrop.classList.add('hidden');
    toast('บันทึกหัวเอกสารแล้ว', 'success');
    await refresh();
  } catch (error) {
    dom.headerError.textContent = humanError(error, 'บันทึกไม่สำเร็จ');
    dom.headerError.classList.remove('hidden');
  } finally {
    dom.headerSave.disabled = false;
    dom.headerSave.textContent = 'บันทึก';
  }
}

// ---------- Event ----------

dom.monthSelect.addEventListener('change', refresh);
dom.yearSelect.addEventListener('change', refresh);
dom.scopeSelect.addEventListener('change', refresh);
dom.printBtn.addEventListener('click', () => window.print());
dom.editBtn.addEventListener('click', openHeaderDialog);
dom.headerCancel.addEventListener('click', () => dom.backdrop.classList.add('hidden'));
dom.headerSave.addEventListener('click', saveHeader);
dom.backdrop.addEventListener('click', (event) => {
  if (event.target === dom.backdrop) dom.backdrop.classList.add('hidden');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dom.backdrop.classList.add('hidden');
});

// ---------- เริ่มทำงาน ----------

async function boot() {
  if (!isConfigured()) {
    renderSetupNotice(document.getElementById('main'));
    return;
  }

  session = await requireSession();
  if (!session) return;

  renderShell({ mount: dom.shell, current: 'print.html', session });
  await enforcePinChange(session);

  // เฉพาะหัวหน้าที่แก้หัวเอกสารได้ (RLS บังคับอีกชั้นอยู่แล้ว)
  if (!session.nurse.is_admin) dom.editBtn.classList.add('hidden');

  fillSelectors();
  await refresh();
}

boot().catch((error) => showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ')));
