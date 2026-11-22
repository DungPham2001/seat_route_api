# Wayra Fleet — tài liệu gửi BE

Ứng dụng đổi từ **app đặt vé cho hành khách (SeatRoute)** sang **app quản lý nhà xe limo chạy toàn miền Bắc (Wayra Fleet)**.
Tài liệu này gồm: (1) cái gì đã đổi ở app, (2) **những việc cần BE làm hoặc xác nhận**, (3) danh sách API app đang gọi, (4) API không còn dùng.
Schema chi tiết của từng endpoint vẫn theo `API-cho-FE.md`; file này chỉ nêu phần thay đổi và phần cần chốt.

| | |
|---|---|
| Base URL | `https://seatrouteapi.vercel.app` (`/v1/...`) — **giữ nguyên, không đổi API** |
| Package Android | `com.wayra.trips` |
| Tên hiển thị | Wayra Fleet |
| Ngôn ngữ app | VI / EN (gửi `preferredLanguage` và `Accept-Language` như cũ) |

---

## 1. Thay đổi ở app

### 1.1 Chỉ còn một vai trò: chủ nhà xe
* Không còn "quản trị viên" và "hành khách" trong app. **Ai đăng nhập được cũng vào thẳng app quản lý**, bất kể `account.role` server trả về là `admin` hay `customer`.
* App **không còn** màn quản lý quản trị viên (`/admin/admins*`), không còn khái niệm "Quản trị viên" trên giao diện (nhãn người dùng là "Chủ nhà xe").
* Toàn bộ màn hình của hành khách (tìm chuyến, đặt ghế, ví vé, giá vé, hồ sơ khách, nhật ký…) **đã bị bỏ khỏi app**.

### 1.2 Có màn **Đăng ký** (mới)
Gọi đúng API cũ `POST /v1/auth/register` (không đổi body):

```json
{ "phone": "0901234567", "email": "tuyen@example.com", "password": "Matkhau123",
  "displayName": "Nhà xe Hà Nội Limo", "acceptTerms": true, "preferredLanguage": "vi",
  "deviceName": "Android · Wayra Fleet", "deviceId": "<id cài đặt>" }
```

| Ô trên form | Trường gửi | Ghi chú |
|---|---|---|
| Tên nhà xe / người phụ trách | `displayName` | 2–60 ký tự |
| Số điện thoại | `phone` | 10 số, bắt đầu bằng 0 |
| Email (không bắt buộc) | `email` | bỏ trống thì không gửi |
| Mật khẩu + nhập lại | `password` | ≥ 8 ký tự, chữ hoa + chữ thường + số (kiểm tra ở app, BE vẫn kiểm tra `weak_password`) |
| Công tắc đồng ý điều khoản | `acceptTerms: true` | bắt buộc bật mới gửi |

Sau khi đăng ký thành công app dùng luôn `tokens` trả về và vào màn Tổng quan (giống đăng nhập).
Lỗi hiển thị theo `code` hiện có: `phone_taken`, `email_taken`, `weak_password`, `validation_failed`…

### 1.3 Đăng nhập
Một ô duy nhất "Số điện thoại hoặc email" → `POST /v1/auth/login` `{ login, password, deviceName, deviceId }` như cũ. Có "Ghi nhớ đăng nhập" (lưu cục bộ, mã hóa trên máy). Quên mật khẩu dùng `/auth/forgot` và `/auth/reset` như cũ.

### 1.4 Thanh điều hướng mới (4 tab)

| Tab | Nội dung | API chính |
|---|---|---|
| **Tổng quan** | Doanh thu (chọn kỳ: hôm nay / 7 ngày / 30 ngày), biểu đồ doanh thu, việc cần làm, bảng giờ xe chạy hôm nay, nguồn doanh thu, tuyến bán chạy, khung giờ bán chạy, xe & nhân sự, đơn gần đây | `/manage/dashboard`, `/manage/revenue`, `/manage/inbox/counts`, `/bookings/{id}` |
| **Lịch biểu** | Lịch chạy theo ngày, chi tiết chuyến (ghế, khách, trung chuyển, hàng, vận hành) | `/manage/trips*` |
| **Đặt xe** | Danh sách đặt xe: đơn chờ duyệt, chờ thu tiền, hủy & đổi, gửi đồ, khiếu nại | `/manage/bookings`, `/manage/parcels`, … |
| **Thêm** | Đội xe (xe, tài xế, tuyến, văn phòng), đơn hàng, gửi đồ, chính sách, khách hàng, khuyến mãi, đánh giá, thông báo chung, doanh thu, báo cáo, cấu hình, nhập/xuất CSV, tài khoản | `/manage/*`, `/admin/*` |

### 1.5 Nội dung
Văn bản, ví dụ và onboarding đã chuyển sang bối cảnh **đội xe limo các tuyến miền Bắc** (Hà Nội – Sa Pa, Hạ Long, Ninh Bình, Hà Giang, Hải Phòng…). App **không gõ cứng danh sách tỉnh/tuyến**, mọi thứ lấy từ API.

### 1.6 Hành vi khi API lỗi / chưa có dữ liệu
Mọi màn **luôn hiển thị UI** (số 0, danh sách rỗng, biểu đồ phẳng). Nếu lần tải đầu lỗi, có một thanh nhỏ ở đáy màn ghi nội dung lỗi và nút **Thử lại**; không còn màn lỗi che hết nội dung.

---

## 2. Việc cần BE làm / xác nhận

### 2.1 🔴 Quyền của tài khoản vừa đăng ký (quan trọng nhất)
Hiện `/v1/manage/*` và `/v1/admin/*` **chỉ cho `role = admin`**, còn `/auth/register` chỉ tạo `role = customer`.
App coi **mọi tài khoản đăng nhập là chủ nhà xe**, nên tài khoản vừa đăng ký sẽ vào được app nhưng **mọi lời gọi `/manage/*` và `/admin/*` bị `403 forbidden`** (app hiện banner lỗi, các màn trống).

Cần BE chọn một hướng:
1. **Cho `/auth/register` tạo tài khoản có quyền quản lý** (ví dụ `role = operator`/`admin`), hoặc
2. Cho `/manage/*`, `/admin/*` chấp nhận mọi tài khoản đã đăng ký (bỏ kiểm tra `role = admin`), hoặc
3. Đề xuất cách khác (ví dụ endpoint riêng `POST /auth/register-operator`) — nói để app đổi đúng endpoint.

### 2.2 🔴 Một nhà xe hay nhiều nhà xe?
Hệ thống hiện là **một nhà xe duy nhất** (một bộ xe, tuyến, văn phòng, đơn dùng chung). Nếu cho phép đăng ký tự do:
* Mỗi tài khoản đăng ký có là **một nhà xe riêng** (multi-tenant, dữ liệu tách theo tài khoản/`operatorId`) hay **cùng quản lý một dữ liệu chung**?
* Nếu multi-tenant: cần `operatorId` ngầm theo token (app **không** gửi tham số nhà xe), và danh mục `provinces` dùng chung.
* Nếu một nhà xe: ai cũng đăng ký là thấy/sửa được toàn bộ dữ liệu — cần xác nhận đây là chủ ý, hoặc có bước **duyệt tài khoản** (trạng thái chờ duyệt → app cần mã lỗi/`status` để báo "đang chờ duyệt").

### 2.3 🟠 Bổ sung dữ liệu cho `GET /manage/dashboard` → `recentBookings`
Hiện chỉ có `{ id, code, status, source, totalAmount, trip, createdAt }`. Màn Tổng quan cần hiển thị **tên người đặt, người đi, tuyến, ghế** và **không hiển thị mã/ID**. Hiện app phải gọi thêm `GET /bookings/{id}` cho từng đơn (tối đa 4 request mỗi lần mở).
Đề xuất thêm vào mỗi phần tử:

```json
{ "id": "…", "status": "pending", "totalAmount": 250000, "createdAt": "…",
  "customer": { "displayName": "Nguyễn Văn An", "phone": "0901234567" },
  "passengers": [{ "name": "Trần Thị Bình", "seat": "B1" }],
  "routeName": "Hà Nội → Sa Pa", "departAt": "2026-11-23T06:30:00Z" }
```
`trip` hiện lúc là id, lúc là object nên app không đọc được tên tuyến — đề nghị **luôn là object** `{ id, route: { id, name } }` hoặc dùng `routeName`.

### 2.4 🟠 Danh sách đơn phải kèm tên khách
`GET /manage/bookings` (và `/manage/inbox?type=…`): mỗi đơn cần có `customer: { displayName, phone }` **hoặc** `guest: { name, phone }` (đặt hộ). App đọc `customer.displayName/phone` và `guest.name/phone`; nếu thiếu, tiêu đề hàng trong "Đặt xe" bị trống. App **không còn tải** danh sách tài khoản khách để tra tên.

### 2.5 🟡 `topHours` đủ khung giờ
Hiện chỉ trả các giờ bán chạy nhất. App vẽ đường cong 05h–22h; giờ không có trong mảng được coi là 0. Nếu trả **đủ mọi giờ có chuyến** (kể cả ít ghế) thì đường cong sẽ chính xác.

### 2.6 🟡 Gom theo vùng (tùy chọn, cho miền Bắc)
Để lọc/nhóm theo cụm (Hà Nội · Hải Phòng–Quảng Ninh · Lào Cai–Hà Giang…): thêm `region`/`cluster` vào `provinces` hoặc `routes`, và tham số lọc tương ứng ở `/manage/trips`, `/manage/revenue`. App **chưa dùng**, chỉ cần BE cho biết có làm không.

### 2.7 🟡 Dọn dẹp phía BE (không bắt buộc)
* Endpoint quản trị viên `/admin/admins`, `/admin/admins/{id}/reset-password`, `/admin/admins/{id}/revoke` **app không gọi nữa**.
* Tài khoản mặc định tạo từ `db:init` vẫn dùng bình thường để đăng nhập.

### 2.8 Câu hỏi cần BE trả lời
1. Hướng nào ở **2.1** (quyền sau đăng ký)?
2. **2.2**: một nhà xe hay nhiều nhà xe? Có duyệt tài khoản mới không?
3. `/auth/register` có cần thêm trường riêng cho nhà xe (tên công ty, mã số thuế, địa chỉ…) không? App hiện chỉ gửi `displayName`.
4. Trang xóa tài khoản/chính sách quyền riêng tư dùng cho Google Play: giữ URL cũ `…/account/delete`, `…/privacy` hay đổi theo tên app mới?

---

## 3. API app đang gọi (nhóm theo chức năng)

Ký hiệu: 🔒 cần `Authorization: Bearer`. Tham số chính ghi trong ngoặc.

### Tài khoản & phiên
| API | Ghi chú |
|---|---|
| `POST /auth/register` | màn Đăng ký (1.2) |
| `POST /auth/login` | `{ login, password, deviceName, deviceId }` |
| `POST /auth/refresh`, `POST /auth/logout` 🔒 | như cũ |
| `POST /auth/forgot`, `POST /auth/reset` | quên mật khẩu |
| `POST /auth/change-password` 🔒 | đổi mật khẩu |
| `GET /me`, `DELETE /me` 🔒 | hồ sơ, xóa tài khoản |
| `GET /devices`, `DELETE /devices/{id}` 🔒 | thiết bị đã đăng nhập |
| `GET /operator`, `GET /provinces`, `GET /faq`, `GET /announcements` | danh mục chung |

### Tổng quan 🔒
`GET /manage/dashboard` (`range=today\|7d\|30d`, `chart=7\|30`) · `GET /manage/revenue` (`from`, `days=60`) · `GET /manage/inbox/counts` · `GET /bookings/{id}` (4 đơn gần đây, xem 2.3) · `GET /admin/search` (`q`)

### Lịch biểu 🔒
`GET /manage/trips` (`from`, `to`, `routeId`) · `GET /manage/trips/{id}` · `/manifest` · `/seats` · `/shuttle` · `/expenses` · `/driver-text` (`lang`) ·
`POST /manage/trips` · `PATCH /manage/trips/{id}` · `DELETE /manage/trips/{id}` ·
`POST /manage/trips/{id}/status | /cancel | /notify | /expenses | /seats/{label}/lock|unlock` ·
`PUT /manage/trips/{id}/driver | /vehicle | /parcel-capacity` · `PATCH /manage/trips/{id}/checklist/{itemId}`

### Đặt xe / hộp thư 🔒
`GET /manage/bookings` (`status=pending|confirmed|cancel_requested`, `payment=unpaid`, `q`, `tripId`) ·
`POST /manage/bookings/{id}/approve | reject | collect | approve-cancel | reject-cancel | cancel | refund | notes | move | assign-seats` · `POST /manage/bookings/approve` (hàng loạt) ·
`GET /bookings/{id}`, `GET /bookings/{id}/history`, `GET /bookings/{id}/share-text` ·
Gửi đồ: `GET /manage/parcels` (`status`, `q`), `POST /manage/parcels`, `POST /manage/parcels/{id}/handover | cancel | reject | issue` ·
Hỗ trợ: `GET /admin/complaints`, `/admin/reports`, `/admin/contact-messages`, `POST /admin/reports/{id}/resolve`, `POST /admin/contact-messages/{id}/reply`, `POST /complaints/{id}/replies`

### Thêm → Đội xe 🔒
* Xe: `GET/POST /manage/vehicles`, `PATCH /manage/vehicles/{id}`, `GET /manage/seat-layouts`
* Nhân sự: `GET/POST /admin/staff`, `PATCH /admin/staff/{id}`, `GET/POST/DELETE /admin/staff-schedules`
* Tuyến & trung chuyển: `GET/POST /manage/routes`, `PATCH /manage/routes/{id}`, `POST /manage/routes/{id}/duplicate`, `GET/POST /manage/shuttle-zones`, `PATCH /manage/shuttle-zones/{id}`, `PATCH /manage/shuttle-requests/{id}`, `GET /offices/{id}/shuttle-zones`
* Văn phòng: `GET/POST /manage/offices`, `PATCH /manage/offices/{id}`

### Thêm → các mục còn lại 🔒
* Khách hàng/khách quầy: `GET /manage/customers` (`q`), `POST /manage/customers/{id}/lock|unlock`, `GET/POST /admin/guests`, `PATCH /admin/guests/{id}`
* Khuyến mãi: `GET/POST /admin/promotions`, `PATCH /admin/promotions/{id}`, `POST /admin/promotions/{id}/grant`
* Đánh giá: `GET /manage/reviews`, `POST /manage/reviews/{id}/reply | hide | show`
* Thông báo chung: `GET/POST /admin/announcements`
* Gửi đồ cấu hình: `GET /admin/parcel-categories`, `GET/POST/DELETE /admin/prohibited-items`
* Báo cáo & đối soát: `GET /manage/reports/{kind}` (`from`, `to`), `GET /admin/provinces`
* Cấu hình: `GET /admin/settings`, `PUT /admin/settings/{key}`
* Nhập / xuất CSV: `POST /admin/import/{type}`, `GET /manage/export` (`type=bookings|trips|reconciliation|parcels`, `from`, `to`; trả CSV text)

---

## 4. API **không còn dùng** trong app

Phần dành cho hành khách (app mới không gọi): `GET /home`, `GET /trips`, `GET /trips/{id}`, `/trips/{id}/seats`, `/trips/{id}/alternatives`, `/trips/{id}/waitlist`, `GET /routes/available`, `POST /bookings` (khách tạo đơn), `POST /bookings/{id}/cancel`, `GET /bookings/{id}/cancel-preview`, `/me/favorite-routes`, `/me/recent-routes`, `/me/loyalty`, `/me/vouchers`, `/me/waitlist`, `/notifications*`, `/reviews*` (phía khách), `POST /complaints`, `POST /contact`, `POST /parcels`, `/parcels/quote`, `/parcels/config` (phía khách), `/admin/admins*`.
BE **không cần xóa** các endpoint này; chỉ để biết app đã ngừng dùng.

---

## 5. Kiểm thử gợi ý
1. Đăng ký tài khoản mới → vào app → mở 4 tab: không có `403` (liên quan 2.1).
2. Đăng ký trùng SĐT/email → `409 phone_taken` / `email_taken` hiển thị đúng.
3. Tổng quan: mục "Đơn gần đây" hiện tên người đặt và tuyến, **không có mã/ID** (liên quan 2.3).
4. Tab Đặt xe: mỗi hàng có tên khách (liên quan 2.4).
5. Tắt mạng / trả `500` ở `/manage/dashboard`: app vẫn hiện UI rỗng kèm nút Thử lại.
