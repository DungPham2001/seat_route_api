/**
 * Local time of the operator (fixed timezone, config.timezone). Trips are stored as a UTC instant (`departAt`)
 * and presented with their local date/time and the UTC offset ("+07:00").
 */
const config = require('../config');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parts(date, tz = config.timezone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
}

/** Offset of `tz` at `date`, in minutes (Asia/Ho_Chi_Minh -> 420). */
function offsetMinutes(date = new Date(), tz = config.timezone) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const fmtOffset = (m) => `${m < 0 ? '-' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}`;

/** "2026-11-20", "07:30" (local) -> Date (UTC instant). */
function localToUtc(dateStr, timeStr = '00:00', tz = config.timezone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = offsetMinutes(new Date(guess), tz);
  const t = guess - off * 60000;
  const off2 = offsetMinutes(new Date(t), tz); // DST edge (not used in VN, kept correct)
  return new Date(guess - off2 * 60000);
}

/** Date -> { date: "2026-11-20", time: "07:30", local: "2026-11-20T07:30", offset: "+07:00" } */
function toLocal(date) {
  if (!date) return null;
  const d = new Date(date);
  const p = parts(d);
  const dateStr = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  return { date: dateStr, time, local: `${dateStr}T${time}`, offset: fmtOffset(offsetMinutes(d)) };
}

const today = () => toLocal(new Date()).date;

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a local date string. */
const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

/** [start, end) of a local day as UTC instants. */
const dayRange = (dateStr) => [localToUtc(dateStr, '00:00'), localToUtc(addDays(dateStr, 1), '00:00')];

const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isTime = (s) => typeof s === 'string' && TIME_RE.test(s);

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const addMinutes = (date, m) => new Date(new Date(date).getTime() + m * 60000);

/** First day of the local month / week (Monday) containing dateStr. */
const monthStart = (dateStr) => `${dateStr.slice(0, 7)}-01`;
const weekStart = (dateStr) => addDays(dateStr, -((weekday(dateStr) + 6) % 7));

module.exports = { localToUtc, toLocal, today, addDays, weekday, dayRange, isDate, isTime, minutesOf, hhmm, addMinutes, offsetMinutes, fmtOffset, monthStart, weekStart };
