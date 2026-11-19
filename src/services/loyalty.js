/**
 * Points, tiers, voucher wallet, referrals, personal stats (90-94, 227, 230, 231).
 * The points ledger is append-only (balance = sum); a cancelled booking adds a negative entry. Never cash.
 */
const models = require('../models');
const { Checker } = require('../lib/validate');
const { notFound, conflict, invalid } = require('../lib/errors');
const { uuid, iso } = require('../lib/util');
const settings = require('./settings');
const notify = require('./notify');
const T = require('../lib/time');
const { paging, page } = require('../resources/engine');

const { LoyaltyEntry, Voucher, Promotion, Referral, Booking, Account, Route } = models;

async function balances(accountId) {
  const rows = await LoyaltyEntry.aggregate([
    { $match: { accountId } },
    { $group: { _id: null, points: { $sum: '$points' }, earned: { $sum: { $cond: [{ $eq: ['$reason', 'trip'] }, '$points', 0] } } } },
  ]);
  return { points: rows[0]?.points || 0, earned: rows[0]?.earned || 0 };
}

function tierOf(tiers, earned) {
  const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  let current = sorted[0] || null;
  let next = null;
  for (const t of sorted) {
    if (earned >= t.minPoints) current = t;
    else {
      next = t;
      break;
    }
  }
  return { current, next };
}

/** Card on top of Profile (81): points + tier. */
async function summary(accountId) {
  const [rule, b] = await Promise.all([settings.get('loyalty'), balances(accountId)]);
  const { current, next } = tierOf(rule.tiers || [], b.earned);
  return {
    enabled: rule.enabled, points: b.points, lifetimeEarned: b.earned,
    tier: current ? { name: current.name, minPoints: current.minPoints, benefitText: current.benefitText } : null,
    nextTier: next ? { name: next.name, minPoints: next.minPoints, pointsNeeded: next.minPoints - b.earned } : null,
    redeemValuePerPoint: rule.redeemValuePerPoint,
  };
}

/** GET /v1/me/loyalty (92): summary, rules, tiers, ledger. */
async function detail(auth, query) {
  const p = paging(query, 30);
  const [s, rule, rows, total] = await Promise.all([
    summary(auth.accountId), settings.get('loyalty'),
    LoyaltyEntry.find({ accountId: auth.accountId }).sort({ at: -1 }).skip(p.skip).limit(p.limit + 1).lean(),
    LoyaltyEntry.countDocuments({ accountId: auth.accountId }),
  ]);
  return {
    ...s,
    rules: { earnPointsPer10k: rule.earnPointsPer10k, redeemValuePerPoint: rule.redeemValuePerPoint, maxRedeemPercent: rule.maxRedeemPercent },
    tiers: rule.tiers,
    entries: page(rows.map((e) => ({ id: e._id, points: e.points, reason: e.reason, refType: e.refType, refId: e.refId, at: iso(e.at) })), p, total),
  };
}

/** Trip completed: points for the booking, and the referral reward on the first completed trip. */
async function onTripCompleted(b) {
  const rule = await settings.get('loyalty');
  if (rule.enabled && b.paidAmount > 0) {
    const points = Math.floor((b.paidAmount / 10000) * (rule.earnPointsPer10k || 0));
    if (points > 0) {
      await LoyaltyEntry.create({ _id: uuid(), accountId: b.customerAccountId, points, reason: 'trip', refType: 'booking', refId: b._id, at: new Date() });
      await Booking.updateOne({ _id: b._id }, { $set: { pointsAwarded: points } });
      await notify.push(b.customerAccountId, 'order', 'points_earned', { refType: 'booking', refId: b._id, params: { code: b.code, points } });
    }
  }
  const ref = await Referral.findOne({ referredAccountId: b.customerAccountId, status: 'pending' }).lean();
  if (ref) {
    const rr = await settings.get('referral');
    const r = await Referral.updateOne({ _id: ref._id, status: 'pending' }, { $set: { status: 'rewarded', rewardedAt: new Date() } });
    if (r.modifiedCount && rr.enabled) {
      if (rr.referrerPromotionId) await giveVoucher(ref.referrerAccountId, rr.referrerPromotionId, 'referral');
      if (rr.referredPromotionId) await giveVoucher(ref.referredAccountId, rr.referredPromotionId, 'referral');
      await notify.push(ref.referrerAccountId, 'promo', 'referral_rewarded', {});
    }
  }
}

async function giveVoucher(accountId, promotionId, source = 'admin') {
  const promo = await Promotion.findById(promotionId).lean();
  if (!promo) return null;
  const doc = { _id: uuid(), accountId, promotionId, status: 'active', source, receivedAt: new Date() };
  await Voucher.create(doc);
  await notify.push(accountId, 'promo', 'voucher_received', { refType: 'promotion', refId: promotionId, params: { code: promo.code } });
  return doc;
}

const presentPromo = (p) => ({
  id: p._id, code: p.code, title: p.title || '', description: p.description || '', kind: p.kind, value: p.value, maxDiscount: p.maxDiscount, minAmount: p.minAmount,
  startAt: iso(p.startAt), endAt: iso(p.endAt), routeId: p.routeId, audience: p.audience, remaining: p.usageLimit ? Math.max(0, p.usageLimit - p.usedCount) : null,
});

const isLive = (p, now = new Date()) => p.isActive && (!p.startAt || p.startAt <= now) && (!p.endAt || p.endAt >= now) && (!p.usageLimit || p.usedCount < p.usageLimit);

/** Public promotions running now (14). */
async function activePromotions() {
  const rows = await Promotion.find({ isActive: true, audience: 'public' }).sort({ endAt: 1 }).limit(50).lean();
  return rows.filter((p) => isLive(p)).map(presentPromo);
}

/** GET /v1/me/vouchers (93): wallet with status active / used / expired, plus public codes. */
async function vouchers(auth) {
  const rows = await Voucher.find({ accountId: auth.accountId }).sort({ receivedAt: -1 }).lean();
  const promos = new Map((await Promotion.find({ _id: { $in: rows.map((v) => v.promotionId) } }).lean()).map((p) => [p._id, p]));
  const wallet = rows.filter((v) => promos.has(v.promotionId)).map((v) => {
    const p = promos.get(v.promotionId);
    const status = v.status === 'used' ? 'used' : isLive(p) ? 'active' : 'expired';
    return { id: v._id, status, source: v.source, receivedAt: iso(v.receivedAt), usedAt: iso(v.usedAt), orderId: v.orderId, promotion: presentPromo(p) };
  });
  const inWallet = new Set(rows.map((v) => v.promotionId));
  return { wallet, available: (await activePromotions()).filter((p) => !inWallet.has(p.id)) };
}

/** POST /v1/me/vouchers { code } — save a public code to the wallet. */
async function saveVoucher(auth, body) {
  const c = new Checker();
  const code = c.str(body, 'code', { required: true, max: 20 });
  c.done();
  const p = await Promotion.findOne({ code: code.toUpperCase() }).lean();
  if (!p || p.audience !== 'public' || !isLive(p)) throw invalid([{ field: 'code', code: 'promo_invalid' }]);
  if (await Voucher.exists({ accountId: auth.accountId, promotionId: p._id })) throw conflict('duplicate');
  const doc = { _id: uuid(), accountId: auth.accountId, promotionId: p._id, status: 'active', source: 'saved', receivedAt: new Date() };
  await Voucher.create(doc);
  return { id: doc._id, status: 'active', promotion: presentPromo(p) };
}

/** POST /admin/promotions/:id/grant { accountIds: [...] } (227): put the code in customers' wallets. */
async function grant(auth, promotionId, body) {
  const c = new Checker();
  const ids = c.arr(body, 'accountIds', { required: true, max: 1000 }) || [];
  c.done();
  if (!(await Promotion.exists({ _id: promotionId }))) throw notFound();
  const accounts = await Account.find({ _id: { $in: ids.map(String) }, role: 'customer' }).select('_id').lean();
  const have = new Set((await Voucher.find({ promotionId, accountId: { $in: accounts.map((a) => a._id) } }).select('accountId').lean()).map((v) => v.accountId));
  let granted = 0;
  for (const a of accounts) {
    if (have.has(a._id)) continue;
    await giveVoucher(a._id, promotionId, 'admin');
    granted += 1;
  }
  await require('./audit').log(auth, 'promotion', promotionId, 'granted', `${granted} accounts`);
  return { granted, skipped: ids.length - granted };
}

/** GET /v1/me/referral (94). */
async function referral(auth, lang = 'vi') {
  const [rule, rows, op] = await Promise.all([settings.get('referral'), Referral.find({ referrerAccountId: auth.accountId }).lean(), settings.get('operator')]);
  const code = auth.account.referralCode;
  const name = op.name || 'SeatRoute';
  return {
    enabled: rule.enabled, code, invited: rows.length, rewarded: rows.filter((r) => r.status === 'rewarded').length, maxPerReferrer: rule.maxPerReferrer,
    shareText: lang === 'en' ? `Book limo seats with ${name}. Sign up with my code ${code} to get a discount after your first trip.` : `Đặt ghế limo của ${name}. Đăng ký với mã giới thiệu ${code} để nhận mã giảm giá sau chuyến đầu tiên.`,
  };
}

/** GET /v1/me/stats (91): trips taken, total spent, favourite route, points this year. */
async function stats(auth) {
  const year = T.today().slice(0, 4);
  const [agg, routeAgg, pointsYear] = await Promise.all([
    Booking.aggregate([{ $match: { customerAccountId: auth.accountId, status: 'completed' } }, { $group: { _id: null, trips: { $sum: 1 }, spent: { $sum: { $subtract: ['$paidAmount', { $ifNull: ['$refundedAmount', 0] }] } }, seats: { $sum: { $size: '$seats' } } } }]),
    Booking.aggregate([{ $match: { customerAccountId: auth.accountId, status: 'completed' } }, { $group: { _id: '$routeId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }]),
    LoyaltyEntry.aggregate([{ $match: { accountId: auth.accountId, points: { $gt: 0 }, at: { $gte: T.localToUtc(`${year}-01-01`) } } }, { $group: { _id: null, p: { $sum: '$points' } } }]),
  ]);
  const top = routeAgg[0] ? await Route.findById(routeAgg[0]._id).select('name').lean() : null;
  return {
    completedTrips: agg[0]?.trips || 0, seatsTravelled: agg[0]?.seats || 0, totalSpent: agg[0]?.spent || 0,
    topRoute: top ? { id: top._id, name: top.name, trips: routeAgg[0].n } : null, pointsThisYear: pointsYear[0]?.p || 0, year: Number(year),
  };
}

module.exports = { summary, detail, onTripCompleted, giveVoucher, activePromotions, vouchers, saveVoucher, grant, referral, stats, presentPromo, balances };
