/**
 * Public web page to request account and data deletion (Google Play requirement, feature 143).
 * GET /account/delete shows the form; POST deletes after checking email + password.
 * Plain HTML, no script (works under helmet's default CSP).
 */
const express = require('express');
const accounts = require('../services/accounts');
const { langOf } = require('../i18n');
const { limiter } = require('../middleware/rateLimit');

const text = {
  vi: {
    title: 'Xóa tài khoản SeatRoute',
    intro: 'Nhập email hoặc số điện thoại và mật khẩu của tài khoản để xóa vĩnh viễn tài khoản và dữ liệu trên máy chủ: thông tin cá nhân, tuyến yêu thích, tin nhắn, đánh giá, điểm và mã giảm giá. Các đơn đã đi chỉ còn số tiền (không còn tên, số điện thoại, địa chỉ) để nhà xe đối soát. Không xóa được khi còn chuyến chưa hoàn thành hoặc khoản hoàn tiền đang chờ. Thao tác này không thể hoàn tác.',
    alt: 'Bạn cũng có thể xóa ngay trong ứng dụng: Profile > Quyền riêng tư > Xóa tài khoản.',
    email: 'Email hoặc số điện thoại', password: 'Mật khẩu', confirm: 'Tôi hiểu thao tác này không thể hoàn tác', submit: 'Xóa vĩnh viễn',
    done: 'Tài khoản và dữ liệu trên máy chủ đã được xóa.',
    bad: 'Email / số điện thoại hoặc mật khẩu không đúng.', active: 'Bạn còn chuyến chưa hoàn thành hoặc khoản hoàn tiền đang chờ, hãy thử lại sau khi hoàn tất.', locked: 'Bạn thử quá nhiều lần, vui lòng thử lại sau.', confirmMissing: 'Hãy đánh dấu xác nhận trước khi xóa.', error: 'Không thể xử lý yêu cầu, vui lòng thử lại sau.',
  },
  en: {
    title: 'Delete your SeatRoute account',
    intro: 'Enter the email or phone number and the password of the account to permanently delete the account and its data on the server: personal details, favourite routes, messages, reviews, points and vouchers. Past bookings keep only their amounts (no name, phone or address) for the operator\'s accounting. Not possible while a trip is not completed or a refund is pending. This cannot be undone.',
    alt: 'You can also delete it in the app: Profile > Privacy > Delete account.',
    email: 'Email or phone number', password: 'Password', confirm: 'I understand this cannot be undone', submit: 'Delete permanently',
    done: 'The account and its data on the server have been deleted.',
    bad: 'Incorrect email or password.', active: 'You still have an upcoming trip or a pending refund, please try again once it is done.', locked: 'Too many attempts, please try again later.', confirmMissing: 'Please tick the confirmation first.', error: 'The request could not be processed, please try again later.',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function page(lang, { message = '', ok = false } = {}) {
  const t = text[lang];
  const other = lang === 'vi' ? '<a href="?lang=en">English</a>' : '<a href="?lang=vi">Tiếng Việt</a>';
  const form = ok ? '' : `
    <form method="post" action="/account/delete?lang=${lang}">
      <label>${t.email}<input type="text" name="email" required autocomplete="username" inputmode="email"></label>
      <label>${t.password}<input type="password" name="password" required autocomplete="current-password"></label>
      <label class="row"><input type="checkbox" name="confirm" value="yes" required> ${t.confirm}</label>
      <button type="submit">${t.submit}</button>
    </form>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#5d5d58;--card:#fff;--line:#d9d9d4;--accent:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecece8;--muted:#a5a59f;--card:#20201e;--line:#3a3a37;--accent:#f2b8b5}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:480px;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:22px;margin:0 0 12px}p{color:var(--muted)}
label{display:block;margin:12px 0;font-weight:600}label.row{font-weight:400;display:flex;gap:8px;align-items:flex-start}
input[type=text],input[type=password]{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
button{margin-top:8px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent);color:var(--bg);font:inherit;font-weight:700;cursor:pointer}
.msg{padding:10px 12px;border-radius:8px;border:1px solid var(--line);margin:12px 0;color:var(--fg)}
nav{margin-top:16px;font-size:14px}a{color:inherit}
</style></head><body><main><div class="card">
<h1>${t.title}</h1>
${message ? `<div class="msg" role="status">${esc(message)}</div>` : ''}
${ok ? '' : `<p>${t.intro}</p><p>${t.alt}</p>`}
${form}
</div><nav>${other}</nav></main></body></html>`;
}

const pickLang = (req) => (req.query.lang === 'en' || req.query.lang === 'vi' ? req.query.lang : langOf(req.get('accept-language')));

const router = express.Router();
router.get('/account/delete', (req, res) => res.type('html').send(page(pickLang(req))));
router.post('/account/delete', limiter, express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
  const lang = pickLang(req);
  const t = text[lang];
  if (req.body?.confirm !== 'yes') return res.status(400).type('html').send(page(lang, { message: t.confirmMissing }));
  try {
    await accounts.deleteByCredentials({ email: req.body.email, password: req.body.password });
    return res.type('html').send(page(lang, { message: t.done, ok: true }));
  } catch (err) {
    const status = err.status || 500;
    const message = status === 429 ? t.locked : err.code === 'has_active_orders' ? t.active : status === 401 || status === 400 || status === 403 ? t.bad : t.error;
    if (status >= 500) console.error(req.requestId, err);
    return res.status(status).type('html').send(page(lang, { message }));
  }
});

module.exports = router;
