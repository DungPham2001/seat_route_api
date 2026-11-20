/**
 * One price engine for booking, the order summary (quote) and counter bookings:
 *   total = seat prices (+ seasonal) + seat-class surcharges (front / vip, from the vehicle) + shuttle fees - promo code.
 * Computed once at the end; the order-level discount is spread over seats with the remainder on the last seat
 * so that the seat lines always add up to the total.
 */
const { Promotion, SeasonalPrice, Voucher, Booking, ShuttleZone } = require('../models');
const { AppError, invalid } = require('../lib/errors');
const settings = require('./settings');
const { officeStop, officeTime } = require('./routes');
const { addMinutes } = require('../lib/time');

async function seasonalFor(trip) {
  return SeasonalPrice.find({
    isActive: true, fromDate: { $lte: trip.date }, toDate: { $gte: trip.date }, $or: [{ routeId: null }, { routeId: trip.routeId }],
  }).lean();
}

function applySeasonal(price, rows) {
  let p = price;
  for (const s of rows) p += s.adjustKind === 'percent' ? Math.round((price * s.adjustValue) / 100) : s.adjustValue;
  return Math.max(0, p);
}

/** Seat classes: standard, front (hàng đầu) and vip. The surcharge of front / vip is copied from the vehicle onto the trip. */
const CLASS_NAMES = { standard: 'Ghế thường', front: 'Hàng đầu', vip: 'Ghế VIP' };

/** Price of one seat class on a trip: { seatPrice, surcharge }. Booked prices are stored in the booking and never change. */
function classPrice(trip, seatClass, _unused, seasonal) {
  const base = (trip.prices || []).find((p) => p.seatClass === seatClass)?.price ?? trip.basePrice;
  const surcharge = seatClass === 'front' ? trip.frontSurcharge || 0 : seatClass === 'vip' ? trip.vipSurcharge || 0 : 0;
  return { seatPrice: applySeasonal(base, seasonal), surcharge };
}

/** Lowest price for a seat on the trip (search list). */
function minPrice(trip, classesOnTrip, seatClasses, seasonal) {
  const list = (classesOnTrip.length ? classesOnTrip : ['standard']).map((c) => {
    const p = classPrice(trip, c, seatClasses, seasonal);
    return p.seatPrice + p.surcharge;
  });
  return Math.min(...list);
}

const promoError = (code) => new AppError(409, code, { fields: [{ field: 'promoCode', code }] });

/** Checks a promo code for this account and subtotal; returns the promotion (+ voucher) or throws. */
async function checkPromo(code, { accountId, subtotal, routeId, now = new Date() }) {
  const promo = await Promotion.findOne({ code: String(code).trim().toUpperCase() }).lean();
  if (!promo || !promo.isActive) throw promoError('promo_invalid');
  if ((promo.startAt && now < promo.startAt) || (promo.endAt && now > promo.endAt)) throw promoError('promo_expired');
  if (promo.routeId && promo.routeId !== routeId) throw promoError('promo_invalid');
  if (promo.usageLimit && promo.usedCount >= promo.usageLimit) throw promoError('promo_used_up');
  if (subtotal < (promo.minAmount || 0)) throw new AppError(409, 'promo_min_amount', { minAmount: promo.minAmount, fields: [{ field: 'promoCode', code: 'promo_min_amount' }] });
  let voucher = null;
  if (accountId) {
    voucher = await Voucher.findOne({ accountId, promotionId: promo._id, status: 'active' }).lean();
    if (promo.audience === 'wallet' && !voucher) throw promoError('promo_invalid');
    const used = await Booking.countDocuments({ customerAccountId: accountId, promotionId: promo._id, status: { $nin: ['cancelled', 'rejected'] } });
    if (used >= (promo.perUserLimit || 1)) throw promoError('promo_used_up');
  } else if (promo.audience === 'wallet') throw promoError('promo_invalid');
  return { promo, voucher };
}

function promoDiscount(promo, subtotal) {
  let d = promo.kind === 'percent' ? Math.round((subtotal * promo.value) / 100) : promo.value;
  if (promo.maxDiscount) d = Math.min(d, promo.maxDiscount);
  return Math.max(0, Math.min(d, subtotal));
}

/**
 * Shuttle choice for one direction -> the stored ShuttleRequest-like object, or throws.
 * Pickup: the shuttle picks the customer up at home and brings them to the pickup office, `leadMinutes` before the
 * bus reaches it. Drop: from the drop office to the customer's address, `dropMinutes` after the bus arrives.
 */
async function shuttleFor(direction, input, { trip, route, officeId, now = new Date(), enforceDeadline = true }) {
  const field = direction === 'pickup' ? 'pickupShuttle' : 'dropShuttle';
  if (route.shuttleEnabled === false) throw new AppError(409, 'shuttle_unavailable', { fields: [{ field, code: 'shuttle_unavailable' }] });
  const zone = await ShuttleZone.findById(input.zoneId).lean();
  const enabled = direction === 'pickup' ? zone?.pickupEnabled : zone?.dropEnabled;
  if (!zone || !zone.isActive || zone.officeId !== officeId || !enabled) {
    throw new AppError(409, 'shuttle_unavailable', { fields: [{ field: `${field}.zoneId`, code: 'shuttle_unavailable' }] });
  }
  const rules = await settings.get('shuttle');
  if (enforceDeadline && now > addMinutes(trip.departAt, -rules.registerHoursBefore * 60)) {
    throw new AppError(409, 'shuttle_deadline_passed', { deadline: addMinutes(trip.departAt, -rules.registerHoursBefore * 60).toISOString() });
  }
  const stop = officeStop(route, officeId, direction);
  const at = officeTime(trip.departAt, stop) || trip.departAt;
  const plannedAt = direction === 'pickup' ? addMinutes(at, -(zone.leadMinutes || 0)) : addMinutes(at, zone.dropMinutes || 0);
  return {
    id: input.id || require('../lib/util').uuid(),
    direction, officeId, zoneId: zone._id, zoneName: zone.name, addressText: input.addressText, noteText: input.noteText || '',
    fee: zone.fee || 0, plannedAt, status: 'pending', updatedAt: now,
  };
}

/** Reads `{ zoneId, addressText, noteText }` (or a saved address id) for one direction. */
function readShuttle(c, body, key) {
  const v = body?.[key];
  if (v === undefined || v === null || v === false) return null;
  const o = c.obj(body, key);
  if (!o) return null;
  const zoneId = c.id(o, 'zoneId', { field: `${key}.zoneId`, required: true });
  const addressText = c.str(o, 'addressText', { field: `${key}.addressText`, required: true, max: 300 });
  const noteText = c.str(o, 'noteText', { field: `${key}.noteText`, max: 300 }) || '';
  return { zoneId, addressText, noteText };
}

/**
 * @param {object} p
 * @param {object} p.trip, p.route
 * @param {Array<{seatId, seatClass, isChild}>} p.seats  seats already resolved against the trip
 * @param {object|null} p.pickupShuttle, p.dropShuttle  results of shuttleFor
 * @param {string|null} p.promoCode
 * @param {number} p.usePoints
 * @param {string|null} p.accountId
 * @param {{seatPrice:number}|null} p.override  admin special price per seat (133)
 */
async function quote({ trip, seats, pickupShuttle, dropShuttle, promoCode, accountId = null, override = null }) {
  const seasonal = await seasonalFor(trip);
  const lines = seats.map((s) => {
    const p = override ? { seatPrice: override.seatPrice, surcharge: 0 } : classPrice(trip, s.seatClass, null, seasonal);
    return { seatId: s.seatId, label: s.label, seatClass: s.seatClass, seatPrice: p.seatPrice, surcharge: p.surcharge, lineAmount: p.seatPrice + p.surcharge };
  });
  const seatsAmount = lines.reduce((t, l) => t + l.seatPrice, 0);
  const surchargeAmount = lines.reduce((t, l) => t + l.surcharge, 0);
  const shuttleAmount = (pickupShuttle?.fee || 0) + (dropShuttle?.fee || 0);
  const subtotal = seatsAmount + surchargeAmount + shuttleAmount;

  let promo = null;
  let voucher = null;
  let promoAmount = 0;
  if (promoCode) {
    ({ promo, voucher } = await checkPromo(promoCode, { accountId, subtotal, routeId: trip.routeId }));
    promoAmount = promoDiscount(promo, subtotal);
  }
  const discountAmount = promoAmount;
  const totalAmount = Math.max(0, subtotal - discountAmount);

  // Spread the order discount over the seat lines (shuttle fees stay whole): remainder on the last seat.
  const seatTotal = lines.reduce((t, l) => t + l.lineAmount, 0);
  const seatDiscount = Math.min(discountAmount, seatTotal);
  let given = 0;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? seatDiscount - given : seatTotal ? Math.floor((seatDiscount * l.lineAmount) / seatTotal) : 0;
    given += share;
    l.netAmount = l.lineAmount - share;
  });

  return {
    lines,
    amounts: {
      seatsAmount, surchargeAmount, shuttleAmount, subtotal, promoDiscount: promoAmount, discountAmount, totalAmount,
      seasonalApplied: seasonal.map((s) => ({ id: s._id, name: s.name, adjustKind: s.adjustKind, adjustValue: s.adjustValue })),
    },
    promo: promo ? { id: promo._id, code: promo.code, title: promo.title || '', kind: promo.kind, value: promo.value } : null,
    voucherId: voucher?._id || null,
  };
}

module.exports = { quote, classPrice, minPrice, seasonalFor, applySeasonal, checkPromo, promoDiscount, shuttleFor, readShuttle, CLASS_NAMES };
