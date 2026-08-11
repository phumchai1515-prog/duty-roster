/** my-page.js — หน้า "เวรของฉัน" (my.html) */
import { isConfigured, humanError } from './supabase.js';
import { requireSession, renderShell, renderSetupNotice, toast, escapeHtml, applyStoredTheme } from './ui.js';
import { loadNurseShifts, cancelShifts } from './shifts.js';
import { loadNurseOffDays, cancelOffDay } from './off-days.js';
import {
  loadIncomingSwaps, loadOutgoingSwaps, createSwapRequest,
  respondToSwap, cancelSwapRequest, loadColleagues, loadUpcomingShiftsOf,
} from './swaps.js';
import { formatThaiDateShort, formatThaiDateFull, todayKey, parseDateKey, DOW_TH, dayOfWeek } from './thai.js';
import { DUTY_SLOT, STATUS_LABEL, STATUS_PILL } from './config.js';
import { enforcePinChange } from './pin-gate.js';

applyStoredTheme();

const dom = {
  shell: document.getElementById('shell'),
  alert: document.getElementById('page-alert'),
  incoming: document.getElementById('incoming-list'),
  upcoming: document.getElementById('upcoming-body'),
  history: document.getElementById('history-body'),
  offBody: document.getElementById('off-body'),
  summary: document.getElementById('upcoming-summary'),
  backdrop: document.getElementById('swap-backdrop'),
  swapSub: document.getElementById('swap-sub'),
  swapNurse: document.getElementById('swap-nurse'),
  swapOffer: document.getElementById('swap-offer'),
  swapReason: document.getElementById('swap-reason'),
  swapError: document.getElementById('swap-error'),
  swapSend: document.getElementById('swap-send'),
  swapCancel: document.getElementById('swap-cancel'),
};

const HISTORY_LIMIT = 30;

let session = null;
let colleagues = [];
let swapTargetShiftId = null;

function showAlert(message) {
  dom.alert.textContent = message;
  dom.alert.classList.remove('hidden');
}

/** รวมเวรของวันเดียวกันเป็นแถวเดียว */
function groupByDay(shifts) {
  const groups = new Map();
  for (const shift of shifts) {
    const existing = groups.get(shift.duty_date);
    groups.set(shift.duty_date, {
      dutyDate: shift.duty_date,
      status: shift.status,
      assignedBySystem: shift.assigned_by_system || existing?.assignedBySystem || false,
      ids: [...(existing?.ids ?? []), shift.id],
    });
  }
  return [...groups.values()];
}

function dateCell(dutyDate) {
  const { year, month, day } = parseDateKey(dutyDate);
  return `<strong>วัน${DOW_TH[dayOfWeek(year, month, day)]} ${formatThaiDateShort(dutyDate)}</strong>`;
}

function renderUpcoming(groups, outgoing) {
  if (!groups.length) {
    dom.upcoming.innerHTML = '<tr><td colspan="4" class="empty">ยังไม่มีเวรที่จะถึง</td></tr>';
    dom.summary.textContent = 'ยังไม่ได้จองเวรใดๆ';
    return;
  }

  dom.summary.textContent = `เวรที่จะถึง ${groups.length} เวร`;

  dom.upcoming.innerHTML = groups.map((group) => {
    const swap = group.ids.map((id) => outgoing.get(id)).find(Boolean);

    const actions = swap
      ? `<button class="btn btn-sm btn-ghost" data-action="cancel-swap" data-id="${swap.id}">ยกเลิกคำขอแลก</button>`
      : `<button class="btn btn-sm btn-danger" data-action="cancel" data-ids="${group.ids.join(',')}">ยกเลิก</button>
         <button class="btn btn-sm btn-ghost" data-action="swap" data-id="${group.ids[0]}" data-date="${group.dutyDate}">ขอแลกเวร</button>`;

    return `
      <tr>
        <td>${dateCell(group.dutyDate)}</td>
        <td class="mono">${DUTY_SLOT.label}</td>
        <td>
          ${group.assignedBySystem
            ? '<span class="pill info">ระบบจัดให้</span>'
            : `<span class="pill ${STATUS_PILL[group.status]}">${STATUS_LABEL[group.status]}</span>`}
          ${swap ? `<br><span class="pill info">รอ ${escapeHtml(swap.to_nurse?.full_name ?? '')} ตอบรับ</span>` : ''}
        </td>
        <td><div class="row" style="flex-wrap:wrap">${actions}</div></td>
      </tr>
    `;
  }).join('');
}

function renderHistory(groups) {
  if (!groups.length) {
    dom.history.innerHTML = '<tr><td colspan="3" class="empty">ยังไม่มีประวัติ</td></tr>';
    return;
  }
  dom.history.innerHTML = groups.slice(0, HISTORY_LIMIT).map((group) => `
    <tr>
      <td>${dateCell(group.dutyDate)}</td>
      <td class="mono">${DUTY_SLOT.label}</td>
      <td>${group.assignedBySystem
        ? '<span class="pill info">ระบบจัดให้</span>'
        : `<span class="pill ${STATUS_PILL[group.status]}">${STATUS_LABEL[group.status]}</span>`}</td>
    </tr>
  `).join('');
}

function renderOffDays(offDays) {
  if (!offDays.length) {
    dom.offBody.innerHTML = '<tr><td colspan="3" class="empty">ยังไม่ได้แจ้งวัน OFF</td></tr>';
    return;
  }
  const today = todayKey();
  dom.offBody.innerHTML = offDays.map((row) => `
    <tr>
      <td>${dateCell(row.off_date)}</td>
      <td>${row.reason ? escapeHtml(row.reason) : '<span class="muted">—</span>'}</td>
      <td>
        ${row.off_date >= today
          ? `<button class="btn btn-sm btn-ghost" data-action="cancel-off" data-id="${row.id}">ยกเลิก</button>`
          : '<span class="caption">ผ่านไปแล้ว</span>'}
      </td>
    </tr>
  `).join('');
}

function renderIncoming(requests) {
  if (!requests.length) {
    dom.incoming.innerHTML = '<p class="empty">ไม่มีคำขอแลกเวรที่ต้องตอบ</p>';
    return;
  }
  dom.incoming.innerHTML = requests.map((request) => `
    <div class="alert info" style="align-items:center">
      <div style="flex:1">
        <strong>${escapeHtml(request.from_nurse?.full_name ?? '')}</strong>
        ขอให้คุณปฏิบัติงานแทนในวันที่ ${formatThaiDateFull(request.shift.duty_date)}
        ${request.offer
          ? `<br><span class="caption">แลกกับเวรของคุณวันที่ ${formatThaiDateFull(request.offer.duty_date)}</span>`
          : '<br><span class="caption">ไม่มีการแลกกลับ</span>'}
        ${request.reason ? `<br><span class="caption">เหตุผล: ${escapeHtml(request.reason)}</span>` : ''}
      </div>
      <button class="btn btn-sm btn-primary" data-action="accept" data-id="${request.id}">รับเวร</button>
      <button class="btn btn-sm btn-ghost" data-action="decline" data-id="${request.id}">ปฏิเสธ</button>
    </div>
  `).join('');
}

async function refresh() {
  dom.alert.classList.add('hidden');
  const today = todayKey();

  try {
    const [shifts, offDays, incoming, outgoing] = await Promise.all([
      loadNurseShifts(session.nurse.id),
      loadNurseOffDays(session.nurse.id),
      loadIncomingSwaps(session.nurse.id),
      loadOutgoingSwaps(session.nurse.id),
    ]);

    const groups = groupByDay(shifts);
    renderUpcoming(groups.filter((group) => group.dutyDate >= today), outgoing);
    renderHistory(groups.filter((group) => group.dutyDate < today).reverse());
    renderOffDays(offDays);
    renderIncoming(incoming);
  } catch (error) {
    showAlert(humanError(error, 'โหลดข้อมูลไม่สำเร็จ'));
  }
}

// ---------- ขอแลกเวร ----------

/** โหลดเวรในอนาคตของอีกฝ่าย ให้เลือกว่าจะไปขึ้นแทนวันไหน */
async function refreshOfferOptions() {
  const nurseId = dom.swapNurse.value;
  dom.swapOffer.innerHTML = '<option value="">— กำลังโหลด… —</option>';
  if (!nurseId) return;

  try {
    const shifts = await loadUpcomingShiftsOf(nurseId, todayKey());
    dom.swapOffer.innerHTML = [
      '<option value="">— ไม่แลกกลับ (ยกเวรให้เฉยๆ) —</option>',
      ...shifts.map((shift) =>
        `<option value="${shift.id}">${escapeHtml(formatThaiDateFull(shift.duty_date))}</option>`),
    ].join('');
  } catch (error) {
    dom.swapOffer.innerHTML = '<option value="">— โหลดเวรของอีกฝ่ายไม่สำเร็จ —</option>';
    console.warn('[duty-roster]', error);
  }
}

async function openSwapDialog(shiftId, dutyDate) {
  swapTargetShiftId = shiftId;
  dom.swapSub.textContent = `เวรวันที่ ${formatThaiDateFull(dutyDate)}`;
  dom.swapReason.value = '';
  dom.swapError.classList.add('hidden');
  dom.swapNurse.innerHTML = colleagues
    .map((nurse) => `<option value="${nurse.id}">${escapeHtml(nurse.full_name)}</option>`)
    .join('');
  dom.backdrop.classList.remove('hidden');
  dom.swapNurse.focus();
  await refreshOfferOptions();
}

async function sendSwap() {
  if (!swapTargetShiftId || !dom.swapNurse.value) return;

  dom.swapSend.disabled = true;
  dom.swapSend.textContent = 'กำลังส่ง…';

  try {
    await createSwapRequest({
      shiftId: swapTargetShiftId,
      fromNurseId: session.nurse.id,
      toNurseId: dom.swapNurse.value,
      offerShiftId: dom.swapOffer.value || null,
      reason: dom.swapReason.value.trim(),
    });
    dom.backdrop.classList.add('hidden');
    toast('ส่งคำขอแลกเวรแล้ว — พิมพ์ใบแลกเวรได้ที่เมนู "ใบแลกเวร"', 'success');
    await refresh();
  } catch (error) {
    dom.swapError.textContent = humanError(error, 'ส่งคำขอไม่สำเร็จ');
    dom.swapError.classList.remove('hidden');
  } finally {
    dom.swapSend.disabled = false;
    dom.swapSend.textContent = 'ส่งคำขอ';
  }
}

// ---------- Event ----------

dom.upcoming.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action } = button.dataset;

  if (action === 'swap') {
    await openSwapDialog(button.dataset.id, button.dataset.date);
    return;
  }

  button.disabled = true;
  try {
    if (action === 'cancel') {
      if (!window.confirm('ยกเลิกการจองเวรวันนี้ใช่หรือไม่? วันนี้จะไม่มีผู้ปฏิบัติงานทันที')) {
        button.disabled = false;
        return;
      }
      await cancelShifts(button.dataset.ids.split(',').filter(Boolean));
      toast('ยกเลิกการจองแล้ว', 'success');
    } else if (action === 'cancel-swap') {
      await cancelSwapRequest(button.dataset.id);
      toast('ยกเลิกคำขอแลกเวรแล้ว', 'success');
    }
    await refresh();
  } catch (error) {
    toast(humanError(error, 'ทำรายการไม่สำเร็จ'), 'error');
    button.disabled = false;
  }
});

dom.offBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="cancel-off"]');
  if (!button) return;

  button.disabled = true;
  try {
    await cancelOffDay(button.dataset.id);
    toast('ยกเลิกวัน OFF แล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'ยกเลิกไม่สำเร็จ'), 'error');
    button.disabled = false;
  }
});

dom.incoming.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const accept = button.dataset.action === 'accept';
  if (accept && !window.confirm('รับเวรนี้แทนใช่หรือไม่? เวรจะถูกโอนมาเป็นของคุณทันที')) return;

  button.disabled = true;
  try {
    await respondToSwap(button.dataset.id, accept);
    toast(accept ? 'รับเวรเรียบร้อย' : 'ปฏิเสธคำขอแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(humanError(error, 'ตอบคำขอไม่สำเร็จ'), 'error');
    button.disabled = false;
  }
});

dom.swapNurse.addEventListener('change', refreshOfferOptions);
dom.swapSend.addEventListener('click', sendSwap);
dom.swapCancel.addEventListener('click', () => dom.backdrop.classList.add('hidden'));
dom.backdrop.addEventListener('click', (event) => {
  if (event.target === dom.backdrop) dom.backdrop.classList.add('hidden');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dom.backdrop.classList.add('hidden');
});

async function boot() {
  if (!isConfigured()) {
    renderSetupNotice(document.getElementById('main'));
    return;
  }

  session = await requireSession();
  if (!session) return;

  renderShell({ mount: dom.shell, current: 'my.html', session });
  await enforcePinChange(session);

  colleagues = await loadColleagues(session.nurse.id);
  await refresh();
}

boot().catch((error) => showAlert(humanError(error, 'เปิดหน้าไม่สำเร็จ')));
