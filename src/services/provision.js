/**
 * Starter data for a brand-new operator (nhà xe), created inside `tenant.run(operatorId, ...)` right after sign-up:
 * the operator profile, the three seat layout templates, parcel categories, prohibited items and the trip checklist.
 * Routes, offices, vehicles, staff and prices are entered by the owner.
 */
const { resources } = require('../resources/defs');
const layouts = require('./layouts');
const settings = require('./settings');

const CATEGORIES = [['Quần áo, đồ dùng', false], ['Thực phẩm khô', false], ['Giấy tờ', false], ['Chất cháy nổ', true], ['Hàng cấm theo pháp luật', true]];
const PROHIBITED = ['Chất cháy nổ, vũ khí', 'Chất ma túy, hàng cấm theo pháp luật', 'Động vật sống'];
const CHECKLIST = ['Kiểm tra xe, lốp, phanh', 'Đối chiếu danh sách khách với tài xế'];

async function operator(account, profile = {}) {
  const auth = { accountId: account._id, role: 'admin' };
  await settings.update('operator', {
    name: profile.companyName || account.displayName,
    phone: account.phone || '',
    ...(account.email ? { email: account.email } : {}),
    ...(profile.address ? { address: profile.address } : {}),
    ...(profile.taxCode ? { taxCode: profile.taxCode } : {}),
    representativeName: account.displayName,
  }, account._id);
  for (const t of Object.values(layouts.TEMPLATES)) await resources.seatLayouts.insert({ name: t.name, rows: t.rows, cols: t.cols, seats: t.seats }, auth);
  for (const [name, isProhibited] of CATEGORIES) await resources.parcelCategories.insert({ name, isProhibited }, auth);
  for (const text of PROHIBITED) await resources.prohibitedItems.insert({ text }, auth);
  for (const title of CHECKLIST) await resources.checklistItems.insert({ title }, auth);
}

module.exports = { operator };
