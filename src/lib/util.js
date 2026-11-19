const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('crypto');
const config = require('../config');

const uuid = () => randomUUID();
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Human-typable codes (reset code, invite code): no 0/O/1/I. 8 chars of 32 symbols = 40 bits. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function humanCode(len = 8) {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i += 1) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
/** "abcd-efgh " -> "ABCDEFGH" */
const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Vietnamese-insensitive normalization (bỏ dấu, chữ thường), same rule as the app's nameNoAccent. */
const noAccent = (s) => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .toLowerCase()
  .trim();

/** Today as yyyy-MM-dd in the business timezone. */
function today(tz = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** "1.10.2" >= "1.9" ? Missing parts count as 0; non-numeric suffixes ignored. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Vietnamese phone number used as a login: "0901 234 567", "+84 901234567", "84901234567" -> "0901234567".
 * Returns null when it is not a plausible number (10-11 digits starting with 0 after normalization).
 */
function normalizePhone(s) {
  if (typeof s !== 'string') return null;
  let d = s.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('84') && d.length >= 11) d = `0${d.slice(2)}`;
  return /^0\d{9,10}$/.test(d) ? d : null;
}

const iso = (d) => (d ? new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);

module.exports = { uuid, sha256, randomToken, humanCode, normalizeCode, safeEqual, noAccent, today, compareVersions, iso, normalizePhone };
