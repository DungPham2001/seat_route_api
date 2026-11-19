/**
 * VietQR (NAPAS interbank transfer QR, EMVCo format) payload built on the server (features 48, 49, 204).
 * The app only draws this string as a QR code; it never scans. Content = order code (ASCII, no accents).
 */

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase hex, 4 chars. */
function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Only characters every bank app accepts in the transfer content. */
const cleanContent = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D')
  .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);

/**
 * @param {{ bin: string, accountNo: string, amount?: number, content?: string }} p
 * @returns {string} payload to encode as a QR code
 */
function buildPayload({ bin, accountNo, amount, content }) {
  const beneficiary = tlv('00', String(bin)) + tlv('01', String(accountNo));
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amount) s += tlv('54', String(Math.round(amount)));
  s += tlv('58', 'VN');
  const text = cleanContent(content);
  if (text) s += tlv('62', tlv('08', text));
  s += '6304';
  return s + crc16(s);
}

module.exports = { buildPayload, crc16, cleanContent };
