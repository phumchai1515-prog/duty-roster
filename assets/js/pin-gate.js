/**
 * pin-gate.js — บังคับเปลี่ยน PIN เมื่อเข้าใช้งานครั้งแรก
 * เรียกหลังได้ session แล้ว ในทุกหน้าที่ต้องล็อกอิน
 */
import { changePin, validatePin } from './auth.js';
import { humanError } from './supabase.js';
import { PIN_LENGTH } from './config.js';

/**
 * ถ้าพยาบาลยังไม่เคยเปลี่ยน PIN จะขึ้นกล่องบังคับเปลี่ยนและค้างไว้จนกว่าจะสำเร็จ
 * @returns {Promise<void>} resolve เมื่อผ่านด่านแล้ว
 */
export function enforcePinChange(session) {
  if (!session?.nurse?.must_change_pin) return Promise.resolve();

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'pin-gate-backdrop';
    backdrop.innerHTML = `
      <div class="pin-gate" role="dialog" aria-modal="true" aria-labelledby="pin-gate-title">
        <h2 id="pin-gate-title">ตั้งรหัส PIN ใหม่</h2>
        <p class="caption">เพื่อความปลอดภัย กรุณาเปลี่ยนจาก PIN ตั้งต้นก่อนเริ่มใช้งาน</p>

        <div id="pin-gate-error" class="alert error hidden" role="alert"></div>

        <div class="field">
          <label for="pin-new">รหัส PIN ใหม่ (${PIN_LENGTH} หลัก)</label>
          <input id="pin-new" type="password" inputmode="numeric" maxlength="${PIN_LENGTH}"
                 autocomplete="new-password" class="pin-input mono" placeholder="••••••">
        </div>
        <div class="field">
          <label for="pin-confirm">ยืนยันรหัส PIN ใหม่</label>
          <input id="pin-confirm" type="password" inputmode="numeric" maxlength="${PIN_LENGTH}"
                 autocomplete="new-password" class="pin-input mono" placeholder="••••••">
        </div>

        <button class="btn btn-primary btn-block" id="pin-save" type="button">บันทึกรหัส PIN</button>
      </div>
    `;
    document.body.append(backdrop);

    const newInput = backdrop.querySelector('#pin-new');
    const confirmInput = backdrop.querySelector('#pin-confirm');
    const saveBtn = backdrop.querySelector('#pin-save');
    const errorBox = backdrop.querySelector('#pin-gate-error');

    const showError = (message) => {
      errorBox.textContent = message;
      errorBox.classList.remove('hidden');
    };

    for (const input of [newInput, confirmInput]) {
      input.addEventListener('input', () => {
        const digitsOnly = input.value.replace(/\D/g, '');
        if (input.value !== digitsOnly) input.value = digitsOnly;
      });
    }

    saveBtn.addEventListener('click', async () => {
      errorBox.classList.add('hidden');

      const pin = newInput.value;
      const invalid = validatePin(pin);
      if (invalid) return showError(invalid);
      if (pin !== confirmInput.value) return showError('รหัส PIN ทั้งสองช่องไม่ตรงกัน');
      if (/^(\d)\1+$/.test(pin)) return showError('อย่าใช้เลขซ้ำกันทั้งหมด เช่น 111111');
      if (pin === '123456' || pin === '654321') return showError('รหัส PIN นี้เดาง่ายเกินไป');

      saveBtn.disabled = true;
      saveBtn.textContent = 'กำลังบันทึก…';

      try {
        const updated = await changePin(pin);
        Object.assign(session.nurse, updated.nurse);
        backdrop.remove();
        resolve();
      } catch (error) {
        showError(humanError(error, 'เปลี่ยนรหัส PIN ไม่สำเร็จ'));
        saveBtn.disabled = false;
        saveBtn.textContent = 'บันทึกรหัส PIN';
      }
    });

    newInput.focus();
  });
}
