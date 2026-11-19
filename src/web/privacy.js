/**
 * Public privacy policy page (Google Play requirement): GET /privacy (?lang=en).
 * The text describes what this API actually stores; keep it in sync when data handling changes.
 * Owner and contact come from PRIVACY_OWNER / PRIVACY_EMAIL (defaults below).
 */
const express = require('express');
const config = require('../config');
const { langOf } = require('../i18n');

const OWNER = process.env.PRIVACY_OWNER || 'TMSC Developer';
const EMAIL = process.env.PRIVACY_EMAIL || 'support@tmsc-vn.com';
const UPDATED = '2026-11-19';

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const base = () => config.publicBaseUrl || '';
const mail = `<a href="mailto:${esc(EMAIL)}">${esc(EMAIL)}</a>`;

/** [heading, [paragraph | list items array]] */
const content = {
  vi: {
    title: 'Chính sách quyền riêng tư SeatRoute',
    updated: 'Cập nhật lần cuối: 19/11/2026',
    other: '<a href="?lang=en">English</a>',
    sections: [
      ['Chúng tôi là ai', [
        `SeatRoute là ứng dụng đặt chỗ limo liên tỉnh và gửi đồ theo chuyến của một nhà xe, do <strong>${esc(OWNER)}</strong> phát triển và chịu trách nhiệm về dữ liệu. Liên hệ: ${mail}.`,
      ]],
      ['Dữ liệu chúng tôi lưu', [[
        '<strong>Tài khoản:</strong> email, tên, số điện thoại, ngày sinh và giới tính (nếu bạn nhập), ngôn ngữ, mật khẩu (chỉ lưu dạng đã băm bằng bcrypt), thời điểm đồng ý điều khoản.',
        '<strong>Đặt chỗ:</strong> chuyến, ghế, văn phòng lên và xuống xe, tên và số điện thoại từng hành khách, ghi chú, số tiền, mã giảm giá, lịch sử thay đổi của đơn.',
        '<strong>Ảnh chứng từ chuyển khoản:</strong> ảnh bạn chụp bằng Camera hoặc chọn bằng trình chọn ảnh của hệ thống. Ảnh có thể chứa tên, số tài khoản, ngân hàng, số tiền và thời gian giao dịch. Máy chủ xóa thông tin vị trí và siêu dữ liệu trong ảnh JPEG, lưu ở nơi không công khai và tính dấu vân tay (băm) để cảnh báo ảnh bị dùng lại.',
        '<strong>Xe trung chuyển:</strong> địa chỉ đón hoặc trả bằng chữ do bạn nhập và ghi chú. Ứng dụng không dùng vị trí hay bản đồ.',
        '<strong>Gửi đồ:</strong> tên và số điện thoại người gửi và người nhận, địa chỉ nhận (nếu có), mô tả hàng, cân nặng, giá trị khai báo. Mã nhận hàng chỉ lưu dạng băm.',
        '<strong>Dữ liệu lưu sẵn trong Profile:</strong> hành khách đi cùng, địa chỉ, sổ người nhận, tài khoản nhận hoàn tiền, liên hệ khẩn cấp, sở thích, tuyến và văn phòng yêu thích.',
        '<strong>Nội dung bạn gửi:</strong> đánh giá, tin nhắn trong đơn, khiếu nại, báo cáo vi phạm, liên hệ nhà xe.',
        '<strong>Điểm và mã giảm giá:</strong> sổ điểm, ví mã, mã giới thiệu.',
        '<strong>Phiên đăng nhập:</strong> tên thiết bị, thời điểm đăng nhập và hoạt động gần nhất.',
        '<strong>Dữ liệu kỹ thuật:</strong> địa chỉ IP lưu tạm để chống truy cập dồn dập, tự xóa sau tối đa khoảng 2 ngày; nhật ký máy chủ chỉ ghi loại yêu cầu, đường dẫn, mã kết quả, thời gian xử lý, không ghi nội dung, mật khẩu hay mã truy cập.',
      ]]],
      ['Người không dùng ứng dụng', [
        'Nhà xe có thể đặt ghế hoặc nhận gửi đồ hộ người không có tài khoản (ví dụ người nhà, khách tại quầy) và nhập tên, số điện thoại của họ; người nhận hàng cũng được lưu tên và số điện thoại. Dữ liệu này chỉ dùng để thực hiện chuyến đi hoặc giao hàng. Người liên quan có thể yêu cầu xóa qua email ở trên hoặc qua nhà xe.',
      ]],
      ['Dữ liệu chúng tôi không thu thập', [
        'Không vị trí, danh bạ, micro, không đọc thư viện ảnh (chỉ dùng trình chọn ảnh của hệ thống), không thông báo đẩy, không quảng cáo, không bán hay cho thuê dữ liệu. Ứng dụng không giữ tiền, không xử lý thanh toán: bạn chuyển khoản trực tiếp cho nhà xe.',
      ]],
      ['Mục đích sử dụng', [[
        'Tạo tài khoản, đăng nhập, giữ phiên làm việc.',
        'Đặt chỗ, xếp ghế, xác nhận chứng từ chuyển khoản, xe trung chuyển, gửi đồ, hủy, đổi và hoàn tiền theo chính sách của nhà xe.',
        'Hiện thông báo trong ứng dụng về đơn, chuyến và gửi đồ; nhà xe có thể gọi điện hoặc nhắn Zalo cho bạn về chuyến đi.',
        'Gửi email cần thiết: mã đặt lại mật khẩu và thông báo đổi mật khẩu. Không gửi email quảng cáo.',
        'Đối soát doanh thu của nhà xe, xử lý khiếu nại và báo cáo vi phạm.',
      ]]],
      ['Ai xem được dữ liệu', [[
        'Bạn và quản trị viên của nhà xe. Ảnh chứng từ chỉ bạn và quản trị viên xem được, qua liên kết có hạn vài phút. Danh sách hành khách của chuyến chỉ có tên, số điện thoại, ghế, văn phòng; không có email hay chứng từ.',
        'Tài xế không có tài khoản; nhà xe gửi cho tài xế danh sách khách dạng chữ (tên, số điện thoại, ghế, điểm đón, địa chỉ trung chuyển) qua Zalo hoặc ứng dụng khác.',
        'Khách hàng khác chỉ thấy trạng thái ghế, không thấy thông tin người đặt. Đánh giá công khai chỉ hiện tên rút gọn.',
        'Nhà cung cấp hạ tầng xử lý dữ liệu thay chúng tôi: MongoDB Atlas (cơ sở dữ liệu), Vercel (máy chủ API), dịch vụ gửi email. Họ không được dùng dữ liệu cho mục đích riêng.',
        'Cơ quan nhà nước khi pháp luật yêu cầu.',
      ]]],
      ['Bảo mật', [
        'Mọi kết nối dùng HTTPS. Mật khẩu chỉ lưu dạng băm. Mã truy cập chỉ nằm trong bộ nhớ ứng dụng, có hạn dùng và thu hồi được. Máy chủ kiểm tra vai trò (khách hàng hoặc quản trị viên) ở mọi yêu cầu. Ứng dụng chỉ cảnh báo ảnh chứng từ trùng nhau, không xác minh được chứng từ thật hay giả.',
      ]],
      ['Thời gian lưu và xóa dữ liệu', [[
        'Dữ liệu tài khoản được giữ trong thời gian tài khoản còn tồn tại.',
        'Ảnh chứng từ tự xóa sau số ngày nhà xe cấu hình kể từ khi chuyến hoàn thành (mặc định 90 ngày); bạn xem thời hạn đang áp dụng trong Profile &gt; Quyền riêng tư.',
        'Mã đặt lại mật khẩu hết hạn sau 30 phút, phiên đăng nhập tối đa 12 giờ.',
        `Bạn xóa tài khoản ngay trong ứng dụng (Profile &gt; Quyền riêng tư &gt; Xóa tài khoản) hoặc tại <a href="${base()}/account/delete">trang xóa tài khoản</a>. Máy chủ xóa thật tài khoản, dữ liệu lưu sẵn, ảnh chứng từ, tin nhắn, đánh giá, điểm, mã. Các đơn đã đi chỉ còn số tiền, không còn tên, số điện thoại, địa chỉ, để nhà xe đối soát theo quy định kế toán. Không xóa được khi còn chuyến chưa hoàn thành hoặc khoản hoàn tiền đang chờ.`,
      ]]],
      ['Quyền của bạn', [
        `Bạn có quyền xem dữ liệu (Profile &gt; Quyền riêng tư), sửa, xuất lịch sử đặt chỗ, xóa dữ liệu và rút lại đồng ý bằng cách xóa tài khoản, theo quy định pháp luật về bảo vệ dữ liệu cá nhân. Báo cáo vi phạm được quản trị viên xử lý trong ứng dụng. Mọi yêu cầu khác gửi về ${mail}.`,
      ]],
      ['Trẻ em', [
        'Tài khoản dành cho người từ 16 tuổi. Trẻ em đi cùng được người lớn nhập tên khi đặt ghế.',
      ]],
    ],
  },
  en: {
    title: 'SeatRoute privacy policy',
    updated: 'Last updated: 2026-11-19',
    other: '<a href="?lang=vi">Tiếng Việt</a>',
    sections: [
      ['Who we are', [
        `SeatRoute is the intercity limo seat booking and parcel app of one operator, developed by <strong>${esc(OWNER)}</strong>, who is responsible for the data. Contact: ${mail}.`,
      ]],
      ['Data we store', [[
        '<strong>Account:</strong> email, name, phone number, birth date and gender (if you enter them), language, password (only a bcrypt hash), when you accepted the terms.',
        '<strong>Bookings:</strong> trip, seats, pickup and drop-off offices, each passenger\'s name and phone, notes, amounts, promo codes, booking history.',
        '<strong>Transfer receipt photos:</strong> taken with the in-app camera or picked with the system photo picker. They may show a name, account number, bank, amount and time. The server removes location and metadata from JPEG photos, stores them privately and hashes them to warn about reused photos.',
        '<strong>Shuttle:</strong> pickup or drop-off address typed as text and notes. No location or map is used.',
        '<strong>Parcels:</strong> sender and receiver names and phones, receiver address (optional), goods description, weight, declared value. The pickup code is stored only as a hash.',
        '<strong>Saved data in Profile:</strong> travel companions, addresses, receivers, refund bank account, emergency contact, preferences, favourite routes and offices.',
        '<strong>Content you send:</strong> reviews, booking messages, complaints, reports, contact form.',
        '<strong>Points and vouchers:</strong> points ledger, voucher wallet, referral code.',
        '<strong>Sessions:</strong> device name, sign-in and last activity time.',
        '<strong>Technical data:</strong> IP addresses kept briefly against abuse (deleted within about 2 days); server logs keep only method, path, status and timing, never bodies, passwords or tokens.',
      ]]],
      ['People who do not use the app', [
        'The operator can book seats or take parcels for people without an account (family members, walk-in customers) and enters their name and phone; parcel receivers are stored with name and phone too. This data is only used to run the trip or the delivery. They can ask for deletion by email or through the operator.',
      ]],
      ['Data we do not collect', [
        'No location, contacts or microphone, no photo library access (only the system photo picker), no push notifications, no ads, no selling of data. The app does not hold or process money: you transfer directly to the operator.',
      ]],
      ['Why we use it', [[
        'Accounts, sign-in, sessions.',
        'Bookings, seat assignment, receipt checks, shuttle, parcels, cancellations, changes and refunds under the operator\'s policy.',
        'In-app notifications about bookings, trips and parcels; the operator may call or message you about your trip.',
        'Required emails only: password reset code and password-changed notice.',
        'The operator\'s revenue reconciliation, complaint and report handling.',
      ]]],
      ['Who can see it', [[
        'You and the operator\'s admins. Receipt photos are shown only to you and the admins, through links valid a few minutes. A trip\'s passenger list has names, phones, seats and offices, never emails or receipts.',
        'Drivers have no account; the operator sends them a plain-text passenger list (names, phones, seats, pickup offices, shuttle addresses).',
        'Other customers only see seat states, never who booked. Public reviews show a shortened name.',
        'Infrastructure providers processing data for us: MongoDB Atlas (database), Vercel (API hosting), an email delivery service. They may not use the data for their own purposes.',
        'Authorities when the law requires it.',
      ]]],
      ['Security', [
        'All connections use HTTPS. Passwords are only stored hashed. Access tokens live only in app memory, expire and can be revoked. The server checks the role (customer or admin) on every request. The app only warns about duplicate receipt photos and cannot tell whether a receipt is genuine.',
      ]],
      ['Retention and deletion', [[
        'Account data is kept while the account exists.',
        'Receipt photos are deleted a number of days after the trip is completed, set by the operator (90 days by default); the current value is shown in Profile &gt; Privacy.',
        'Password reset codes expire after 30 minutes, sessions after at most 12 hours.',
        `Delete your account in the app (Profile &gt; Privacy &gt; Delete account) or on the <a href="${base()}/account/delete">account deletion page</a>. The server really deletes the account, saved data, receipt photos, messages, reviews, points and vouchers. Past bookings keep only their amounts (no name, phone or address) for the operator\'s accounting. Not possible while a trip is not completed or a refund is pending.`,
      ]]],
      ['Your rights', [
        `You can view your data (Profile &gt; Privacy), edit it, export your booking history, delete it and withdraw consent by deleting your account, under personal data protection law. Reports are handled by the operator\'s admins in the app. Other requests: ${mail}.`,
      ]],
      ['Children', [
        'Accounts are for people aged 16 and over. Children travelling with an adult are entered by the adult when booking.',
      ]],
    ],
  },
};

function render(lang) {
  const t = content[lang];
  const body = t.sections.map(([h, parts]) => `<h2>${h}</h2>${parts.map((p) => (Array.isArray(p) ? `<ul>${p.map((li) => `<li>${li}</li>`).join('')}</ul>` : `<p>${p}</p>`)).join('')}`).join('\n');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#5d5d58;--card:#fff;--line:#d9d9d4;--accent:#1f5f4a}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecece8;--muted:#a5a59f;--card:#20201e;--line:#3a3a37;--accent:#8fd1b5}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:24px;margin:0 0 4px;color:var(--accent)}h2{font-size:18px;margin:28px 0 8px}
.meta{color:var(--muted);font-size:14px;margin:0 0 8px}p,li{margin:0 0 10px}ul{padding-left:20px;margin:0}
a{color:var(--accent)}nav{margin-top:16px;font-size:14px}
</style></head><body><main><div class="card">
<h1>${t.title}</h1><p class="meta">${t.updated}</p>
${body}
</div><nav>${t.other}</nav></main></body></html>`;
}

const pickLang = (req) => (req.query.lang === 'en' || req.query.lang === 'vi' ? req.query.lang : langOf(req.get('accept-language')));

const router = express.Router();
router.get('/privacy', (req, res) => res.type('html').send(render(pickLang(req))));

module.exports = router;
