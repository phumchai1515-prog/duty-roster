/**
 * swap-document.js — สร้าง HTML ของ "ใบแลกเวร" F–NU–005 (ฟังก์ชันบริสุทธิ์)
 *
 * รูปแบบต้องตรงกับแบบฟอร์มกระดาษเดิมทุกบรรทัด
 * ช่องที่ยังไม่มีข้อมูลให้เป็นเส้นประเปล่า เพื่อเขียนด้วยมือได้
 */
import { toThaiDigits, MONTHS_TH, parseDateKey, toBuddhistYear } from './thai.js';
import { escapeHtml } from './ui.js';

const DEFAULT_ORG = 'โรงพยาบาลจิตเวชเลยราชนครินทร์';
const DUTY_WORD = 'ตรวจการ';

/** ช่องเติมข้อความ — มีค่าก็แสดงค่า ไม่มีก็เป็นเส้นประให้เขียนมือ */
function blank(value, { width = '6cm', center = true } = {}) {
  const text = value == null || value === '' ? '' : escapeHtml(String(value));
  return `<span class="fill${center ? ' fill-center' : ''}" style="min-width:${width}">${text}</span>`;
}

/** แยกวันที่เป็น 3 ช่อง วัน / เดือน / พ.ศ. ตามฟอร์ม */
function dateParts(key) {
  if (!key) return { day: '', month: '', year: '' };
  const { year, month, day } = parseDateKey(key);
  return {
    day: toThaiDigits(day),
    month: MONTHS_TH[month - 1],
    year: toThaiDigits(toBuddhistYear(year)),
  };
}

/**
 * @param {object} form
 * @param {string} form.organizationName
 * @param {string} form.writtenOn        วันที่เขียนใบ (YYYY-MM-DD)
 * @param {string} form.requesterName    ผู้ขอแลกเวร
 * @param {string} form.requesterRole    ตำแหน่ง
 * @param {string} form.absentDate       วันที่มาปฏิบัติงานไม่ได้
 * @param {string} form.replacementName  ผู้ที่จะขึ้นเวรแทน
 * @param {string} form.returnForName    ผู้ที่ผู้ขอจะไปขึ้นเวรแทน
 * @param {string} form.returnDate       วันที่ผู้ขอจะไปขึ้นเวรแทน
 */
export function renderSwapForm(form = {}) {
  const written = dateParts(form.writtenOn);
  const absent = dateParts(form.absentDate);
  const back = dateParts(form.returnDate);

  return `
    <h1 class="swap-title">ใบแลกเวร</h1>
    <p class="swap-org">${escapeHtml(form.organizationName || DEFAULT_ORG)}</p>

    <p class="swap-date-line">
      วันที่ ${blank(written.day, { width: '2cm' })}
      เดือน ${blank(written.month, { width: '4.5cm' })}
      พ.ศ. ${blank(written.year, { width: '2.5cm' })}
    </p>

    <p class="swap-to"><strong>เรียน หัวหน้ากลุ่มภารกิจการพยาบาล</strong></p>

    <div class="swap-body">
      <p class="indent">
        ข้าพเจ้า (นาย,นาง,นางสาว) ${blank(form.requesterName, { width: '8cm' })}
        ตำแหน่ง ${blank(form.requesterRole, { width: '5cm' })}
      </p>
      <p>
        มีธุระจำเป็นไม่สามารถมาปฏิบัติงานใน วันที่
        ${blank(absent.day && `${absent.day} ${absent.month} ${absent.year}`, { width: '7cm' })}
        เวร <span class="preset">${DUTY_WORD}</span> ได้ จึงขอแลกเวรโดยให้
      </p>
      <p>
        (นาย,นาง,นางสาว) ${blank(form.replacementName, { width: '9cm' })}
        ขึ้นเวร <span class="preset">${DUTY_WORD}</span> แทน และจะขึ้นเวรแทน
      </p>
      <p>
        (นาย,นาง,นางสาว) ${blank(form.returnForName, { width: '7cm' })}
        ในเวร <span class="preset">${DUTY_WORD}</span>
        วันที่ ${blank(back.day, { width: '1.6cm' })}
        เดือน ${blank(back.month, { width: '3.6cm' })}
        พ.ศ. ${blank(back.year, { width: '2cm' })}
      </p>
    </div>

    <div class="swap-signs">
      <p>ลงนาม ผู้ขอแลกเวร ${blank('', { width: '7cm' })}</p>
      <p>ลงนาม ผู้รับแลกเวร ${blank('', { width: '7cm' })}</p>
    </div>

    <div class="swap-approve">
      <div class="swap-approve-col">
        <p>ลงชื่อ ${blank('', { width: '6cm' })} (หัวหน้างาน)</p>
        <p class="paren">( ${blank('', { width: '5.5cm' })} )</p>
      </div>
      <div class="swap-approve-col">
        <p>ผู้อนุญาต ${blank('', { width: '6cm' })} (หัวหน้ากลุ่มงาน)</p>
        <p class="paren">( ${blank('', { width: '5.5cm' })} )</p>
      </div>
    </div>

    <p class="swap-code">F – NU – 005</p>
  `;
}
