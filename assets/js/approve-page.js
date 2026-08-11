/** approve-page.js — หน้าหัวหน้าเวรอนุมัติการจอง (approve.html) */
import { isConfigured, humanError } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, escapeHtml, applyStoredTheme } from './ui.js';
import { loadPendingShifts, reviewShifts, approveMonth, loadWorkloadSummary } from './shifts.js';
import { formatThaiDateShort, todayKey, parseDateKey, dateKey, DOW_TH, dayOfWeek, formatThaiMonthYear } from './thai.js';
import { SLOTS } from './config.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  alert: document.getElementById('page-alert'),
  body: document.getElementById('pending-body'),
  workload: document.getElementById('workload-body'),
  count: document.getElementById('pending-count'),
  refreshBtn: document.getElementById('refresh-btn'),
  approveMonthBtn: document.getElementById('approve-month-btn'),
};

const SLOT_LABEL = new Map(SLOTS.map((slot) => [slot.key, slot.label]));

let session = null;

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

/** รวมเวรหลายช่วงของวันเดียวกัน + คนเดียวกัน ให้เป็นแถวเดียว */
function groupByDayAndNurse(shifts) {
  const groups = new Map();
  for (const shift of shifts) {
    const key = `${shift.duty_date}|${shift.nurse?.id ?? ''}`;
    const existing = groups.get(key);
    groups.set(key, {
      dutyDate: shift.duty_date,
      nurse: shift.nurse,
      slots: [...(existing?.slots ?? []), shift.slot],
      ids: [...(existing?.ids ?? []), shift.id],
    });
  }
  return [...groups.values()].sort((a, b) => a.dutyDate.localeCompare(b.dutyDate));
}

function renderPending(groups) {
  if (!groups.length) {
    dom.body.innerHTML = '<tr><td colspan="4" class="empty">ไม่มีเวรที่รออนุมัติ</td></tr>';
    dom.count.textContent = 'ไม่มีรายการค้าง';
    return;
  }

  dom.count.textContent = `รออนุมัติ ${groups.length} รายการ`;
  dom.body.innerHTML = groups.map((group) => {
    const { year, month, day } = parseDateKey(group.dutyDate);
    const isPast = group.dutyDate < todayKey();
    return `
      <tr>
        <td>
          <strong>วัน${DOW_TH[dayOfWeek(year, month, day)]} ${formatThaiDateShort(group.dutyDate)}</strong>
          ${isPast ? '<br><span class="pill danger">เลยวันไปแล้ว</span>' : ''}
        </td>
        <td>${escapeHtml(group.nurse?.full_name ?? '—')}</td>
        <td>${group.slots.map((slot) => SLOT_LABEL.get(slot) ?? slot).join(' · ')}</td>
        <td>
          <div class="row" style="flex-wrap:nowrap">
            <button class="btn btn-sm btn-primary" data-action="approve" data-ids="${group.ids.join(',')}">อนุมัติ</button>
            <button class="btn btn-sm btn-danger" data-action="reject" data-ids="${group.ids.join(',')}">ไม่อนุมัติ</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

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

async function refresh() {
  dom.alert.classList.add('hidden');
  try {
    const today = parseDateKey(todayKey());
    const from = dateKey(today.year - 1, today.month, 1);
    const to = dateKey(today.year + 1, today.month, 28);

    const [pending, workload] = await Promise.all([
      loadPendingShifts(),
      loadWorkloadSummary(from, to),
    ]);
    renderPending(groupByDayAndNurse(pending));
    renderWorkload(workload);
  } catch (error) {
    showAlert(humanError(error, 'โหลดข้อมูลไม่สำเร็จ'));
  }
}

dom.body.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const approve = button.dataset.action === 'approve';
  const ids = button.dataset.ids.split(',').filter(Boolean);

  let note = null;
  if (!approve) {
    note = window.prompt('เหตุผลที่ไม่อนุมัติ (ไม่บังคับ)') ?? null;
  }

  button.disabled = true;
  try {
    await reviewShifts(ids, { approve, reviewerId: session.nurse.id, note });
    toast(approve ? 'อนุมัติแล้ว' : 'บันทึกการไม่อนุมัติแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'บันทึกไม่สำเร็จ'), 'error');
    button.disabled = false;
  }
});

dom.refreshBtn.addEventListener('click', refresh);

dom.approveMonthBtn.addEventListener('click', async () => {
  const { year, month } = parseDateKey(todayKey());
  const label = formatThaiMonthYear(year, month, { thaiDigits: false });
  if (!window.confirm(`อนุมัติเวรที่รออยู่ทั้งหมดของเดือน ${label} ใช่หรือไม่?`)) return;

  dom.approveMonthBtn.disabled = true;
  try {
    const count = await approveMonth(year, month);
    toast(count ? `อนุมัติแล้ว ${count} รายการ` : 'ไม่มีรายการรออนุมัติในเดือนนี้', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'อนุมัติไม่สำเร็จ'), 'error');
  } finally {
    dom.approveMonthBtn.disabled = false;
  }
});

async function boot() {
  if (!isConfigured()) {
    renderSetupNotice(document.getElementById('main'));
    return;
  }

  session = await requireSession({ adminOnly: true });
  if (!session) return;

  renderShell({ mount: dom.shell, current: 'approve.html', session });
  await enforcePinChange(session);

  const { year, month } = parseDateKey(todayKey());
  dom.approveMonthBtn.textContent = `อนุมัติทั้งเดือน ${formatThaiMonthYear(year, month, { thaiDigits: false })}`;

  await refresh();
}

boot().catch((error) => showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ')));
