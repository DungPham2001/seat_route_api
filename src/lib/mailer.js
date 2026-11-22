/**
 * Outgoing email: password reset code and "password changed" notice. Uses SMTP when configured.
 * Without SMTP the email is not sent; outside production the reset code is then returned as `devToken`.
 * Tests never send: messages go to `testOutbox`. Nothing personal (address, code) is ever logged.
 */
const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
// SMTP counts as configured only when complete (a user without its password cannot authenticate).
const enabled = () => !!config.smtp.host && (!config.smtp.user || !!config.smtp.pass);
const testOutbox = [];

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transport;
}

const pretty = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pickLang = (lang) => (lang === 'en' ? 'en' : 'vi');

/** "08:15, 14/11/2026 (giờ Việt Nam)" / "Nov 14, 2026, 08:15 (GMT+7)" in the business timezone. */
function when(date, lang) {
  const opts = { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', day: '2-digit', month: lang === 'en' ? 'short' : '2-digit', year: 'numeric', hour12: false };
  if (lang === 'en') {
    const tz = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'shortOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
    return `${new Intl.DateTimeFormat('en-US', opts).format(date)} (${tz})`;
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat('vi-VN', opts).formatToParts(date).map((x) => [x.type, x.value]));
  const suffix = config.timezone === 'Asia/Ho_Chi_Minh' ? 'giờ Việt Nam' : config.timezone;
  return `${p.hour}:${p.minute}, ${p.day}/${p.month}/${p.year} (${suffix})`;
}

const footer = { vi: 'Email tự động từ Nhà xe Việt Nam, vui lòng không trả lời.', en: 'Automated email from Nhà xe Việt Nam, please do not reply.' };

/** Shared HTML frame (table layout + inline styles: what email clients render reliably). */
function layout(lang, inner) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b">
<tr><td style="padding:24px 28px 8px;font-size:20px;font-weight:bold;color:#1e4f8a">Nhà xe Việt Nam</td></tr>
<tr><td style="padding:8px 28px;font-size:15px;line-height:1.55">${inner}</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#8a8a84;border-top:1px solid #ececea">${esc(footer[lang])}</td></tr>
</table></td></tr></table></body></html>`;
}
const para = (s, muted = false) => `<p style="margin:0 0 12px${muted ? ';color:#5d5d58' : ''}">${esc(s)}</p>`;

// ---------- reset code ----------

const resetCopy = {
  vi: {
    subject: (c) => `${c} là mã đặt lại mật khẩu Nhà xe Việt Nam của bạn`,
    hello: (n) => (n ? `Xin chào ${n},` : 'Xin chào,'),
    intro: 'Chúng tôi vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản Nhà xe Việt Nam của bạn. Nhập mã dưới đây trong ứng dụng để tạo mật khẩu mới:',
    expiry: (m) => `Mã có hiệu lực trong ${m} phút và chỉ dùng được một lần.`,
    notYou: 'Không phải bạn yêu cầu? Hãy bỏ qua email này, mật khẩu của bạn vẫn giữ nguyên và không ai có thể đổi được nếu không có mã.',
    never: 'Nhà xe Việt Nam không bao giờ hỏi mã này qua điện thoại, tin nhắn hay Zalo. Đừng chia sẻ mã cho bất kỳ ai.',
  },
  en: {
    subject: (c) => `${c} is your Nhà xe Việt Nam password reset code`,
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    intro: 'We received a request to reset the password of your Nhà xe Việt Nam account. Enter this code in the app to choose a new password:',
    expiry: (m) => `The code expires in ${m} minutes and can be used only once.`,
    notYou: "Didn't ask for this? Just ignore this email. Your password stays the same and nobody can change it without this code.",
    never: 'Nhà xe Việt Nam will never ask for this code by phone or message. Do not share it with anyone.',
  },
};

function resetEmail(lang, code, minutes, name) {
  const t = resetCopy[lang];
  const c = pretty(code);
  const text = [t.hello(name), '', t.intro, '', `    ${c}`, '', t.expiry(minutes), '', t.notYou, t.never, '', '-- ', footer[lang]].join('\n');
  const html = layout(lang, `${para(t.hello(name))}<p style="margin:0 0 20px">${esc(t.intro)}</p>
<div style="text-align:center;margin:0 0 20px"><span style="display:inline-block;padding:14px 24px;background:#eef3fa;border:1px solid #cfdcef;border-radius:10px;font-size:30px;font-weight:bold;letter-spacing:4px;font-family:'Courier New',monospace;color:#1d1d1b">${c}</span></div>
${para(t.expiry(minutes))}${para(t.notYou, true)}${para(t.never, true)}`);
  return { subject: t.subject(c), text, html };
}

// ---------- password changed ----------

const changedCopy = {
  vi: {
    subject: 'Mật khẩu Nhà xe Việt Nam của bạn đã được thay đổi',
    hello: (n) => (n ? `Xin chào ${n},` : 'Xin chào,'),
    intro: (e) => `Mật khẩu của tài khoản Nhà xe Việt Nam ${e} vừa được thay đổi.`,
    time: 'Thời gian',
    how: 'Cách thực hiện',
    device: 'Thiết bị',
    viaReset: 'Đặt lại bằng mã gửi qua email',
    viaApp: 'Đổi mật khẩu trong ứng dụng',
    signedOut: (reset) => (reset ? 'Tất cả thiết bị đã được đăng xuất.' : 'Các thiết bị khác đã được đăng xuất.'),
    ok: 'Nếu là bạn, bạn không cần làm gì thêm.',
    notYouTitle: 'Không phải bạn?',
    notYou: 'Hãy mở ứng dụng Nhà xe Việt Nam, chọn "Quên mật khẩu" và nhập email này để lấy lại tài khoản ngay. Sau đó kiểm tra mục Thiết bị đã đăng nhập và gỡ những thiết bị lạ.',
  },
  en: {
    subject: 'Your Nhà xe Việt Nam password was changed',
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    intro: (e) => `The password of the Nhà xe Việt Nam account ${e} was just changed.`,
    time: 'Time',
    how: 'How',
    device: 'Device',
    viaReset: 'Reset with a code sent by email',
    viaApp: 'Changed in the app',
    signedOut: (reset) => (reset ? 'All devices have been signed out.' : 'Your other devices have been signed out.'),
    ok: 'If this was you, there is nothing else to do.',
    notYouTitle: "Wasn't you?",
    notYou: 'Open the Nhà xe Việt Nam app, tap "Forgot password" and enter this email to take your account back right away. Then check Signed-in devices and remove any you do not recognize.',
  },
};

function changedEmail(lang, { name, email, at, via, deviceName }) {
  const t = changedCopy[lang];
  const reset = via === 'reset';
  const rows = [[t.time, when(at, lang)], [t.how, reset ? t.viaReset : t.viaApp]];
  if (deviceName) rows.push([t.device, deviceName]);
  const text = [
    t.hello(name), '', t.intro(email), '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    t.signedOut(reset), t.ok, '',
    `${t.notYouTitle} ${t.notYou}`, '', '-- ', footer[lang],
  ].join('\n');
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;background:#f7f7f5;border-radius:10px">${
    rows.map(([k, v]) => `<tr><td style="padding:8px 14px;color:#5d5d58;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px 14px;font-weight:bold">${esc(v)}</td></tr>`).join('')
  }</table>`;
  const html = layout(lang, `${para(t.hello(name))}${para(t.intro(email))}${table}${para(`${t.signedOut(reset)} ${t.ok}`)}
<div style="margin:4px 0 8px;padding:12px 14px;border-left:4px solid #b3261e;background:#fdf1f0;border-radius:6px"><p style="margin:0 0 4px;font-weight:bold;color:#b3261e">${esc(t.notYouTitle)}</p><p style="margin:0">${esc(t.notYou)}</p></div>`);
  return { subject: t.subject, text, html };
}

// ---------- sending ----------

async function send(kind, to, msg) {
  if (config.isTest) {
    testOutbox.push({ kind, to, ...msg });
    return false;
  }
  if (!enabled()) return false;
  try {
    await getTransport().sendMail({ from: config.smtp.from, to, ...msg });
    return true;
  } catch (err) {
    console.error(`${kind} email failed:`, err.code || err.name);
    return false;
  }
}

const sendResetCode = (to, code, lang, name) => send('reset_code', to, resetEmail(pickLang(lang), code, Math.round(config.resetCodeSec / 60), name));

/** via: 'reset' | 'change'. Failure to send never fails the password change itself. */
const sendPasswordChanged = (account, { via, deviceName, lang }) => send('password_changed', account.email, changedEmail(pickLang(lang || account.preferredLanguage), {
  name: account.displayName, email: account.email, at: new Date(), via, deviceName,
}));

module.exports = { enabled, sendResetCode, sendPasswordChanged, pretty, testOutbox };
