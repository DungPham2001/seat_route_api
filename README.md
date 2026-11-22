# Nhà xe Việt Nam — API

Node.js (Express 4) + MongoDB (Mongoose 8) cho app Android "Nhà xe Việt Nam" (đặt ghế limo liên tỉnh của một nhà xe, trả tiền tại quầy, gửi đồ theo chuyến).
Production: <https://seatrouteapi.vercel.app> (`/v1/health`) · Mô tả app: [docs/SeatRoute-mo-ta.md](docs/SeatRoute-mo-ta.md) · Tài liệu ghép API cho FE: [docs/API-cho-FE.md](docs/API-cho-FE.md).
Cùng kiến trúc với `RoomKeepAPI`: entry Vercel ở `api/`, token/phiên/quên mật khẩu giống hệt, rate limit lưu trong Mongo, test trên MongoDB in-memory.

```bash
cp .env.example .env     # MONGODB_URI (database: seatroute), JWT_SECRET, PUBLIC_BASE_URL, SMTP
npm install
npm run db:init          # collection + index + 34 tỉnh/thành + admin mặc định (mật khẩu ngẫu nhiên in 1 lần)
npm run dev              # http://localhost:4000  -> /v1/health
npm test                 # replica set in-memory (dùng mongod local nếu có)
npm run seed:demo        # dữ liệu demo + tài khoản thử (chỉ dùng DB test / cho người duyệt Google Play)
npm run admin:create -- ops@domain.vn "Tên"   # thêm / cấp lại mật khẩu tạm cho admin từ máy chủ
node scripts/migrate-v2.js --yes   # MỘT LẦN: chuyển DB cũ sang mô hình trả tại quầy (xóa dữ liệu mẫu cũ)
npm run docs             # sinh lại mục 10 (CRUD) của docs/API-cho-FE.md sau khi sửa src/resources/defs.js
```

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/services/accounts.js`, `tokens.js` | Đăng ký (email tùy chọn, SĐT bắt buộc), đăng nhập bằng email hoặc SĐT, refresh xoay vòng + phát hiện dùng lại, quên/đặt lại/đổi mật khẩu, hồ sơ, thiết bị, quản trị viên |
| `src/services/trips.js` | Chuyến, sơ đồ ghế (`trip_seats`), trạng thái bán (không chốt giờ), trùng lịch xe/tài xế, đổi xe cùng sơ đồ, hủy chuyến, chuỗi chuyến lặp, gợi ý tài xế / ghép chuyến |
| `src/services/bookings.js` | Đơn đặt ghế: **giữ ghế ngay khi tạo đơn**, admin duyệt / từ chối, **thu tiền tại quầy** (`collect`), hủy/hoàn theo bản sao chính sách, đặt hộ tại quầy, trung chuyển, danh sách khách |
| `src/services/pricing.js` | Bộ tính giá dùng chung (báo giá, đặt chỗ, đặt hộ): giá ghế + phụ thu hạng đầu/VIP, giá mùa, trung chuyển, mã giảm |
| `src/services/parcels.js` | Gửi đồ: bảng cước, tải chuyến nguyên tử, mã nhận hàng (chỉ lưu băm), cước thu tại quầy khi nhận hàng, mốc hàng, bồi thường |
| `src/services/dashboard.js`, `reports.js` | Tổng quan, hàng đợi cần xác nhận / chờ thu tiền, lịch, trang Doanh thu (`/manage/revenue`), đối soát, báo cáo, xuất CSV |
| `src/services/settings.js` | Cấu hình một dòng: hồ sơ nhà xe, chính sách hủy, quy định, hệ thống (chốt đặt, tối đa ghế, số ngày đặt trước), điểm/hạng, giới thiệu, gửi đồ, nội dung |
| `src/resources/` | Khai báo các bảng danh mục → model + kiểm tra + CRUD + tài liệu |
| `src/web/` | `/account/delete` (Google Play), `/privacy` |
| `scripts/migrate-v2.js` | **Một lần**: chuyển DB cũ (ảnh chứng từ) sang mô hình trả tại quầy — xóa dữ liệu mẫu cũ, cần `--yes` |

## Mô hình nghiệp vụ (theo `docs/SeatRoute-tai-lieu-BE.md`)

* **Không có thanh toán trong app**: không ảnh chuyển khoản, không QR, không tài khoản ngân hàng. Khách trả **tại quầy**.
* **Giữ ghế ngay khi tạo đơn**: cập nhật có điều kiện `trip_seats {_id: "trip:seat", state: "free"} → "pending"`, tất cả ghế hoặc không ghế nào (`409 seat_conflict`, test 8 yêu cầu song song). Chốt đặt **4 giờ** trước giờ chạy cho cả khách và quầy; khách đặt tối đa 7 ngày tới, 6 ghế/đơn.
* **Trạng thái đơn**: `pending → confirmed → completed`; nhánh `rejected` (cuối), `cancel_requested`, `cancelled`. Admin `approve` / `reject`; sau khi khách trả, admin `collect` (tiền mặt / chuyển khoản trực tiếp).
* **Doanh thu = tiền đã thu** (`payment_records`: thu tại quầy, đặt hộ, cước gửi đồ) − hoàn đã ghi nhận, tính vào **ngày thu**. Ghế miễn phí ghi `compValue`, không vào doanh thu. Đơn đã duyệt chưa thu chưa vào doanh thu.
* **Hủy**: đơn `pending` hoặc đã duyệt nhưng chưa thu → hủy ngay, không hoàn; đơn đã thu → `cancel_requested`, admin duyệt, hoàn = `max(0, đã trả × % theo mốc − phí hủy)` (mặc định 100/70/50/0%, phí 10.000), chỉ **ghi nhận**.
* **Điểm** = `total / 10000` khi duyệt đơn (trừ lại khi hủy), hạng 80/200/500, không đổi ra tiền. Khách mới có sẵn mã `CHAOBAN` (10%).
* Đơn `pending` **không tự hết hạn**; đơn đã duyệt mà khách không trả chỉ bị cảnh báo (câu hỏi mở với bên app).
* Xóa tài khoản khách: xóa thật dữ liệu cá nhân; đơn cũ chỉ giữ số tiền (ẩn tên/SĐT/địa chỉ) để đối soát.
* Báo cáo Excel/PDF (251): xuất **CSV UTF-8 BOM** (Excel mở được); chưa có PDF.
* Danh mục tỉnh khởi tạo theo 34 đơn vị hành chính từ 1/7/2025; admin thêm/đổi tên được.

## Deploy (Vercel)

`vercel.json` chuyển mọi request vào `api/index.js` (region `sin1`, cron `/v1/jobs/run` 19:00 UTC = 02:00 giờ VN: sinh chuyến lặp, nhắc hàng chưa nhận, dọn phiên cũ). Đặt `MONGODB_URI`, `JWT_SECRET`, `CRON_SECRET`, `PUBLIC_BASE_URL=https://seatrouteapi.vercel.app`, SMTP; chạy `npm run db:init` một lần với đúng URI. Nếu database đã có dữ liệu của bản cũ (ảnh chứng từ) thì chạy thêm `node scripts/migrate-v2.js --yes` **một lần** trước khi `db:init` + `seed:demo` (xóa dữ liệu mẫu cũ).

## Nhiều nhà xe (Wayra Fleet)

Mỗi tài khoản đăng ký (`POST /v1/auth/register`) là một nhà xe riêng. Dữ liệu tách theo `operatorId` (= id chủ nhà xe) bằng `src/lib/tenant.js` + `src/lib/tenantPlugin.js`: mọi truy vấn và bản ghi mới của các collection nghiệp vụ tự gắn `operatorId` của request, nên service không thể đọc/ghi dữ liệu nhà xe khác. Tỉnh/thành, tài khoản, phiên, thông báo dùng chung. Hành khách/khách vãng lai chạy trên nhà xe mặc định (`DEFAULT_OPERATOR_ID`, mặc định là nhà xe lâu đời nhất) hoặc header `X-Operator-Id`.

Database cũ (một nhà xe): chạy **một lần** `node scripts/migrate-tenant.js <email-chủ> --yes` (gán dữ liệu hiện có cho chủ đó, đổi tên cài đặt thành `<id>:<key>`), rồi `npm run db:init` để dựng lại index duy nhất theo từng nhà xe.
