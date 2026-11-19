# SeatRoute — API

Node.js (Express 4) + MongoDB (Mongoose 8) cho app Android "SeatRoute" (đặt ghế limo liên tỉnh của một nhà xe, chuyển khoản thủ công + ảnh chứng từ, gửi đồ theo chuyến).
Mô tả app: [docs/SeatRoute-mo-ta.md](docs/SeatRoute-mo-ta.md) · Tài liệu ghép API cho FE: [docs/API-cho-FE.md](docs/API-cho-FE.md).
Cùng kiến trúc với `RoomKeepAPI`: entry Vercel ở `api/`, token/phiên/quên mật khẩu giống hệt, rate limit lưu trong Mongo, test trên MongoDB in-memory.

```bash
cp .env.example .env     # MONGODB_URI (database: seatroute), JWT_SECRET, PUBLIC_BASE_URL, SMTP
npm install
npm run db:init          # collection + index + 34 tỉnh/thành + admin mặc định (mật khẩu ngẫu nhiên in 1 lần)
npm run dev              # http://localhost:4000  -> /v1/health
npm test                 # replica set in-memory (dùng mongod local nếu có)
npm run seed:demo        # dữ liệu demo + tài khoản thử (chỉ dùng DB test / cho người duyệt Google Play)
npm run admin:create -- ops@domain.vn "Tên"   # thêm / cấp lại mật khẩu tạm cho admin từ máy chủ
npm run docs             # sinh lại mục 10 (CRUD) của docs/API-cho-FE.md sau khi sửa src/resources/defs.js
```

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/services/accounts.js`, `tokens.js` | Đăng ký, đăng nhập, refresh xoay vòng + phát hiện dùng lại, quên/đặt lại/đổi mật khẩu, hồ sơ, thiết bị, quản trị viên (mật khẩu tạm, `mustChangePassword`) |
| `src/services/trips.js` | Chuyến, sơ đồ ghế (`trip_seats`), trạng thái bán, trùng lịch xe/tài xế, đổi xe, hủy chuyến, chuỗi chuyến lặp, gợi ý tài xế / ghép chuyến |
| `src/services/bookings.js` | Đơn đặt ghế: **chuyển khoản trước có chỗ trước**, mất ghế, hủy/hoàn theo bản sao chính sách, yêu cầu đổi, đặt hộ tại quầy, danh sách khách, trung chuyển |
| `src/services/proofs.js` | Ảnh chứng từ: kiểm tra theo nội dung, xóa EXIF, băm SHA-256 cảnh báo trùng, lưu riêng tư, link ký 5 phút, duyệt/từ chối |
| `src/services/pricing.js` | Bộ tính giá dùng chung (đặt chỗ, máy tính giá, đặt hộ): loại ghế, giá mùa, trẻ em, trung chuyển, mã giảm, điểm |
| `src/services/parcels.js` | Gửi đồ: bảng cước, tải chuyến nguyên tử, mã nhận hàng (chỉ lưu băm), mốc hàng, bồi thường |
| `src/services/dashboard.js`, `reports.js` | Tổng quan, hàng đợi cần xác nhận, lịch, đối soát, báo cáo, xuất CSV |
| `src/services/settings.js` | Cấu hình một dòng: hồ sơ nhà xe, ngân hàng, chính sách hủy, quy định, hệ thống, loại ghế, trẻ em, điểm, giới thiệu, gửi đồ, nội dung |
| `src/resources/` | Khai báo 22 bảng danh mục → model + kiểm tra + CRUD + tài liệu |
| `src/web/` | `/account/delete` (Google Play), `/privacy` |

## Quyết định khi mô tả chưa nói rõ

* **Nhận ghế = cập nhật có điều kiện** `trip_seats {_id: "trip:seat", state: "free"} → "claimed"` ngay khi ảnh đã lưu. Nguyên tử nên hai chứng từ song song chỉ một thắng (test 8 yêu cầu song song). Không có giữ ghế tạm.
* Khi đặt ghế, ghế đã `claimed`/`sold`/`locked` không chọn được (`409 seat_taken`); "mất ghế" chỉ xảy ra giữa các đơn tạo khi ghế còn trống.
* Duyệt chứng từ chỉ khi đơn `pending_review`/`info_requested`; đơn `seat_lost` phải xếp ghế / đổi chuyến / hoàn trước.
* Doanh thu = bản ghi thu tiền (`payment_records`: chứng từ đã duyệt, tiền mặt, chuyển khoản trực tiếp) − hoàn đã ghi nhận. Ghế miễn phí ghi `compValue`, không vào doanh thu.
* Xóa tài khoản khách: xóa thật dữ liệu cá nhân và ảnh; đơn cũ chỉ giữ số tiền (ẩn tên/SĐT/địa chỉ) để đối soát.
* Báo cáo Excel/PDF (251): xuất **CSV UTF-8 BOM** (Excel mở được); chưa có PDF.
* Ảnh lưu trong collection `files` (Buffer, ≤ 4 MB vì giới hạn body của Vercel). Lượng ảnh lớn thì nên chuyển sang object storage riêng tư (S3/R2) — chỉ cần sửa `proofs.js`.
* Danh mục tỉnh khởi tạo theo 34 đơn vị hành chính từ 1/7/2025; admin thêm/đổi tên được (ví dụ dùng tên cũ "Thái Bình").

## Deploy (Vercel)

`vercel.json` chuyển mọi request vào `api/index.js` (region `sin1`, cron `/v1/jobs/run` 19:00 UTC = 02:00 giờ VN: hết hạn đơn, sinh chuyến lặp, xóa ảnh quá hạn, nhắc hàng chưa nhận). Đặt `MONGODB_URI`, `JWT_SECRET`, `CRON_SECRET`, `PUBLIC_BASE_URL`, SMTP; chạy `npm run db:init` một lần với đúng URI.
