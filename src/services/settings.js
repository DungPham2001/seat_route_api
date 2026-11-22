/**
 * Singleton settings of the one operator (OperatorProfile, CancelPolicyTier, OperatorRule, Setting,
 * MemberTier...). Each key is one document in `settings`; reads merge stored values over defaults.
 */
const config = require('../config');
const { Setting } = require('../models');
const tenant = require('../lib/tenant');
const { Checker } = require('../lib/validate');
const { invalid, notFound } = require('../lib/errors');
const { iso } = require('../lib/util');

const D = config.defaults;

const DEFAULTS = {
  operator: {
    name: '', description: '', phone: '', email: '', address: '', openText: '',
    representativeName: '', licenseNoText: '', taxCode: '', website: '',
  },
  cancelPolicy: {
    tiers: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 70 }, { hoursBefore: 2, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }],
    cancelFee: 10000,
    changeAllowedHoursBefore: 4,
    changeFee: 0,
    note: '',
  },
  rules: { items: [] }, // [{ kind: luggage|food|pets|children|other, text }]
  system: {
    bookingLeadHours: D.bookingLeadHours,
    maxSeatsPerBooking: D.maxSeatsPerBooking,
    bookDaysAhead: D.bookDaysAhead,
    reviewDeadlineMinutes: D.reviewDeadlineMinutes,
    driverRestMinutes: D.driverRestMinutes,
    salesOpenDaysBefore: D.salesOpenDaysBefore,
    salesCloseMinutesBefore: D.salesCloseMinutesBefore,
    lowFillPercent: 30,
  },
  shuttle: { registerHoursBefore: D.shuttleRegisterHoursBefore, feeRefundable: D.shuttleFeeRefundable, note: '' },
  loyalty: {
    enabled: true,
    earnPointsPer10k: 1, // points = total / 10000 when the booking is approved; never converted to cash
    tiers: [
      { name: 'Thành viên', minPoints: 0, benefitText: '' },
      { name: 'Bạc', minPoints: 80, benefitText: '' },
      { name: 'Vàng', minPoints: 200, benefitText: '' },
      { name: 'Kim cương', minPoints: 500, benefitText: '' },
    ],
  },
  referral: { enabled: false, referrerPromotionId: null, referredPromotionId: null, maxPerReferrer: 20 },
  parcel: {
    enabled: true,
    acceptHoursBefore: D.parcelAcceptHoursBefore,
    unclaimedHours: D.parcelUnclaimedHours,
    defaultMaxKg: D.parcelDefaultMaxKg,
    defaultMaxPieces: D.parcelDefaultMaxPieces,
    maxWeightKgPerOrder: 50,
    sizeClasses: [
      { code: 'small', label: 'Nhỏ', maxDimText: 'Dưới 30 x 30 x 30 cm' },
      { code: 'medium', label: 'Vừa', maxDimText: 'Dưới 50 x 50 x 50 cm' },
      { code: 'large', label: 'Lớn', maxDimText: 'Dưới 80 x 60 x 60 cm' },
    ],
    cancelAfterReceivePercent: 50,
    maxCompensationMultiple: 5,
    claimDays: 7,
    compensationText: '',
    note: '',
  },
  content: { termsVi: '', termsEn: '', privacyVi: '', privacyEn: '', helpVi: '', helpEn: '', aboutVi: '', aboutEn: '' },
};

const KEYS = Object.keys(DEFAULTS);

// ---------- validators (one per key; partial updates merge into the stored value) ----------

const V = {
  operator(c, b) {
    const o = {};
    for (const [k, max] of [['name', 120], ['description', 3000], ['address', 300], ['openText', 200], ['representativeName', 80], ['licenseNoText', 80], ['taxCode', 30], ['website', 200]]) {
      if (b[k] !== undefined) o[k] = c.str(b, k, { max }) || '';
    }
    if (b.phone !== undefined) o.phone = c.phone(b, 'phone') || '';
    if (b.email !== undefined) o.email = c.email(b, 'email') || '';
    return o;
  },
  cancelPolicy(c, b) {
    const o = {};
    if (b.tiers !== undefined) {
      const arr = c.arr(b, 'tiers', { max: 10 }) || [];
      o.tiers = arr.map((t, i) => ({
        hoursBefore: c.int(t, 'hoursBefore', { field: `tiers[${i}].hoursBefore`, required: true, max: 720 }),
        refundPercent: c.int(t, 'refundPercent', { field: `tiers[${i}].refundPercent`, required: true, max: 100 }),
      })).sort((x, y) => y.hoursBefore - x.hoursBefore);
    }
    for (const k of ['cancelFee', 'changeFee']) if (b[k] !== undefined) o[k] = c.money(b, k) ?? 0;
    if (b.changeAllowedHoursBefore !== undefined) o.changeAllowedHoursBefore = c.int(b, 'changeAllowedHoursBefore', { max: 720 }) ?? 0;
    if (b.note !== undefined) o.note = c.str(b, 'note', { max: 2000 }) || '';
    return o;
  },
  rules(c, b) {
    const arr = c.arr(b, 'items', { required: true, max: 30 }) || [];
    return {
      items: arr.map((t, i) => ({
        kind: c.oneOf(t, 'kind', ['luggage', 'food', 'pets', 'children', 'other'], { field: `items[${i}].kind`, required: true }),
        text: c.str(t, 'text', { field: `items[${i}].text`, required: true, max: 2000 }),
      })),
    };
  },
  system(c, b) {
    const o = {};
    const ints = {
      bookingLeadHours: [0, 72], maxSeatsPerBooking: [1, 16], bookDaysAhead: [1, 60], reviewDeadlineMinutes: [5, 2880],
      driverRestMinutes: [0, 1440], salesOpenDaysBefore: [1, 365], salesCloseMinutesBefore: [0, 1440], lowFillPercent: [0, 100],
    };
    for (const [k, [min, max]] of Object.entries(ints)) if (b[k] !== undefined) o[k] = c.int(b, k, { required: true, min, max });
    return o;
  },
  shuttle(c, b) {
    const o = {};
    if (b.registerHoursBefore !== undefined) o.registerHoursBefore = c.int(b, 'registerHoursBefore', { required: true, max: 72 });
    if (b.feeRefundable !== undefined) o.feeRefundable = c.bool(b, 'feeRefundable', { required: true });
    if (b.note !== undefined) o.note = c.str(b, 'note', { max: 1000 }) || '';
    return o;
  },
  loyalty(c, b) {
    const o = {};
    if (b.enabled !== undefined) o.enabled = c.bool(b, 'enabled', { required: true });
    if (b.earnPointsPer10k !== undefined) o.earnPointsPer10k = c.num(b, 'earnPointsPer10k', { required: true, max: 1000 });
    if (b.tiers !== undefined) {
      const arr = c.arr(b, 'tiers', { max: 10 }) || [];
      o.tiers = arr.map((t, i) => ({
        name: c.str(t, 'name', { field: `tiers[${i}].name`, required: true, max: 40 }),
        minPoints: c.int(t, 'minPoints', { field: `tiers[${i}].minPoints`, required: true }),
        benefitText: c.str(t, 'benefitText', { field: `tiers[${i}].benefitText`, max: 500 }) || '',
      })).sort((x, y) => x.minPoints - y.minPoints);
    }
    return o;
  },
  referral(c, b) {
    const o = {};
    if (b.enabled !== undefined) o.enabled = c.bool(b, 'enabled', { required: true });
    for (const k of ['referrerPromotionId', 'referredPromotionId']) if (b[k] !== undefined) o[k] = c.id(b, k) || null;
    if (b.maxPerReferrer !== undefined) o.maxPerReferrer = c.int(b, 'maxPerReferrer', { required: true, max: 1000 });
    return o;
  },
  parcel(c, b) {
    const o = {};
    if (b.enabled !== undefined) o.enabled = c.bool(b, 'enabled', { required: true });
    const ints = { acceptHoursBefore: 72, unclaimedHours: 720, defaultMaxPieces: 1000, cancelAfterReceivePercent: 100, maxCompensationMultiple: 100, claimDays: 365 };
    for (const [k, max] of Object.entries(ints)) if (b[k] !== undefined) o[k] = c.int(b, k, { required: true, max });
    for (const k of ['defaultMaxKg', 'maxWeightKgPerOrder']) if (b[k] !== undefined) o[k] = c.num(b, k, { required: true, min: 0.1, max: 10000 });
    if (b.sizeClasses !== undefined) {
      const arr = c.arr(b, 'sizeClasses', { max: 3 }) || [];
      o.sizeClasses = arr.map((t, i) => ({
        code: c.oneOf(t, 'code', ['small', 'medium', 'large'], { field: `sizeClasses[${i}].code`, required: true }),
        label: c.str(t, 'label', { field: `sizeClasses[${i}].label`, required: true, max: 40 }),
        maxDimText: c.str(t, 'maxDimText', { field: `sizeClasses[${i}].maxDimText`, max: 100 }) || '',
      }));
    }
    for (const k of ['compensationText', 'note']) if (b[k] !== undefined) o[k] = c.str(b, k, { max: 3000 }) || '';
    return o;
  },
  content(c, b) {
    const o = {};
    for (const k of Object.keys(DEFAULTS.content)) if (b[k] !== undefined) o[k] = c.str(b, k, { max: 50000, trim: false }) || '';
    return o;
  },
};

// ---------- read / write ----------

const cache = new Map(); // operatorId -> { at, values }
const TTL = 5000;

/** Each operator has its own settings: document `_id` is "<operatorId>:<key>" (plain "<key>" without an operator). */
const idOf = (key) => (tenant.current() ? `${tenant.current()}:${key}` : key);

async function all() {
  const op = tenant.current() || '';
  const hit = cache.get(op);
  if (hit && Date.now() - hit.at < TTL) return hit.values;
  const rows = await Setting.find({ _id: { $in: KEYS.map(idOf) } }).lean();
  const stored = Object.fromEntries(rows.map((r) => [r._id, r]));
  const values = {};
  for (const k of KEYS) values[k] = { ...DEFAULTS[k], ...(stored[idOf(k)]?.value || {}), updatedAt: iso(stored[idOf(k)]?.updatedAt) };
  cache.set(op, { at: Date.now(), values });
  return values;
}

const get = async (key) => (await all())[key];

async function update(key, body, accountId) {
  if (!V[key]) throw notFound();
  const c = new Checker();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalid([{ field: 'body', code: 'invalid_type' }]);
  const patch = V[key](c, body);
  c.done();
  const current = await Setting.findById(idOf(key)).lean();
  const value = { ...(current?.value || {}), ...patch };
  await Setting.updateOne({ _id: idOf(key) }, { $set: { value, updatedBy: accountId, updatedAt: new Date() } }, { upsert: true });
  cache.delete(tenant.current() || '');
  return get(key);
}

const clearCache = () => cache.clear();

module.exports = { get, all, update, KEYS, DEFAULTS, clearCache };
