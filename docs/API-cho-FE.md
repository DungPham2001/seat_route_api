# Nhà xe Việt Nam API — tài liệu ghép API cho app Android (Wayra Fleet)

| | |
|---|---|
| **Base URL** | `https://seatrouteapi.vercel.app` — mọi endpoint nằm dưới `/v1`, ví dụ `https://seatrouteapi.vercel.app/v1/auth/login` |
| **Kiểm tra sống** | `GET https://seatrouteapi.vercel.app/v1/health` |
| **Trang xóa tài khoản** (khai trên Google Play) | `https://seatrouteapi.vercel.app/account/delete` (`?lang=en` cho tiếng Anh) |
| **Chính sách quyền riêng tư** (khai trên Google Play) | `https://seatrouteapi.vercel.app/privacy` (`?lang=en`) |
| **Định dạng** | Chỉ HTTPS, JSON UTF-8. Thời điểm ISO 8601 UTC (`2026-11-20T00:30:00Z`), ngày địa phương `yyyy-MM-dd`, giờ địa phương `HH:mm`. Tiền là **số nguyên đồng** |
| **Đăng nhập** | `Authorization: Bearer <accessToken>` ở mọi endpoint có 🔒 (gần như tất cả) |
| **Vai trò** | `admin` (chủ nhà xe / quản lý — **mặc định khi đăng ký**) và `customer` (hành khách, đăng ký với `accountType:"customer"`). Máy chủ kiểm tra vai trò ở **mọi** endpoint |
| **Nhiều nhà xe** | Mỗi tài khoản đăng ký là **một nhà xe riêng** (xe, tuyến, văn phòng, chuyến, đơn, cài đặt tách hẳn). Nhà xe lấy ngầm từ token, app **không** gửi tham số nhà xe. Danh mục tỉnh/thành dùng chung (chỉ đọc) |

### Thay đổi gần đây
| Ngày | Thay đổi | FE cần làm |
|---|---|---|
| 2026-11-22 | **Đặt vé lúc nào cũng được:** bỏ chốt 4 giờ và giới hạn 7 ngày. Chỉ chặn khi chuyến đã hủy / đang chạy / đã hoàn thành, hoặc chủ nhà xe tự đóng bán (`salesClosed`) → `409 trip_not_on_sale`. Không còn lỗi `booking_closed` và trạng thái bán `not_open`; `bookingRule` = `{ maxSeats, anytime: true }`. Vẫn tối đa 6 ghế/đơn | Bỏ xử lý `booking_closed` |
| 2026-11-22 | **Wayra Fleet — nhiều nhà xe.** `POST /auth/register` mặc định tạo **một nhà xe mới** (`role: admin`, dữ liệu rỗng, đã có sẵn 3 mẫu sơ đồ ghế, loại hàng, hàng cấm, checklist). Dữ liệu `/manage/*`, `/admin/*` tách theo nhà xe; nhà xe khác không đọc/sửa được (`404`). Đăng ký thêm `companyName`, `address`, `taxCode`; hành khách dùng `accountType: "customer"`. `dashboard.recentBookings` có thêm `customer`, `passengers`, `routeName`, `departAt` và `trip` luôn là object; `topHours` trả đủ các giờ có chuyến. `/admin/provinces` chỉ còn đọc. Xóa tài khoản chủ nhà xe cuối cùng sẽ xóa luôn dữ liệu nhà xe | Đăng ký không cần đổi body; bỏ chỗ gọi tạo/sửa tỉnh |
| 2026-11-20 | **Đổi mô hình theo tài liệu app (`SeatRoute-tai-lieu-BE.md`)**: khách **trả tiền tại quầy**, không còn ảnh chứng từ / QR / ngân hàng. Tạo đơn **giữ ghế ngay**; nhà xe **duyệt** hoặc **từ chối**; sau khi khách trả, nhà xe bấm **xác nhận đã thu tiền** (`collect`) — doanh thu tính theo ngày thu. Xem [5](#5--đặt-ghế-và-trả-tiền-tại-quầy) và [9.4](#94--duyệt-đơn-và-thu-tiền) | Bỏ màn hình gửi ảnh / QR; trạng thái đơn mới (11.1) |
| 2026-11-20 | Chốt đặt trước giờ chạy **4 giờ** (khách và quầy), khách đặt tối đa **7 ngày** tới, tối đa **6 ghế**/đơn. Lỗi mới `422 booking_closed`, `400 too_many_seats`, `409 seat_conflict` (thay `seat_taken`) | Xử lý các lỗi mới |
| 2026-11-20 | Tài khoản: **email tùy chọn**, SĐT bắt buộc; mật khẩu cần chữ hoa + chữ thường + số; **không ép đổi mật khẩu** (bỏ `mustChangePassword` / `password_change_required`); quên mật khẩu chỉ có SĐT → tin vào hộp thư liên hệ của admin | Cập nhật form đăng ký / quên mật khẩu |
| 2026-11-20 | **Đã xóa:** `/banks`, `/bookings/{id}/payment-info`, `/bookings/{id}/proofs`, `/proofs/*`, `/files/*`, `/me/passengers`, `/me/addresses`, `/me/receivers`, `/me/refund-account`, `/me/emergency`, `/me/preferences`, `/admin/bank-info*`, đổi ghế/đổi chuyến do khách yêu cầu, điểm đổi tiền, giảm giá trẻ em, nhập riêng từng ghế | Xóa khỏi app |
| 2026-11-20 | **Mới:** `POST /manage/bookings/{id}/approve\|reject\|collect\|approve-cancel\|reject-cancel`, `GET /manage/revenue`, `/manage/customers` (CRUD), `/me/favorite-routes`, `/me/recent-routes`, `/cancel-policy`, `/admin/prohibited-items`, phụ thu ghế theo xe, xe trung chuyển | Gọi theo mục tương ứng |
| 2026-11-19 | API đã deploy: Base URL `https://seatrouteapi.vercel.app`; đăng nhập bằng **email hoặc số điện thoại** (`login`); SĐT duy nhất (`409 phone_taken`) | Cấu hình Base URL; ô "Email hoặc SĐT" |

**Mô hình thanh toán (đọc trước):** không có thanh toán trong app. Khách đặt → ghế bị giữ → nhà xe duyệt → khách đến quầy trả tiền mặt / chuyển khoản trực tiếp → nhà xe bấm "Xác nhận đã thu tiền". Doanh thu chỉ cộng khi đã thu, vào **ngày thu**. Đặt hộ tại quầy thì thu luôn lúc bán.

Ký hiệu: 🔒 = cần đăng nhập · 👤 = chỉ khách hàng · 🛠 = chỉ quản trị viên · `*` = bắt buộc.

**Mục lục**
[0. Tóm tắt endpoint](#0-tóm-tắt-endpoint) ·
[1. Quy ước chung](#1-quy-ước-chung) ·
[2. Tài khoản và phiên](#2-tài-khoản-và-phiên) ·
[3. Danh mục chung](#3--danh-mục-chung) ·
[4. Tìm chuyến và sơ đồ ghế](#4--tìm-chuyến-và-sơ-đồ-ghế) ·
[5. Đặt ghế và thanh toán](#5--đặt-ghế-và-thanh-toán) ·
[6. Gửi đồ](#6--gửi-đồ) ·
[7. Thông báo](#7--thông-báo) ·
[8. Home và Profile](#8--home-và-profile-khách-hàng) ·
[9. Quản trị viên](#9--quản-trị-viên) ·
[10. CRUD danh mục](#10--crud-danh-mục) ·
[11. Bảng nhãn hiển thị](#11-bảng-nhãn-hiển-thị) ·
[12. Luồng màn hình](#12-luồng-màn-hình-đề-xuất) ·
[13. Giới hạn](#13-giới-hạn)

---

## 0. Tóm tắt endpoint

### Công khai (không cần token)
| Method | Đường dẫn | Mục |
|---|---|---|
| GET | `/v1/health` | [2.1](#21-get-v1health) |
| POST | `/v1/auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` | [2](#2-tài-khoản-và-phiên) |
| POST | `/v1/auth/forgot` · `/auth/reset` | [2.6](#26-quên--đặt-lại-mật-khẩu) |

### Cả hai vai trò 🔒
| Method | Đường dẫn | Mục |
|---|---|---|
| POST | `/v1/auth/change-password` | [2.7](#27--đổi-mật-khẩu) |
| GET / PATCH / DELETE | `/v1/me` | [2.8](#28--hồ-sơ-và-xóa-tài-khoản) |
| GET / DELETE | `/v1/devices`, `/v1/devices/{id}` (alias `/v1/me/devices`) | [2.9](#29--thiết-bị-đã-đăng-nhập) |
| GET / POST / DELETE | `/v1/notifications`, `/notifications/unread-count`, `/notifications/read`, `/notifications/{id}` | [7](#7--thông-báo) |
| GET | `/v1/operator`, `/cancel-policy`, `/provinces`, `/provinces/{id}/offices`, `/offices`, `/offices/{id}/shuttle-zones`, `/routes/available`, `/routes/{id}/info`, `/faq`, `/content/{key}`, `/announcements`, `/reviews` | [3](#3--danh-mục-chung) |
| GET | `/v1/trips`, `/trips/{id}`, `/trips/{id}/seats`, `/trips/{id}/alternatives` | [4](#4--tìm-chuyến-và-sơ-đồ-ghế) |
| POST | `/v1/bookings/quote` | [5.1](#51--báo-giá) |
| GET | `/v1/bookings`, `/bookings/{id}`, `/bookings/{id}/history`, `/bookings/{id}/share-text` | [5.3](#53--danh-sách-và-chi-tiết-đơn) |
| GET / POST | `/v1/bookings/{id}/messages` | [5.6](#56--trao-đổi-trong-đơn) |
| PATCH | `/v1/bookings/{id}/shuttle` | [5.5](#55--sửa-xe-trung-chuyển) |
| GET / POST | `/v1/parcels`, `/parcels/config`, `/parcels/quote`, `/parcels/{id}` | [6](#6--gửi-đồ) |
| GET / POST | `/v1/complaints/{id}`, `/complaints/{id}/replies`, `/reports` | [8.6](#86--đánh-giá-báo-cáo-khiếu-nại-liên-hệ) |

### Khách hàng 👤
| Method | Đường dẫn | Mục |
|---|---|---|
| GET | `/v1/home` | [8.1](#81--get-v1home) |
| POST | `/v1/bookings` | [5.2](#52--tạo-đơn-giữ-ghế-ngay) |
| GET / POST | `/v1/bookings/{id}/cancel-preview`, `/bookings/{id}/cancel` | [5.4](#54--hủy-đơn-và-hoàn-tiền) |
| GET | `/v1/bookings/{id}/rebook` | [5.7](#57-đặt-lại-nhanh) |
| POST | `/v1/trips/{id}/waitlist` | [4.5](#45--danh-sách-chờ) |
| POST / GET | `/v1/parcels`, `/parcels/{id}/cancel-preview`, `/parcels/{id}/cancel`, `/parcels/{id}/handover-code`, `/parcels/{id}/share-text`, `/parcels/{id}/issue` | [6](#6--gửi-đồ) |
| POST / PATCH / DELETE | `/v1/reviews`, `/reviews/{id}`, `/complaints`, `/contact` | [8.6](#86--đánh-giá-báo-cáo-khiếu-nại-liên-hệ) |
| GET / POST / DELETE | `/v1/me/favorite-routes`, `/me/favorite-routes/{routeId}`, `/me/recent-routes` | [8.2](#82--tuyến-yêu-thích-và-đặt-nhanh) |
| GET / POST | `/v1/me/loyalty`, `/me/vouchers`, `/me/referral`, `/me/stats` | [8.3](#83--điểm-hạng-ví-mã-giới-thiệu-thống-kê) |
| GET / DELETE | `/v1/me/requests`, `/me/requests/{id}`, `/me/refunds`, `/me/waitlist`, `/me/waitlist/{id}`, `/me/reviews`, `/me/complaints`, `/me/contact` | [8.4](#84--hoạt-động-của-tôi) |
| GET | `/v1/me/data`, `/me/export` | [8.5](#85--quyền-riêng-tư) |

### Quản trị viên 🛠
| Nhóm | Đường dẫn chính | Mục |
|---|---|---|
| Tổng quan | `GET /v1/manage/dashboard`, `/manage/inbox/counts`, `/manage/inbox?type=`, `/manage/calendar` | [9.2](#92--tổng-quan-tab-tổng-quan), [9.3](#93--cần-xác-nhận-hàng-đợi-và-lịch) |
| Duyệt đơn & thu tiền | `POST /v1/manage/bookings/{id}/approve`, `/reject`, `/collect`, `/approve-cancel`, `/reject-cancel`, `POST /manage/bookings/approve` | [9.4](#94--duyệt-đơn-và-thu-tiền) |
| Đơn đặt ghế | `GET/POST /v1/manage/bookings`, `/manage/bookings/{id}/assign-seats`, `/move`, `/cancel`, `/notes`, `/refund` | [9.5](#95--đơn-đặt-ghế-đặt-hộ-xếp-chỗ) |
| Hoàn tiền | `/v1/manage/requests`, `/manage/refunds`, `/manage/refunds/{id}/record` | [9.6](#96--yêu-cầu-hủy-và-hoàn-tiền) |
| Chuyến | `/v1/manage/trips` (+ ~25 thao tác), `/manage/series` | [9.7](#97--chuyến-tab-chuyến), [9.8](#98--chuyến-lặp-theo-lịch) |
| Gửi đồ | `/v1/manage/parcels` (+ accept, reject, status, handover...) | [9.9](#99--gửi-đồ-quản-trị) |
| Nội dung | `/v1/manage/reviews`, `/manage/messages`, `/admin/reports`, `/admin/complaints`, `/admin/contact-messages`, `/admin/actions` | [9.10](#910--đánh-giá-báo-cáo-khiếu-nại-tin-nhắn) |
| Doanh thu & báo cáo | `GET /v1/manage/revenue`, `/manage/reports/{kind}`, `/manage/export` | [9.11](#911--doanh-thu-đối-soát-và-báo-cáo) |
| Cấu hình | `/v1/admin/settings/{key}`, `/admin/operator`, `/admin/cancel-policy` | [9.12](#912--cấu-hình-nhà-xe) |
| Tài khoản | `/v1/admin/admins`, `/manage/customers` (alias `/admin/customers`) | [9.13](#913--quản-trị-viên-và-khách-hàng) |
| Công cụ | `/v1/admin/search`, `/admin/import/{type}`, `/admin/onboarding` | [9.14](#914--công-cụ) |
| Danh mục (CRUD) | văn phòng, khu vực trung chuyển, sơ đồ ghế, xe (limo / trung chuyển), bảo dưỡng, tuyến, nhân viên, lịch, tỉnh, khuyến mãi, giá mùa, tin, FAQ, việc trước giờ chạy, cước, loại hàng, hàng cấm, khách tại quầy, chi phí chuyến | [10](#10--crud-danh-mục) |

---

## 1. Quy ước chung

### 1.1 Header
| Header | Khi nào | Ghi chú |
|---|---|---|
| `Authorization: Bearer <accessToken>` | Mọi endpoint 🔒 | Không đưa token vào URL, log hay tệp xuất |
| `Accept-Language: vi` hoặc `en` | Nên gửi ở mọi request | Ngôn ngữ của `message` lỗi, của chữ thông báo (`title`, `text`) và của email |
| `X-App-Version: 1.0.0` | Nên gửi ở mọi request | Cũ hơn `minAppVersion` → `426 upgrade_required` |
| `Content-Type: application/json` | Request có body JSON | |
| `Idempotency-Key: <uuid>` | `POST /auth/register`, `POST /bookings`, `POST /parcels` | Sinh **một lần** cho mỗi thao tác, dùng lại khi thử lại sau mất mạng → không tạo đơn trùng |

Mọi phản hồi có `X-Request-Id` (trùng `requestId` trong body lỗi): ghi vào nhật ký lỗi của app để tra cứu.

### 1.2 Lỗi
```json
{ "code": "validation_failed", "message": "Dữ liệu không hợp lệ",
  "fields": [{ "field": "email", "code": "invalid_format" }, { "field": "acceptTerms", "code": "terms_required" }],
  "requestId": "req_645d04d404aa" }
```
App **dịch theo `code`**, `message` chỉ là chữ dự phòng theo `Accept-Language`. Lỗi có thể kèm trường thêm (ví dụ `takenSeats`, `freeSeats`, `retryAfter`, `conflicts`).

**Mã lỗi từng trường** (`fields[].code`): `required`, `invalid_type`, `too_short`, `too_long`, `out_of_range`, `invalid_format`, `invalid_enum`, `weak_password`, `terms_required`, `same_as_old`, `wrong_password`, `not_found` (id liên kết không tồn tại), `duplicate`, `office_not_on_route`, `office_closed`, `wrong_province`, `same_as_from`, `different_route`, `layout_required`, `shuttle_unavailable`, `promo_invalid`, `promo_used_up`, `promo_min_amount`, `parcel_prohibited`, `parcel_no_rate`, `commitment_required`, `not_lost`, `not_allowed`, `standard_required`.

| HTTP | `code` | App nên làm |
|---|---|---|
| 400 | `validation_failed` | Tô đỏ các trường trong `fields` |
| 400 | `reset_invalid` | "Mã đặt lại không đúng hoặc đã hết hạn" |
| 400 | `too_many_seats` (trong `fields`) | "Mỗi đơn tối đa 6 ghế" |
| 400 | `handover_invalid` | Mã nhận hàng sai, còn `attemptsLeft` lần |
| 401 | `unauthorized`, `token_expired`, `token_invalid` | Gọi `/auth/refresh` **một lần** rồi gửi lại request |
| 401 | `session_revoked`, `session_expired`, `refresh_invalid`, `refresh_reused` | Về màn hình đăng nhập, **giữ bản nháp đang nhập trong bộ nhớ** |
| 401 | `invalid_credentials` | "Email / số điện thoại hoặc mật khẩu không đúng" |
| 403 | `forbidden` | Sai vai trò (khách gọi endpoint quản trị hoặc ngược lại) |
| 403 | `account_suspended` | "Tài khoản đang bị khóa" (có `reason` khi đăng nhập) |
| 403 | `wrong_password` | Mật khẩu xác nhận sai (đổi mật khẩu, đổi email, xóa tài khoản) |
| 404 | `not_found` | Bản ghi không còn, hoặc không phải của bạn |
| 409 | `email_taken`, `phone_taken`, `duplicate` | Thông báo tương ứng |
| 409 | `seat_conflict` | "Ghế vừa có người đặt" — body có `takenSeats`, `freeSeats`: tải lại sơ đồ ghế. **Không tạo đơn nào** |
| 409 | `seat_unavailable` | Ghế không bán / đang khóa |
| 409 | `trip_not_on_sale` | Chuyến hết hạn bán / chưa mở bán (`status` trong body) |
| 409 | `office_not_on_route`, `shuttle_unavailable`, `shuttle_deadline_passed` | Chọn lại văn phòng / khu vực; quá hạn trung chuyển → "liên hệ nhà xe" |
| 409 | `promo_invalid`, `promo_expired`, `promo_used_up`, `promo_min_amount` (`minAmount`) | Báo ở ô mã giảm giá / điểm |
| 422 | `booking_closed` | *(đã bỏ — đặt vé không còn giới hạn thời gian)* |
| 409 | `invalid_status` | Thao tác không hợp lệ ở trạng thái hiện tại: tải lại đơn |
| 409 | `cancel_not_allowed`, `pending_request_exists` | Thông báo tương ứng |
| 409 | `review_not_allowed`, `already_reviewed`, `waitlist_exists` | Thông báo tương ứng |
| 409 | `parcel_disabled`, `parcel_prohibited`, `parcel_too_heavy` (`maxWeightKg`), `parcel_no_rate`, `capacity_exceeded` (`capacity`, `load`), `handover_locked` | Thông báo tương ứng |
| 409 | `has_active_orders` | Không xóa được tài khoản khi còn chuyến chưa xong / hoàn tiền chờ |
| 409 | `in_use` | Không xóa được vì đã được dùng (`bookings`, `parcels`, gợi ý khóa tài khoản) |
| 409 | `has_dependents` | Không xóa được bản ghi vì còn liên kết; `blockedBy: [{resource, count}]` |
| 409 | `schedule_conflict` / `driver_unavailable` / `vehicle_inactive` / `seats_mismatch` / `trip_has_bookings` / `last_admin` | Xem phần quản trị |
| 413 | `payload_too_large` | Dữ liệu gửi lên quá lớn |
| 426 | `upgrade_required` | Màn hình bắt buộc cập nhật (`minAppVersion`, `latestAppVersion`) |
| 429 | `too_many_attempts`, `rate_limited` | Chờ `Retry-After` giây (`retryAfter` trong body) |
| 503 / 5xx | `service_unavailable`, `internal_error` | "Máy chủ đang bận / gặp sự cố" + nút thử lại |

Không nhận được phản hồi (mất mạng, timeout, DNS, SSL): lỗi phía app → "Không có kết nối mạng" + nút thử lại. Đặt timeout ~15 giây, không thử lại vô hạn.

### 1.3 Phân trang
Danh sách trả `{ "items": [...], "nextCursor": "MjA" | null, "total": 42 }`. Trang sau: gửi `?cursor=<nextCursor>`; `limit` mặc định 20-100 tùy danh sách, tối đa 200.

### 1.4 Ngày giờ và tiền
* `departAt`, `createdAt`... là UTC. Để hiển thị dùng luôn các trường địa phương server trả kèm: `date`, `departTime`, `arriveTime`, `tzOffset` (`+07:00`), `plannedTime`, `arriveTime` của văn phòng.
* **Giờ xe tới văn phòng = giờ khởi hành + `offsetMinutes`** (server đã tính sẵn `arriveAt`/`arriveTime`).
* Tiền là số nguyên đồng; app định dạng theo ngôn ngữ (`250.000 ₫` / `250,000 VND`).

### 1.5 Token và phiên (giống RoomKeep)
* Access token ~2 giờ, refresh token trượt 3 giờ, phiên tối đa 12 giờ (`sessionExpiresAt`).
* **Chỉ giữ token trong bộ nhớ**, không lưu xuống máy. Thoát hẳn app → đăng nhập lại; ở nền > ~1 giờ → app tự bỏ phiên.
* Làm mới **một luồng duy nhất**: nhiều request cùng gặp 401 dùng chung một lần `/auth/refresh`. Mỗi lần refresh trả cặp mới, cặp cũ vô hiệu; gửi lại refresh token cũ → cả phiên bị thu hồi (`refresh_reused`).
* Làm mới chủ động khi access token còn ~5 phút và app đang ở trước màn hình.

---

## 2. Tài khoản và phiên

### 2.1 `GET /v1/health`
```json
{ "status": "ok", "apiVersion": "1.0.0", "minAppVersion": "1.0.0", "latestAppVersion": "1.0.0", "serverTime": "2026-11-19T02:46:21Z", "timezone": "Asia/Ho_Chi_Minh" }
```

### 2.2 `POST /v1/auth/register` → `201` (tạo nhà xe mới, hoặc hành khách)
* **Mặc định tạo chủ nhà xe**: `role: "admin"`, đăng nhập xong dùng được ngay `/manage/*`, `/admin/*` trên dữ liệu **riêng** của mình (rỗng). Không có bước duyệt tài khoản.
* Thêm tùy chọn cho nhà xe: `companyName` (≤120, mặc định = `displayName`), `address` (≤300), `taxCode` (≤30). Chúng nằm trong `GET /operator` → `profile`.
* Muốn tạo **hành khách** (app khách cũ): gửi `"accountType": "customer"`; khi đó mới có `referralCode`, ví mã `CHAOBAN`, `member`.
```json
{ "phone": "0901234567", "email": "an@example.com", "password": "Matkhau123", "displayName": "Nguyễn Văn An",
  "acceptTerms": true, "preferredLanguage": "vi", "referralCode": "U4MTLA", "deviceName": "Pixel 8", "deviceId": "<id cài đặt>" }
```
* `phone*` (server chuẩn hóa `+84 901 234 567` → `0901234567`; **mỗi SĐT chỉ một tài khoản** vì dùng để đăng nhập → trùng: `409 phone_taken`), `displayName*` ≤60, `password*` 8-72 byte có **chữ hoa, chữ thường và số** (`weak_password`), `acceptTerms*` = `true`.
* `email` **tùy chọn** (không phân biệt hoa thường; trùng → `409 email_taken`). Khách không có email vẫn dùng app, chỉ không nhận được email đặt lại mật khẩu.
* `referralCode` tùy chọn (mã giới thiệu của bạn bè); sai → `400` `fields: [{field:"referralCode", code:"not_found"}]`.
* Tài khoản mới có sẵn mã **`CHAOBAN`** (giảm 10%, dùng một lần) trong ví mã, và mã giới thiệu riêng.
* Gửi lại cùng `Idempotency-Key` + cùng SĐT/mật khẩu → `200` với cùng tài khoản.

Phản hồi (dùng chung cho đăng ký và đăng nhập):
```json
{
  "account": {
    "id": "52be0ea0-…", "email": "an@example.com", "displayName": "Nguyễn Văn An", "phone": "0901234567",
    "role": "customer", "status": "active", "preferredLanguage": "vi",
    "birthDate": null, "gender": null, "avatarColor": "#2E7D32", "initials": "VA", "referralCode": "U4MTLA",
    "createdAt": "2026-11-19T02:46:21Z"
  },
  "member": {
    "enabled": true, "points": 0, "lifetimeEarned": 0,
    "tier": { "name": "Thành viên", "minPoints": 0, "benefitText": "" },
    "nextTier": { "name": "Bạc", "minPoints": 80, "pointsNeeded": 80 }
  },
  "tokens": {
    "tokenType": "Bearer", "accessToken": "eyJ…", "accessTokenExpiresAt": "2026-11-19T04:46:21Z", "expiresIn": 7199,
    "refreshToken": "99bf….xxxx", "refreshTokenExpiresAt": "2026-11-19T05:46:21Z", "sessionExpiresAt": "2026-11-19T14:46:21Z",
    "deviceId": "99bfe355-…"
  }
}
```
* `account.email` có thể là `null`. `member` chỉ có ở tài khoản khách hàng (thẻ điểm/hạng đầu Profile). Ảnh đại diện = `initials` trên nền `avatarColor` (không dùng ảnh).

### 2.3 `POST /v1/auth/login` → `200`
`{ "login": "an@example.com" | "0901234567", "password", "deviceName", "deviceId" }` → như 2.2.
* **`login` = email hoặc số điện thoại**, một ô nhập duy nhất ("Email hoặc số điện thoại"). Có `@` → email (không phân biệt hoa thường); không có → SĐT, server chuẩn hóa `+84 901 234 567`, `84901234567`, `0901.234.567` → `0901234567`. Sai định dạng → `400` `fields: [{field:"login", code:"invalid_format"}]`.
* Trường cũ `email` vẫn nhận (giá trị cũng có thể là SĐT), nhưng FE mới nên gửi `login`.
* **Cùng màn hình cho khách và quản trị viên.** `account.role` quyết định giao diện: `customer` → 4 tab khách; `admin` → 5 tab quản trị (vào thẳng Tổng quan). **Không có bước ép đổi mật khẩu.**
* Sai → `401 invalid_credentials`. Sai 5 lần / 15 phút → `429 too_many_attempts`. Tài khoản bị khóa → `403 account_suspended` (`reason`).
* Đăng nhập lại từ cùng `deviceId` thay phiên cũ của máy đó.

### 2.4 `POST /v1/auth/refresh` → `200`
`{ "refreshToken" }` → `{ "tokens": {...} }`. Lỗi `401 refresh_invalid | refresh_reused | session_expired` → về đăng nhập.

### 2.5 `POST /v1/auth/logout` → `204`
`{ "refreshToken" }`, Bearer tùy chọn. Luôn `204`.

### 2.6 Quên / đặt lại mật khẩu
* `POST /v1/auth/forgot` `{ "login": "<email hoặc SĐT>" }` → **luôn `202`** `{ "status": "accepted" }` (không lộ tài khoản nào tồn tại; tối đa 3 yêu cầu/giờ).
  * Tài khoản **có email**: gửi mã `ABCD-EFGH` (hạn 30 phút, dùng 1 lần; yêu cầu mã mới thì mã cũ hết hiệu lực) tới email đó, dù khách nhập email hay SĐT. Môi trường dev chưa có SMTP: phản hồi có thêm `devToken` để test (production không có).
  * Tài khoản **chỉ có SĐT**: không có mã. Server tạo một tin trong **hộp thư liên hệ của admin** (`subject = "password_reset"`): nhà xe gọi lại xác minh rồi cấp mật khẩu tạm (9.13). App hiện: "Nhà xe sẽ gọi lại để xác minh và cấp mật khẩu tạm".
* `POST /v1/auth/reset` `{ "token": "ABCD-EFGH", "newPassword" }` → `204`. `token` không phân biệt hoa thường, có hay không dấu gạch. Sai/hết hạn → `400 reset_invalid`. Thành công: **mọi thiết bị bị đăng xuất**, bỏ khóa sai mật khẩu, server gửi email "mật khẩu đã thay đổi".

Luồng: *Quên mật khẩu* (nhập email hoặc SĐT) → *Nhập mã + mật khẩu mới* (nút "Gửi lại mã" sau 60 giây; chỉ khi tài khoản có email) → *Đăng nhập*.

### 2.7 🔒 Đổi mật khẩu
`POST /v1/auth/change-password` `{ "oldPassword", "newPassword" }` → `{ "status": "ok", "revokedSessions": 1, "account": {...} }`. Thiết bị hiện tại giữ phiên, thiết bị khác bị đăng xuất. Trùng mật khẩu cũ → `400 same_as_old`; mật khẩu yếu → `weak_password`. Đổi tùy ý trong Hồ sơ, không bắt buộc lần đầu.

### 2.8 🔒 Hồ sơ và xóa tài khoản
* `GET /v1/me` → `{ account, member? }`.
* `PATCH /v1/me` gửi trường muốn đổi: `displayName`, `phone`, `birthDate` (`yyyy-MM-dd`), `gender` (`male|female|other`), `avatarColor` (`#RRGGBB`), `preferredLanguage` (`vi|en`, lưu theo tài khoản), `email` (**kèm `password`** khi đổi email). SĐT đã thuộc tài khoản khác → `409 phone_taken`. Trả như `GET /me`.
* `DELETE /v1/me` `{ "password" }` → `204`.
  * Khách hàng: bị chặn `409 has_active_orders` (`activeBookings`, `activeParcels`, `pendingRefunds`) khi còn chuyến chưa hoàn thành, đơn gửi đồ đang xử lý hoặc hoàn tiền đang chờ. Xóa thật: tài khoản, tuyến yêu thích, tin nhắn, đánh giá, điểm, mã; đơn cũ chỉ còn số tiền (không tên/SĐT/địa chỉ).
  * Quản trị viên cuối cùng không xóa được (`409 last_admin`).
* Trang web yêu cầu xóa (khai trên Google Play): `/account/delete`.

### 2.9 🔒 Thiết bị đã đăng nhập
* `GET /v1/devices` → `{ "devices": [{ "id", "name", "createdAt", "lastSeenAt", "expiresAt", "isCurrent" }] }`
* `DELETE /v1/devices/{id}` → `204` (đăng xuất từ xa ngay).

---

## 3. 🔒 Danh mục chung

| Endpoint | Trả về | Dùng ở |
|---|---|---|
| `GET /v1/operator` | `{ profile: {name, description, phone, email, address, openText, representativeName, licenseNoText, website}, rating, reviewCount, completedTrips, offices: [{provinceId, provinceName, offices:[office]}], rules: [{kind, text}], cancelPolicy, childRule, shuttleRule, parcel }` | Thông tin nhà xe (31, 32), nút gọi nhanh (9) |
| `GET /v1/provinces?hasTrips=true&side=from` | `{ items: [{id, name, nameNoAccent, sortOrder}] }` — chỉ tỉnh **đi** có chuyến đang bán | Ô "Điểm đi" (28) |
| `GET /v1/provinces?hasTrips=true&side=to&fromProvinceId=` | Tỉnh **đến** đi được từ tỉnh đã chọn | Ô "Điểm đến" |
| `GET /v1/routes/available` | `{ items: [{routeId, name, fromProvinceId, fromProvinceName, toProvinceId, toProvinceName, durationMinutes, parcelEnabled}] }` | Gợi ý lộ trình đang có chuyến |
| `GET /v1/routes/{id}/info` | Tuyến + văn phòng lên/xuống + điểm dừng + `usefulInfo` + quy định + `actualDuration` + tin liên quan | Thông tin hữu ích trên tuyến (33) |
| `GET /v1/provinces/{id}/offices?routeId=&side=pickup\|drop` | `{ items: [office (+side, offsetMinutes khi có routeId)] }` | Chọn văn phòng (36) |
| `GET /v1/offices` | `{ groups: [{provinceId, provinceName, offices: [office]}] }` | Danh sách văn phòng theo tỉnh (16) |
| `GET /v1/offices/{id}/shuttle-zones?direction=pickup\|drop` | `{ office, rule: {registerHoursBefore, feeRefundable, note}, items: [{id, name, pickupEnabled, dropEnabled, fee, leadMinutes, dropMinutes, note}] }` | Xe trung chuyển (37) |
| `GET /v1/cancel-policy` | `{ tiers: [{hoursBefore, refundPercent}], cancelFee, changeAllowedHoursBefore, note, rules: [{kind, text}] }` — mặc định ≥24h: 100%, ≥6h: 70%, ≥2h: 50%, <2h: 0%, phí hủy 10.000 | Chính sách hủy, quy định (205, 206) |
| `GET /v1/faq?lang=` | `{ items: [{id, category, question, answer}] }` | Trợ giúp (107) |
| `GET /v1/content/{terms\|privacy\|help\|about}?lang=` | `{ key, language, text, updatedAt }` | Điều khoản, chính sách (2, 109) |
| `GET /v1/announcements` | `{ items: [{id, title, body, kind, routeId, startAt, endAt, createdAt}] }` | Tin nhà xe (15) |
| `GET /v1/reviews?routeId=` | Phân trang `[{id, stars, text, reply, repliedAt, authorName ("An N."), createdAt...}]` | Đánh giá trên trang chuyến |

`office` = `{ id, provinceId, name, address, phone, openText, directionNote, isActive }`.

---

## 4. 🔒 Tìm chuyến và sơ đồ ghế

### 4.1 `GET /v1/trips` — danh sách chuyến (28, 29)
| Tham số | Ý nghĩa |
|---|---|
| `fromProvinceId*`, `toProvinceId*` | Lộ trình |
| `date` | Ngày địa phương, mặc định hôm nay |
| `seats` | Số người (mặc định 1) |
| `pickupOfficeId`, `dropOfficeId` | Lọc theo văn phòng lên / xuống xe |
| `minPrice`, `maxPrice`, `timeFrom`, `timeTo` (`HH:mm`), `vehicleKind`, `amenity` | Bộ lọc |
| `onlyAvailable` | `true`: chỉ chuyến đang bán đủ ghế. Mặc định: chuyến đủ ghế + chuyến hết chỗ (để hiện "Đăng ký chờ"). Chuyến đã đóng đặt (còn dưới 4 giờ) hoặc chưa mở (xa hơn 7 ngày) không xuất hiện |
| `sort` | `time` (mặc định) \| `-time` \| `price` \| `-price` \| `seats` |

Phản hồi:
```json
{
  "date": "2026-11-20", "seats": 1,
  "items": [{
    "id": "980cdd7e-…", "routeId": "e45f…",
    "route": { "id": "e45f…", "name": "Hà Nội → Thái Bình", "durationMinutes": 150, "from": { "id": "…", "name": "Hà Nội" }, "to": { "id": "…", "name": "Thái Bình" } },
    "departAt": "2026-11-20T00:30:00Z", "date": "2026-11-20", "departTime": "07:30", "tzOffset": "+07:00",
    "arriveAt": "2026-11-20T03:00:00Z", "arriveTime": "10:00",
    "status": "open", "salesOpenAt": "…", "salesCloseAt": "2026-11-19T22:30:00Z",
    "vehicle": { "kindLabel": "Limousine 9 chỗ", "seatCount": 9, "colorText": "", "amenities": ["wifi", "nước"] },
    "seats": { "total": 9, "free": 9 },
    "basePrice": 250000, "minPrice": 250000,
    "prices": [{ "seatClass": "vip", "name": "Ghế VIP", "seatPrice": 250000, "surcharge": 0, "total": 250000 }],
    "shuttleEnabled": true, "parcelEnabled": true,
    "pickupOffices": [
      { "officeId": "0387…", "name": "VP Mỹ Đình", "address": "1 Mỹ Đình", "phone": "0241111111", "openText": "", "directionNote": "", "isActive": true, "offsetMinutes": 0, "sortOrder": 0, "arriveAt": "2026-11-20T00:30:00Z", "arriveTime": "07:30" },
      { "officeId": "7adf…", "name": "VP Giáp Bát", "…": "…", "offsetMinutes": 30, "arriveTime": "08:00" }
    ],
    "dropOffices": [{ "officeId": "274a…", "name": "VP TP Thái Bình", "…": "…", "arriveTime": "10:00" }],
    "stops": [{ "name": "Trạm dừng Phủ Lý", "offsetMinutes": 70, "arriveTime": "08:40" }],
    "usefulInfo": "…"
  }],
  "facets": { "vehicleKinds": ["Limousine 9 chỗ"], "amenities": ["wifi", "nước"], "pickupOffices": [{ "id", "name" }], "dropOffices": [{ "id", "name" }], "priceRange": { "min": 250000, "max": 250000 } }
}
```
* `status` của chuyến: xem [11.3](#113-trạng-thái-chuyến-status). `facets` dùng để dựng bộ lọc.
* Hiển thị "giá từ" = `minPrice` (đã gồm phụ thu loại ghế và giá mùa nếu có).

### 4.2 `GET /v1/trips/{id}` — trang chi tiết chuyến (30, 31)
Như một phần tử ở 4.1 + `operator: {name, phone, rating, reviewCount, completedTrips}`, `cancelPolicy: {tiers:[{hoursBefore, refundPercent}], cancelFee, changeAllowedHoursBefore, changeFee, note}`, `rules: [{kind, text}]`, `shuttleRule: {registerHoursBefore, feeRefundable, note, deadline}`, `bookingRule: {leadHours, maxSeats, daysAhead}`; kèm `frontSurcharge`, `vipSurcharge` của chuyến.

### 4.3 `GET /v1/trips/{id}/seats` — sơ đồ ghế (34)
```json
{
  "tripId": "980c…", "status": "open",
  "layout": { "rows": 4, "cols": 3, "name": "Limousine 9 chỗ" },
  "seats": [
    { "seatId": "TX", "label": "TX", "row": 0, "col": 0, "seatClass": "standard", "seatClassName": "Ghế thường", "seatPrice": 250000, "surcharge": 0, "total": 250000, "state": "unsellable", "isMine": false },
    { "seatId": "A1", "label": "A1", "row": 0, "col": 1, "seatClass": "front", "seatClassName": "Hàng đầu", "seatPrice": 250000, "surcharge": 30000, "total": 280000, "state": "free", "isMine": false }
  ],
  "counts": { "free": 9, "pending": 0, "sold": 0, "locked": 0 }
}
```
* Vẽ lưới `rows × cols`, mỗi ghế ở ô `(row, col)`; ô không có ghế là lối đi. `TX` (chỗ tài xế) có `state: "unsellable"`.
* `state`: `free` (chọn được) · `pending` (**đã có người đặt, chờ nhà xe duyệt** — không chọn được, hiện "Đã đặt · chờ duyệt") · `sold` · `locked` · `unsellable`. Nhãn ở [11.2](#112-trạng-thái-ghế-trên-sơ-đồ).
* Phụ thu: ghế `front` +`trip.frontSurcharge` (mặc định 30.000), `vip` +`trip.vipSurcharge` (mặc định 60.000); `total = seatPrice + surcharge`.
* `isMine: true` = ghế đơn của chính bạn. Không bao giờ có thông tin người đặt (chỉ admin thấy `booking`).
* **Quy tắc ghế:** tạo đơn là **giữ ghế ngay** (không có đếm ngược, không cần chuyển khoản trước). Ghế `pending` được nhả nếu đơn bị từ chối hoặc hủy.

### 4.4 `GET /v1/trips/{id}/alternatives?seats=2` (44)
`{ items: [trip] }` — tối đa 6 chuyến cùng tuyến gần giờ nhất (±3 ngày) còn đủ ghế. Gọi khi chuyến hết chỗ hoặc khi bị lấy ghế.

### 4.5 👤 Danh sách chờ (45, 96)
* `POST /v1/trips/{id}/waitlist` `{ "seatCount": 2, "note": "" }` → `201 { id, tripId, seatCount, status: "waiting", position }`. Đã đăng ký → `409 waitlist_exists`.
* `GET /v1/me/waitlist` → `{ items: [{ id, tripId, seatCount, status, createdAt, trip }] }` · `DELETE /v1/me/waitlist/{id}` → `204`.
* Khi có ghế trống, người chờ đầu tiên nhận thông báo `waitlist_available`.

---

## 5. 🔒 Đặt ghế và trả tiền tại quầy

> **Quy tắc cốt lõi:** khách **giữ ghế ngay khi tạo đơn** (một bước, tất cả ghế hoặc không ghế nào). Nhà xe **duyệt** hoặc **từ chối**. Tiền trả **tại quầy** (tiền mặt / chuyển khoản trực tiếp), nhà xe bấm **xác nhận đã thu**. App không có màn hình thanh toán, không có ảnh chuyển khoản.
>
> **Đặt lúc nào cũng được** (không chốt giờ, không giới hạn ngày). Tối đa **6 ghế**/đơn. Các số này nằm ở `trip.bookingRule` (`GET /trips/{id}`: `leadHours`, `maxSeats`, `daysAhead`) và cấu hình được (9.12 `system`).

### 5.1 🔒 Báo giá
`POST /v1/bookings/quote` — chưa lưu gì; gọi mỗi lần khách đổi ghế / trung chuyển / mã giảm giá.
```json
{ "tripId": "980c…", "seats": ["B1", "D1"], "pickupOfficeId": "0387…",
  "pickupShuttle": { "zoneId": "c308…", "addressText": "10 Xuân Thủy" }, "promoCode": "CHAOBAN" }
```
hoặc (chưa chọn ghế): `{ "tripId", "seatCount": 3, "seatClass": "standard", ... }`.
```json
{
  "tripId": "980c…",
  "lines": [{ "seatId": "B1", "label": "B1", "seatClass": "vip", "seatPrice": 250000, "surcharge": 60000, "lineAmount": 310000, "netAmount": 279000, "state": "free" }],
  "amounts": { "seatsAmount": 500000, "surchargeAmount": 60000, "shuttleAmount": 30000, "subtotal": 590000, "promoDiscount": 59000, "discountAmount": 59000, "totalAmount": 531000, "seasonalApplied": [] },
  "promo": { "id": "…", "code": "CHAOBAN", "title": "Chào bạn mới", "kind": "percent", "value": 10 },
  "pickupShuttle": { "zoneName": "Cầu Giấy", "fee": 30000, "plannedAt": "…", "plannedTime": "06:50" },
  "dropShuttle": null
}
```
* **Tổng tiền = giá ghế + phụ thu hạng ghế (hàng đầu / VIP) + phí trung chuyển − mã giảm.** Không còn giảm trẻ em, không đổi điểm ra tiền. Hiển thị từng dòng rồi tổng.
* Mã giảm: lỗi `409 promo_invalid | promo_expired | promo_used_up | promo_min_amount`.

### 5.2 👤 Tạo đơn (giữ ghế ngay)
`POST /v1/bookings` (gửi `Idempotency-Key`):
```json
{
  "tripId": "980c…",
  "seats": ["B1", "B2"],
  "pickupOfficeId": "0387…", "dropOfficeId": "5a1e…",
  "pickupShuttle": { "zoneId": "c308…", "addressText": "10 Xuân Thủy", "noteText": "Cổng sau" },
  "dropShuttle": null,
  "promoCode": "CHAOBAN"
}
```
* `seats*` 1-6 ghế (mảng id, ví dụ `["B1","B2"]`). **Tên và SĐT của mọi ghế lấy từ tài khoản** (không nhập từng hành khách).
* `pickupOfficeId*`, `dropOfficeId*`: văn phòng thuộc tuyến (`pickupOffices` / `dropOffices` của chuyến). Chỉ có 1 văn phòng ở phía đó thì app tự điền; có nhiều thì khách chọn.
* **Xe trung chuyển tùy chọn**, hai chiều độc lập (đón tại nhà → văn phòng lên xe; văn phòng xuống xe → nơi khách muốn dừng): mỗi chiều `{ zoneId*, addressText*, noteText }`. Điều kiện: tuyến bật trung chuyển, khu vực thuộc đúng văn phòng đã chọn, còn trước giờ chạy ≥ `shuttle.registerHoursBefore` (mặc định 3 giờ), không thì `409 shuttle_unavailable | shuttle_deadline_passed`. Phí lưu vào đơn và cộng vào tổng, **trả tại quầy cùng tiền vé**. Không dùng GPS / bản đồ.
* Thành công `201` → đơn `status = "pending"` (chi tiết ở 5.3), mọi ghế `state = pending` trên sơ đồ. Màn hình kết quả: "Đã đặt ghế B1, B2" + mã đơn + chuyến + văn phòng + **số tiền trả tại quầy** + "Nhà xe sẽ duyệt đơn".
* Ghế không còn trống → `409 seat_conflict` (`takenSeats`, `freeSeats`), **không giữ / tạo gì cả**. Quá 6 ghế → `400 too_many_seats`. Chuyến không bán → `409 trip_not_on_sale`. Văn phòng sai/đóng → `409 office_not_on_route`.
* Giá được **chốt tại lúc đặt** (đổi giá chuyến sau đó không ảnh hưởng đơn cũ).

### 5.3 🔒 Danh sách và chi tiết đơn
* `GET /v1/bookings?tab=&status=&q=&cursor=` (khách chỉ thấy đơn của mình; admin thấy tất cả, xem 9.5):

  | `tab` | Gồm |
  |---|---|
  | `pending` | `pending` — Chờ duyệt |
  | `upcoming` | `confirmed`, `cancel_requested` sắp đi (chưa quá 12 giờ sau giờ chạy) |
  | `past` | `completed`, hoặc `confirmed` đã chạy xong |
  | `cancelled` | `cancelled`, `rejected` |

  `q` tìm theo mã đơn, tên, tuyến (không dấu).
* `GET /v1/bookings/{id}` → chi tiết:
```json
{
  "id": "7166…", "code": "SR36X3HP", "status": "confirmed", "source": "app",
  "trip": { "id": "980c…", "departAt": "2026-11-22T00:30:00Z", "date": "2026-11-22", "departTime": "07:30", "tzOffset": "+07:00", "arriveAt": "…", "status": "scheduled",
            "route": { "id": "…", "name": "Hà Nội → Thái Bình" }, "vehicle": { "kindLabel": "Limousine 9 chỗ", "name": "Dcar Limousine", "plateNo": "29B-123.45" }, "updates": [] },
  "pickupOffice": { "id", "name", "address", "phone", "directionNote", "isActive", "arriveAt", "arriveTime": "07:30" },
  "dropOffice": { "…": "…" },
  "pickupShuttle": { "id", "direction": "pickup", "officeId", "zoneId", "zoneName", "addressText", "noteText", "fee": 30000, "plannedAt", "plannedTime": "06:50", "status": "pending" },
  "dropShuttle": null,
  "seats": [{ "id": "6af3…", "seatId": "B1", "label": "B1", "seatClass": "vip", "passengerName": "Nguyễn Văn An", "passengerPhone": "0901234567", "seatPrice": 250000, "surcharge": 60000, "netAmount": 310000, "boarding": "none" }],
  "amounts": { "…": "như 5.1" },
  "totalAmount": 530000, "paidAmount": 530000, "paid": true, "paidAt": "2026-11-22T00:10:00Z", "payMethod": "cash", "refundedAmount": 0,
  "promoCode": null, "note": "", "payAtCounter": false,
  "confirmedAt": "…", "completedAt": null, "cancelledAt": null, "cancelReason": null,
  "pendingRequest": null, "notices": [], "reviewed": false,
  "actions": { "cancel": true, "cancelNeedsApproval": true, "editShuttle": true, "review": false, "chat": true },
  "createdAt": "…", "updatedAt": "…"
}
```
  * **Thanh toán:** `paid = false` và `payAtCounter = true` → thẻ "Chưa thanh toán · trả **{totalAmount}** tại quầy". `paid = true` → "Đã thanh toán tại quầy" + `paidAt`, `payMethod` (`cash` tiền mặt · `transfer` chuyển khoản trực tiếp · `free` miễn phí).
  * `plateNo` chỉ hiện khi đơn đã duyệt. `trip.updates` = tin báo trễ / sự cố / thông báo cả chuyến.
  * Nút theo `actions`: `cancel` ("Hủy đơn"; `cancelNeedsApproval = true` nghĩa là đơn đã thanh toán → gửi yêu cầu, chờ nhà xe), `editShuttle`, `review` (chuyến đã đi), `chat`. Đơn **không còn** sửa ghế / đổi chuyến phía khách: liên hệ nhà xe (admin đổi ghế / chuyển chuyến, 9.5).
  * `notices` = cảnh báo như văn phòng đóng cửa: `[{ kind: "office_closed", officeId, at }]`.
* `GET /v1/bookings/{id}/history` (77) → `{ items: [{ id, at, kind, byRole, oldValue, newValue, note }] }`. `kind`: `created`, `confirmed`, `rejected`, `payment_collected`, `seat_changed`, `trip_changed`, `shuttle_changed`, `cancel_requested`, `request_approved`, `request_rejected`, `cancelled`, `refund_recorded`, `completed`...
* `GET /v1/bookings/{id}/share-text?lang=` (79) → `{ text }` dạng chữ để chia sẻ sang Zalo.

### 5.4 👤 Hủy đơn và hoàn tiền
* `GET /v1/bookings/{id}/cancel-preview` → `{ bookingId, status, immediate, paidAmount, hoursBefore, tier, refundPercent, cancelFee, refundAmount, policy }`. Hiện cho khách **trước khi** bấm hủy.
* `POST /v1/bookings/{id}/cancel` `{ note? }`:
  * Đơn `pending`, hoặc đơn đã duyệt **nhưng chưa thanh toán** → `{ status: "cancelled", booking }` ngay, ghế được nhả, **không có hoàn tiền** (chưa trả gì).
  * Đơn **đã thanh toán** (còn trước giờ chạy) → `{ status: "requested", request, booking }`, đơn sang `cancel_requested`, ghế vẫn giữ tới khi nhà xe quyết định. Nhà xe duyệt → `cancelled` + ghi nhận hoàn; từ chối → về `confirmed`. Khách rút yêu cầu: `DELETE /v1/me/requests/{id}`.
  * Quá giờ chạy → `409 cancel_not_allowed`.
* **Công thức hoàn:** `refund = max(0, đã thanh toán × % theo mốc − phí hủy)`. Mốc mặc định (`GET /cancel-policy`): ≥24 giờ trước: 100%, ≥6 giờ: 70%, ≥2 giờ: 50%, dưới 2 giờ: 0%; phí hủy cố định 10.000. Mốc và phí là **bản sao lúc đặt đơn**.
* Hoàn tiền **chỉ ghi nhận**: nhà xe tự chuyển ngoài app (không có tài khoản nhận hoàn), khách theo dõi ở `GET /v1/me/refunds`.
* Khách hủy đơn đã duyệt thì **điểm đã cộng bị trừ lại**; mã giảm giá được trả lại.

### 5.5 🔒 Sửa xe trung chuyển
`PATCH /v1/bookings/{id}/shuttle` `{ "pickupShuttle": {zoneId, addressText, noteText} | null, "dropShuttle": … | null }` — `null` = bỏ chiều đó. Chỉ trước hạn đăng ký (`shuttle.registerHoursBefore`). Đổi **khu vực** (đổi phí) chỉ được khi đơn còn `pending`; sau khi duyệt chỉ sửa được địa chỉ / ghi chú, đổi phí thì liên hệ nhà xe (`409 invalid_status`, `hint: contact_operator`).

### 5.6 🔒 Trao đổi trong đơn
* `GET /v1/bookings/{id}/messages` → `{ items: [{ id, senderRole: customer|admin, senderName, text, status, at, mine }] }`.
* `POST /v1/bookings/{id}/messages` `{ "text" }` → `201`. Chỉ chữ, không ảnh. Tin bị ẩn do vi phạm có `status: "hidden"`, `text: ""`. Khách báo cáo tin: `POST /v1/reports` (8.6).

### 5.7 Đặt lại nhanh
`GET /v1/bookings/{id}/rebook` → `{ fromProvinceId, toProvinceId, routeId, pickupOfficeId, dropOfficeId, seatCount, pickupShuttle, dropShuttle }` để điền sẵn form đặt vé mới.

## 6. 🔒 Gửi đồ

Không đặt ghế, không theo quy tắc chuyển khoản trước. Luồng: tạo yêu cầu (`pending`) → nhà xe chấp nhận, chọn chuyến, chốt cước (`accepted`) → khách thanh toán (QR hoặc tiền mặt tại văn phòng) → nhà xe nhận hàng (`received`) → lên xe (`loaded`) → tới văn phòng nhận (`arrived`) → giao bằng mã nhận hàng (`delivered`).

### 6.1 `GET /v1/parcels/config` (59)
`{ enabled, limits: {maxWeightKgPerOrder, acceptHoursBefore}, sizeClasses: [{code: small|medium|large, label, maxDimText}], policy: {cancelAfterReceivePercent, maxCompensationMultiple, claimDays, compensationText, note}, categories: [{id, name, note, packingNote}], prohibited: [{id, name, note}], routes: [{id, name, fromProvinceId, toProvinceId, fromOffices: [{id, name, address}], toOffices: [...]}] }`

### 6.2 `POST /v1/parcels/quote` (58)
Body như 6.3 (không cần receiver/commit) → `{ "estimate": { rateId, weightKg, sizeClass, base, extraKg, extraAmount, declaredValue, declaredValuePercent, declaredSurcharge, pickupFee, dropFee, total }, "note": "fee_may_change_after_weighing" }`. Hiện từng khoản; ghi chú "cước thực tế có thể chỉnh khi nhà xe cân hàng".

### 6.3 👤 `POST /v1/parcels` → `201` (57)
```json
{
  "routeId": "e45f…", "date": "2026-11-20", "fromOfficeId": "0387…", "toOfficeId": "274a…",
  "sender": { "name": "Nguyễn Văn An", "phone": "0901234567" },
  "receiver": { "name": "Chị Hoa", "phone": "0977000111", "addressText": "" },
  "categoryId": null, "descriptionText": "Hộp bánh", "pieceCount": 1, "weightKg": 3, "sizeClass": "small", "declaredValue": 500000, "note": "",
  "pickupShuttle": null, "dropShuttle": null,
  "commitAccepted": true
}
```
* `sender` mặc định là chính mình; `receiver*` chọn từ `/me/receivers`. `commitAccepted*` = `true` (cam kết không gửi hàng cấm, `400 commitment_required`).
* `pickupShuttle`/`dropShuttle` = lấy hàng / giao tận nơi bằng xe trung chuyển (khu vực của văn phòng gửi / nhận).
* Phản hồi = chi tiết đơn (6.4) + **`handoverCode`** (6 số) — **chỉ trả một lần**, app hiện cho người gửi chia sẻ cho người nhận. Mất mã → `POST /v1/parcels/{id}/handover-code` → `{ handoverCode }` (mã cũ hết hiệu lực).

### 6.4 Danh sách và chi tiết
* `GET /v1/parcels?tab=active|delivered|cancelled&q=` (65).
* `GET /v1/parcels/{id}`:
```json
{
  "id": "62d8…", "code": "GD9VHD3W", "status": "accepted", "paid": false, "payMethod": null, "source": "app",
  "sender": { "name": "Nguyễn Văn An", "phone": "0901234567" }, "receiver": { "name": "Chị Hoa", "phone": "0977000111", "addressText": "" },
  "route": { "id": "e45f…", "name": "Hà Nội → Thái Bình" }, "date": "2026-11-20",
  "trip": { "id": "980c…", "departAt": "…", "date": "2026-11-20", "departTime": "07:30", "status": "scheduled" },
  "fromOffice": { "id", "name", "address", "phone" }, "toOffice": { "…": "…" }, "category": null,
  "descriptionText": "Hộp bánh", "pieceCount": 1, "weightKg": 3, "actualWeightKg": null, "sizeClass": "small", "declaredValue": 500000, "note": "",
  "pickupShuttle": null, "dropShuttle": null,
  "estimate": { "base": 40000, "extraKg": 0, "extraAmount": 0, "declaredSurcharge": 5000, "pickupFee": 0, "dropFee": 0, "total": 45000, "…": "…" },
  "fee": 45000, "feeBreakdown": { "…": "…", "finalFee": 45000 }, "feeAdjustReason": null,
  "paidAmount": 0, "refundedAmount": 0, "rejectReason": null, "cancelReason": null, "unclaimed": false, "arrivedAt": null, "deliveredAt": null,
  "timeline": [{ "step": "created", "at": "…", "done": true }, { "step": "accepted", "at": "…", "done": true }, { "step": "paid", "at": null, "done": false },
               { "step": "received", "…": "…" }, { "step": "loaded" }, { "step": "arrived" }, { "step": "delivered" }],
  "history": [{ "kind": "created", "at": "…", "note": "", "byRole": "customer" }],
  "handoverLocked": false,
  "actions": { "cancel": true, "regenerateCode": true, "reportIssue": true },
  "createdAt": "…", "updatedAt": "…"
}
```
* `timeline` vẽ thanh mốc (64). `fee` là cước chốt; khác `estimate.total` thì hiện `feeAdjustReason`.

### 6.5 👤 Thanh toán cước (62)
Không có thanh toán trong app và không có ảnh chuyển khoản. Khách **mang hàng tới quầy và trả cước tại quầy**; nhà xe bấm "Đã nhận hàng" (`status = received`) thì cước được **ghi nhận là đã thu** (`paid = true`, `payMethod`, `paidAmount`) — doanh thu gửi đồ tính từ lúc này. Không có ghi nợ, không thu hộ (COD).
* Cước = giá cơ bản theo cỡ (mặc định nhỏ 30.000 / vừa 50.000 / lớn 80.000) + phụ 5.000đ mỗi kg vượt ngưỡng (5 / 15 / 30 kg) + 1% giá trị khai báo + phí trung chuyển. Bảng cước theo tuyến chỉnh ở `/admin/parcel-rates` (10).

### 6.6 👤 Hủy, chia sẻ, báo sự cố
* `GET /v1/parcels/{id}/cancel-preview` → `{ allowed, paidAmount, refundPercent, refundAmount }` (trước khi nhà xe nhận hàng hoàn 100%, sau đó theo `policy.cancelAfterReceivePercent`; đã lên xe thì không hủy được).
* `POST /v1/parcels/{id}/cancel` `{ note }` → `{ refundAmount, parcel }`.
* `GET /v1/parcels/{id}/share-text?handoverCode=123456&lang=` → `{ text }` cho người nhận (67).
* `POST /v1/parcels/{id}/issue` `{ "kind": "late|damaged|lost|other", "text" }` → `201` khiếu nại gắn với đơn (68).

---

## 7. 🔒 Thông báo

Không có thông báo đẩy: **tải lại khi mở app và khi quay lại từ nền** (24). Nhắc chuyến sắp chạy được server tạo khi app gọi `GET /notifications` hoặc `GET /home` (trong vòng 24 giờ trước chuyến).

* `GET /v1/notifications?category=order|trip|parcel|promo|system&unread=true&cursor=`:
```json
{
  "items": [{
    "id": "384f…", "category": "order", "kind": "booking_confirmed", "title": "Đơn đã được xác nhận",
    "text": "Đơn SR36X3HP đã được nhà xe xác nhận. Chúc bạn có chuyến đi vui vẻ!",
    "refType": "booking", "refId": "7166…", "params": { "code": "SR36X3HP" }, "isRead": false, "readAt": null, "createdAt": "…"
  }],
  "nextCursor": null, "total": 2,
  "unread": { "total": 2, "byCategory": { "order": 1, "trip": 1, "parcel": 0, "promo": 0, "system": 0 } }
}
```
* `title`/`text` đã dịch theo `Accept-Language`. **Bấm vào mở thẳng** theo `refType` + `refId` (25): `booking` → chi tiết đơn, `parcel` → đơn gửi đồ, `trip` → chi tiết chuyến, `review` → đánh giá của tôi, `complaint` → khiếu nại, `promotion` → ví mã, `announcement`/`contact` → mở nội dung.
* `GET /v1/notifications/unread-count` → `{ total, byCategory }` (chấm đỏ trên tab).
* `POST /v1/notifications/read` `{ "all": true }` | `{ "ids": [...] }` | `{ "category": "order" }` → `{ updated, unread }`.
* `DELETE /v1/notifications/{id}` → `204`.

Danh sách `kind` theo nhóm:
| Nhóm | `kind` |
|---|---|
| `order` (đơn) | `booking_confirmed` (đã duyệt, thanh toán tại quầy), `booking_rejected` (`reason`), `cancel_requested`, `payment_recorded` (nhà xe đã ghi nhận thu tiền), `seat_changed`, `booking_moved`, `booking_cancelled`, `request_approved`, `request_rejected`, `refund_pending`, `refund_recorded`, `booking_linked`, `message_new`, `review_reply`, `complaint_update`, `points_earned`, `points_reverted` |
| `trip` | `trip_time_changed`, `trip_delay`, `trip_incident`, `trip_cancelled`, `trip_notice`, `trip_reminder`, `vehicle_changed`, `office_closed`, `shuttle_changed`, `waitlist_available` |
| `parcel` | `parcel_accepted`, `parcel_rejected`, `parcel_received`, `parcel_loaded`, `parcel_arrived`, `parcel_delivered`, `parcel_issue`, `parcel_unclaimed`, `parcel_cancelled`, `parcel_fee_adjusted`, `refund_recorded`, `complaint_update` |
| `promo` | `announcement` (tin khuyến mãi), `voucher_received`, `referral_rewarded` |
| `system` | `announcement`, `account_warning`, `content_hidden`, `contact_reply` |

Bật/tắt nhóm thông báo khuyến mãi / tin nhà xe (104) là **cài đặt cục bộ của app** (không có API): app tự ẩn các nhóm đó. Thông báo đơn và chuyến luôn hiện.

---

## 8. 🔒 Home và Profile (khách hàng)

### 8.1 👤 `GET /v1/home`
Một lần gọi cho cả tab Home (9-19):
```json
{
  "greeting": { "displayName": "Nguyễn Văn An" },
  "operator": { "name": "Nhà xe Test", "phone": "0347218023" },
  "upcomingTrip": { "…": "chi tiết đơn như 5.3", "countdownSeconds": 78480 },
  "todo": [
    { "kind": "waiting_approval", "bookingId": "…", "code": "SR…", "status": "pending", "trip": {…}, "totalAmount": 530000, "reason": null },
    { "kind": "parcel_payment", "parcelId": "…", "code": "GD…", "fee": 45000 }
  ],
  "shortcuts": {
    "recentRoutes": [{ "fromProvinceId", "fromProvinceName", "toProvinceId", "toProvinceName", "pickupOfficeId", "dropOfficeId" }],
    "favoriteRoutes": [{ "id", "label", "fromProvinceId", "fromProvinceName", "toProvinceId", "toProvinceName" }],
    "rebookBookingId": "…"
  },
  "services": [{ "key": "parcel", "enabled": true }],
  "activeParcels": [{ "id", "code", "status", "receiverName", "toOffice", "trip" }],
  "promotions": [{ "id", "code", "title", "description", "kind": "percent", "value": 10, "maxDiscount", "minAmount", "startAt", "endAt", "routeId", "audience", "remaining" }],
  "announcements": [{ "id", "title", "body", "kind", "createdAt" }],
  "toReview": [{ "bookingId", "code", "trip" }],
  "suggestions": [ "trip như 4.1 (chuyến sắp chạy trên tuyến hay đi, nhiều ghế)" ],
  "unread": { "total": 2, "byCategory": {…} },
  "serverTime": "2026-11-19T02:46:22Z"
}
```
`todo.kind`: `waiting_approval` (đơn `pending`, "Chờ nhà xe duyệt"), `rejected` (đơn bị từ chối, hiện `reason`, nút "Đặt lại"), `parcel_unclaimed` (hàng tới nơi chưa ai nhận, 69). Hiện "cập nhật lúc `serverTime`" (19).

### 8.2 👤 Tuyến yêu thích và đặt nhanh
App **không còn lưu** hành khách, địa chỉ, người nhận, tài khoản nhận hoàn, liên hệ khẩn cấp hay sở thích trên máy chủ. Chỉ còn:
* `GET /v1/me/favorite-routes` → `{ items: [{ routeId, name, status, fromProvinceId, fromProvinceName, toProvinceId, toProvinceName }] }` · `POST /v1/me/favorite-routes/{routeId}` → `201` (danh sách mới; tối đa 50) · `DELETE /v1/me/favorite-routes/{routeId}` → `204`.
* `GET /v1/me/recent-routes` → `{ items: [{ routeId, name, …tỉnh đi/đến, pickupOfficeId, dropOfficeId, lastBookedAt }] }` — tối đa 5 tuyến khách vừa đặt, dùng cho "Đặt nhanh" ở Trang chủ (`GET /home` đã trả sẵn `shortcuts.recentRoutes` / `favoriteRoutes`).

### 8.3 👤 Điểm, hạng, ví mã, giới thiệu, thống kê
* `GET /v1/me/loyalty` (92) → `{ enabled, points, lifetimeEarned, tier, nextTier, rules: {earnPointsPer10k}, tiers: [...], entries: { items: [{ id, points, reason: booking|cancel_reversal, refType, refId, at }], nextCursor, total } }`. Điểm = `totalAmount / 10000` cộng **khi nhà xe duyệt đơn**, trừ lại nếu đơn bị hủy; **không đổi ra tiền**. Hạng: Thành viên → Bạc (≥80) → Vàng (≥200) → Kim cương (≥500).
* `GET /v1/me/vouchers` (93) → `{ wallet: [{ id, status: active|used|expired, source, receivedAt, usedAt, orderId, promotion }], available: [promotion] }`. `POST /v1/me/vouchers` `{ code }` lưu mã công khai vào ví. Áp vào đơn: `promoCode`.
* `GET /v1/me/referral` (94) → `{ enabled, code, invited, rewarded, maxPerReferrer, shareText }`.
* `GET /v1/me/stats` (91) → `{ completedTrips, seatsTravelled, totalSpent, topRoute: {id, name, trips}, pointsThisYear, year }`.
* Lịch sử chuyến theo tháng (90): `GET /v1/bookings?tab=past&month=2026-11`.

### 8.4 👤 Hoạt động của tôi
| Endpoint | Nội dung |
|---|---|
| `GET /v1/me/requests?status=` (95) | Yêu cầu hủy / đổi / hoàn (`request` như 5.10) |
| `GET /v1/me/refunds` (95) | `[{ id, orderType, orderId, orderCode, amount, reason, status: pending\|recorded, recordedAt, note }]` |
| `GET /v1/me/waitlist` (96) | 4.5 |
| `GET /v1/me/reviews` (97) | `{ written: [review], pending: [booking chưa đánh giá] }` |
| `GET /v1/me/complaints` (101) | Khiếu nại của tôi |
| `GET /v1/me/contact` | Liên hệ đã gửi + trả lời |
| `GET /v1/parcels` (99) | Đơn gửi đồ của tôi |

### 8.5 👤 Quyền riêng tư
* `GET /v1/me/data` (111) → `{ account, counts: {bookings, parcels, reviews, messages, notifications}, deletion: { inApp, web } }`.
* `GET /v1/me/export` (110) → tệp **CSV** (UTF-8 BOM, mở được bằng Excel), `Content-Disposition: attachment`. App lưu qua trình chọn tệp hệ thống (`ACTION_CREATE_DOCUMENT`).
* Xóa tài khoản: 2.8.

### 8.6 🔒 Đánh giá, báo cáo, khiếu nại, liên hệ
* 👤 `POST /v1/reviews` `{ bookingId*, stars* 1-5, text }` → `201` (chỉ đơn `completed`, mỗi đơn 1 đánh giá). `PATCH /v1/reviews/{id}` `{ stars, text }`, `DELETE /v1/reviews/{id}`.
* 🔒 `POST /v1/reports` `{ targetType*: review|message, targetId*, reason*: spam|offensive|false_info|personal_data|other, text }` → `201` (100).
* 👤 `POST /v1/complaints` `{ orderType*: booking|parcel, orderId*, category, text* }` → `201` (101). `GET /v1/complaints/{id}`, `POST /v1/complaints/{id}/replies` `{ text }` (bổ sung). Complaint = `{ id, orderType, orderId, orderCode, category, text, status: open|in_progress|resolved, replies: [{byRole, text, at}], resolution, resolvedAt, createdAt }`.
* 👤 `POST /v1/contact` `{ subject, text* }` → `201` (108). Gọi điện: mở trình quay số với `operator.profile.phone` (`ACTION_DIAL`).

---

## 9. 🛠 Quản trị viên

Mọi đường dẫn `/v1/manage/*`, `/v1/admin/*` chỉ dành cho `role = admin`; khách hàng gọi → `403 forbidden`. Các endpoint đọc chung (`/bookings`, `/parcels`, `/trips/{id}/seats`...) khi gọi bằng token admin trả **dữ liệu đầy đủ** (thêm khách hàng, ghi chú nội bộ, thông tin người đặt ghế).

### 9.1 Khởi đầu (114-117)
1. Tài khoản quản trị mặc định tạo ở máy chủ (`npm run db:init`, mật khẩu ngẫu nhiên in một lần). **Không ép đổi mật khẩu**: đăng nhập là vào thẳng; nên đổi trong Tài khoản (2.7).
2. `GET /v1/admin/onboarding` → `{ steps: [{ key, done }], completed, total }` — `key`: `operator_profile`, `offices`, `vehicles`, `drivers`, `routes`, `first_trip`, `cancel_policy`. Đánh dấu tay: `POST /v1/admin/onboarding/{key}` `{ done: true }`.

### 9.2 🛠 Tổng quan (tab Tổng quan)
`GET /v1/manage/dashboard?range=today|7d|month|30d|custom&from=&to=&chart=7|30` (118-129):
```json
{
  "range": { "preset": "today", "from": "2026-11-19", "to": "2026-11-19" },
  "revenue": {
    "today": { "from", "to", "amount": 250000, "booking": 250000, "parcel": 0, "orders": 1, "previous": 0, "changePercent": null },
    "last7Days": {…}, "thisMonth": {…}, "range": {…}
  },
  "chart": [{ "date": "2026-11-13", "amount": 0, "orders": 0 }, "…"],
  "vehicles": { "total", "active", "maintenance", "retired", "docsExpiringSoon" },
  "staff": { "total", "byKind": { "limo_driver", "shuttle_driver", "office_staff" }, "offToday" },
  "inbox": { "…": "như 9.3" },
  "parcels": { "createdToday", "pending", "waitingPickupAtOffice", "revenueInRange" },
  "tripsToday": { "count", "passengers", "fillPercent", "unassigned", "items": [{ "id", "route", "departTime", "status", "tripStatus", "seats", "fillPercent", "needsVehicle", "needsDriver" }] },
  "recentBookings": [{ "id", "code", "status", "source", "totalAmount", "paid", "createdAt",
    "customer": { "displayName", "phone" }, "passengers": [{ "name", "seat" }], "routeName": "Hà Nội → Sa Pa", "departAt", "trip": { "id", "route": { "id", "name" }, "departAt" } }],
  "toCollect": { "count": 3, "amount": 1590000, "tripsWithin24h": 1, "amountWithin24h": 530000 },
  "longestWaiting": [{ "bookingId", "code", "amount", "createdAt", "waitingMinutes" }],
  "topRoutes": [{ "routeId", "name", "seats", "bookings", "revenue" }],
  "topHours": [{ "hour": 7, "seats": 12 }], // đủ mọi giờ có chuyến trong kỳ (giờ chưa bán được = seats 0)
  "alerts": [{ "kind": "vehicle_doc|maintenance_due|license_expiring|low_fill|trip_unassigned|unpaid_soon", "severity": "high|medium|low", "…": "…" }],
  "updatedAt": "…"
}
```
* **Doanh thu = tiền đã thu tại quầy** (tiền mặt + chuyển khoản trực tiếp, đơn đặt hộ, cước gửi đồ) − hoàn tiền đã ghi nhận, tính vào **ngày thu / ngày ghi hoàn**, theo giờ nhà xe; **ghế miễn phí không tính**. Đơn đã duyệt mà chưa thu **chưa vào doanh thu** (hiện ở thẻ `toCollect` "Chờ thu tiền"). `changePercent` so với kỳ trước cùng độ dài (`null` khi kỳ trước = 0).
* Cảnh báo `unpaid_soon`: còn đơn đã duyệt chưa thu mà chuyến chạy trong 24 giờ.
* Bấm thẻ "Cần xác nhận" → tab Cần xác nhận đúng mục (dùng `inbox` keys).

### 9.3 🛠 Cần xác nhận: hàng đợi và lịch
* `GET /v1/manage/inbox/counts` → `{ bookings, cancelRequests, toCollect, toCollectAmount, refunds, parcels, reports, complaints, messages, contacts, total, oldestBookingWaitingMinutes }` (cùng nguồn với thẻ Tổng quan).
* `GET /v1/manage/inbox?type=…` (một cửa vào cho tab):

  | `type` | Danh sách | Thao tác |
  |---|---|---|
  | `booking` | Đơn **chờ duyệt**, **cũ nhất trên**, đánh dấu `overdue` khi quá `system.reviewDeadlineMinutes` (mặc định 30 phút) | duyệt / từ chối (9.4), duyệt hàng loạt |
  | `cancel` | Yêu cầu hủy đơn đã thanh toán | `POST /manage/bookings/{id}/approve-cancel\|reject-cancel` |
  | `collect` | **Chờ thu tiền**: đơn đã duyệt chưa thu, **chuyến sớm nhất lên trước** (tô nổi chuyến trong 24 giờ) | `POST /manage/bookings/{id}/collect` |
  | `refund` | Khoản hoàn chờ chuyển | `POST /manage/refunds/{id}/record` |
  | `parcel` | Yêu cầu gửi đồ chờ | accept / reject (9.9) |
  | `report`, `complaint`, `message`, `contact` | 9.10 | |

  Hộp thư `contact` gồm cả tin "yêu cầu cấp lại mật khẩu" (`subject = "password_reset"`) của khách chỉ có SĐT.
* `GET /v1/manage/calendar?from=&to=` (mặc định tuần này) → `{ from, to, days: [{ date, trips, bookings, requests, toCollect, parcels, toConfirm }] }` (141).

### 9.4 🛠 Duyệt đơn và thu tiền
* **Hàng đợi:** `GET /v1/manage/bookings?status=pending` (cũ nhất trước). Mỗi đơn như 5.3 + thông tin admin (9.5) + `waitingMinutes`, `overdue`.
* `POST /v1/manage/bookings/{id}/approve` `{ note? }` → đơn `confirmed`, ghế `sold`, **cộng điểm** (`totalAmount / 10000`), khách nhận thông báo "đã duyệt, thanh toán tại quầy". Chỉ duyệt được đơn `pending` (`409 invalid_status`). Đơn đã duyệt có `paid = false`, `canCollect = true`.
* `POST /v1/manage/bookings/approve` `{ ids: [...] }` → `{ results: [{ id, ok, code? }], approved }` (duyệt hàng loạt, sau màn hình xác nhận lại, 144).
* `POST /v1/manage/bookings/{id}/reject` `{ reason* }` → đơn `rejected` (**trạng thái cuối**, khách đặt đơn mới), ghế về `free`, mã giảm giá được trả lại; khách nhận thông báo kèm lý do.
* **Xác nhận đã thu tiền:** `POST /v1/manage/bookings/{id}/collect` `{ method*: "cash" | "transfer", note? }` → đơn với `paid = true`, `paidAt`, `payMethod`. Chỉ đơn `confirmed` chưa thu (`409 invalid_status`); khách nhận thông báo `payment_recorded`. **Đây là lúc doanh thu được cộng** (vào ngày thu). Màn chi tiết đơn của admin: thẻ "Thanh toán" — chưa thu: số tiền cần thu + nút "Xác nhận đã thu tiền" (hỏi tiền mặt hay chuyển khoản trực tiếp); đã thu: số tiền, hình thức, giờ thu.
* **Hàng đợi "Chờ thu tiền":** `GET /v1/manage/bookings?payment=unpaid` (đơn `confirmed` chưa thu, **chuyến sớm nhất trước**) hoặc `GET /manage/inbox?type=collect`. Lọc đã thu: `?payment=paid`.
* **Hủy đơn đã thanh toán:** khách gửi yêu cầu (5.4) → đơn `cancel_requested`. `POST /v1/manage/bookings/{id}/approve-cancel` `{ note?, refundAmount? }` → `{ request, booking, refundAmount, preview }` (đơn `cancelled`, ghế nhả, **tạo khoản hoàn chờ chuyển** theo mốc hoàn; sửa số hoàn bằng `refundAmount`) hoặc `POST .../reject-cancel` `{ note? }` (đơn về `confirmed`).
* Đơn đã duyệt mà khách **không đến trả**: app chỉ cảnh báo (`unpaid_soon`), **chưa có quy tắc tự hủy / nhả ghế** — xem [Câu hỏi mở](#câu-hỏi-mở).

### 9.5 🛠 Đơn đặt ghế, đặt hộ, xếp chỗ
* `GET /v1/manage/bookings?status=&payment=unpaid|paid&tripId=&source=app|counter&customerAccountId=&guestContactId=&routeId=&from=&to=&q=` — như `GET /bookings` nhưng toàn bộ, mỗi đơn có thêm `customer: {id, displayName, phone, email}`, `guest: {id, name, phone}`, `compReason`, `internalNotes`, `cancelPolicySnapshot`, `canCollect`, `waitingMinutes`, `overdue`. `source`: `app` (khách đặt qua app) · `counter` (đặt hộ tại quầy). Tìm `q` theo mã, tên, SĐT, tuyến.
* **Đặt hộ tại quầy** `POST /v1/manage/bookings` (131-134) → `201` đơn **`confirmed` và đã thu ngay**, `source = counter`, + `shareText`:
```json
{
  "tripId": "…", "pickupOfficeId": "…", "dropOfficeId": "…",
  "seats": [{ "seatId": "C2", "passengerName": "Bà Lan", "passengerPhone": "0988777666" }],
  "guest": { "name": "Bà Lan", "phone": "0988777666", "note": "" },
  "payMethod": "cash", "specialPrice": null, "compReason": null, "paymentNote": "", "pickupShuttle": null, "note": ""
}
```
  * `guest` (khách không dùng app) **hoặc** `customerAccountId`. `seats` có thể là mảng id hoặc kèm tên từng người. `payMethod*`: `cash` | `transfer` | `free`. `free` hoặc `specialPrice` (giá riêng mỗi ghế) **bắt buộc `compReason`**; ghế miễn phí **không tính doanh thu**. Không có "chưa thu" / ghi nợ.
  * Ghế đã có người đặt → `409 seat_conflict` (`takenSeats`, `freeSeats`) — không bao giờ lấy ghế của đơn khác.
  * Gõ SĐT ở quầy: `GET /v1/admin/guests/lookup?phone=` → `{ guest: {id, name, phone, note, linkedAccountId, recentBookings}, accounts: [{id, displayName, email, phone}] }` (135).
  * Khách đăng ký sau: `POST /v1/admin/guests/{id}/link` `{ accountId }` → `{ linkedBookings, linkedParcels }` (136).
* **Xếp / đổi ghế** `POST /v1/manage/bookings/{id}/assign-seats` (alias `/reseat`) `{ "assignments": [{ "bookingSeatId", "seatId" }], "reason" }` (169, 170) — chỉ sang ghế trống, giữ nguyên trạng thái (đơn đã duyệt → ghế `sold`); khách nhận thông báo.
* **Chuyển chuyến** `POST /v1/manage/bookings/{id}/move` `{ tripId*, seats?: [{bookingSeatId, seatId}], reason }` (cùng tuyến; giữ số ghế nếu trống).
* **Hủy** `POST /v1/manage/bookings/{id}/cancel` `{ reason, note, refundAmount? }` → `{ refundAmount, preview, booking }`.
* **Ghi chú nội bộ** `POST /v1/manage/bookings/{id}/notes` `{ text }` → `201 { id, text, byAccountId, byName, at }` (154, khách không thấy).
* **Ghi nhận hoàn** `POST /v1/manage/bookings/{id}/refund` `{ amount*, note }` (149).
* Lịch sử xử lý: `GET /v1/bookings/{id}/history` (admin thấy cả `byName`, mục `internal`).

### 9.6 🛠 Yêu cầu hủy và hoàn tiền
* `GET /v1/manage/requests?status=pending&type=cancel&bookingId=` (cũ nhất trước). Khách chỉ còn **yêu cầu hủy** (đơn đã thanh toán); không còn yêu cầu đổi ghế / đổi chuyến / hoàn tiền do mất ghế.
* `POST /v1/manage/requests/{id}/approve` `{ note, refundAmount? }` → `{ request, booking, refundAmount }` (như `approve-cancel`). `POST /v1/manage/requests/{id}/reject` `{ note }`.
* `GET /v1/manage/refunds?status=pending|recorded&orderType=` → `[{ id, orderType, orderId, orderCode, accountId, amount, reason: cancel|trip_cancelled|parcel_cancel|compensation|manual|customer, status, customer: {displayName, phone}, note, recordedAt, createdAt }]` — hiện tên + SĐT để nhà xe **gọi khách hoàn tiền ngoài app**.
* `POST /v1/manage/refunds/{id}/record` `{ amount?, note }` — nhà xe đã chuyển hoàn (**app không chuyển tiền**); số hoàn được trừ khỏi doanh thu.

### 9.7 🛠 Chuyến (tab Chuyến)
| Method | Đường dẫn | Body / ghi chú |
|---|---|---|
| GET | `/v1/manage/trips?from=&to=&routeId=&vehicleId=&driverId=&tripStatus=&needs=vehicle\|driver` | Lịch theo ngày/tuần (157). Mỗi chuyến có `tripStatus`, `vehicle {id, plateNo...}`, `driver {id, name, phone}`, `seats {total, free, pending, sold, locked}`, `fillPercent`, `needsVehicle`, `needsDriver`, `warnings: ["vehicle_conflict", "driver_conflict"]`, `parcelLoad`, `checklistDone/Total`... |
| POST | `/v1/manage/trips` | `{ routeId*, date*, departTime*, vehicleId (hoặc layoutId), driverId, basePrice, prices: [{seatClass, price}], salesOpenAt, salesCloseAt, parcelCapacity: {maxKg, maxPieces}, driverPay, note, force, overrideReason }` (158, 160, 162) |
| GET | `/v1/manage/trips/{id}` | Chi tiết + `checklist`, `shuttleDuties`, `logs`, `expenses {items, total, driverPay}`, `bookingsByStatus`, `waitlistCount` |
| PATCH | `/v1/manage/trips/{id}` | `{ date, departTime, basePrice, prices, salesOpenAt, salesCloseAt, salesClosed, parcelCapacity, driverPay, note, force, overrideReason }`. Đổi giờ → báo khách. Đổi giá chỉ áp đơn mới (161) |
| DELETE | `/v1/manage/trips/{id}` | Chỉ khi chưa có đơn nào (`409 trip_has_bookings`) |
| PUT | `/v1/manage/trips/{id}/driver` | `{ driverId, force?, overrideReason? }` (200) |
| PUT | `/v1/manage/trips/{id}/vehicle` | `{ vehicleId, force?, overrideReason? }` (166). Sơ đồ mới thiếu ghế đã bán → `409 seats_mismatch` `{ missingSeats }` |
| POST | `/v1/manage/trips/{id}/status` | `{ status: scheduled\|running\|completed }`. `completed` → đơn xác nhận thành `completed`, cộng điểm |
| POST | `/v1/manage/trips/{id}/cancel` | `{ reason*, moveToTripId? }` → hủy mọi đơn, hoàn tiền chờ, báo khách (164) |
| POST | `/v1/manage/trips/{id}/move-passengers` | `{ toTripId*, bookingIds?, reason }` → `{ moved: [codes], failed: [{code, error}] }` (165) |
| GET | `/v1/manage/trips/{id}/seats` | Sơ đồ ghế + `booking {id, code, status, source, passengerName, passengerPhone}`, `lockReason`, `claimedAt` mỗi ghế (168) |
| POST | `/v1/manage/trips/{id}/seats/{seatId}/lock` · `/unlock` | `{ reason* }` (171) |
| GET | `/v1/manage/trips/{id}/manifest` | `{ total, boarded, absent, items: [{ bookingId, bookingCode, bookingSeatId, seatLabel, passengerName, passengerPhone, note, pickupOffice, dropOffice, pickupShuttle, dropShuttle, boarding }] }` — không email (173) |
| POST | `/v1/manage/trips/{id}/boarding` | `{ marks: [{ bookingSeatId, state: boarded\|absent\|none }] }` (175, 176) |
| GET | `/v1/manage/trips/{id}/shuttle` | `{ duties, pickup: [{officeId, officeName, zoneId, zoneName, items: [{shuttleId, bookingCode, passengerName, passengerPhone, seatCount, addressText, noteText, plannedTime, status}]}], drop: [...] }` (174) |
| PATCH | `/v1/manage/shuttle-requests/{shuttleId}` | `{ status: pending\|done\|absent\|cancelled, zoneId, addressText, noteText, plannedAt }` (174, 215) |
| PUT | `/v1/manage/trips/{id}/shuttle-duties` | `{ duties: [{ officeId, direction, dutyText: "Anh Tú - 30A-123.45 - 0912…" }] }` |
| GET / POST | `/v1/manage/trips/{id}/logs` | `{ kind*: depart\|arrive\|delay\|incident\|note, atTime, text, delayMinutes, visibleToCustomer, complete }`. `depart` → chuyến chạy; `arrive` → hoàn thành; `delay`/`incident` → báo mọi khách (177, 178) |
| POST | `/v1/manage/trips/{id}/notify` | `{ text* }` → `{ sent }` thông báo cả chuyến (179) |
| GET | `/v1/manage/trips/{id}/driver-text?lang=` | `{ text }` danh sách khách + trung chuyển + hàng gửi để gửi tài xế qua Zalo (180) |
| PUT / PATCH | `/v1/manage/trips/{id}/checklist`, `/checklist/{itemId}` | Nạp lại từ mẫu / `{ isDone }` (184) |
| GET | `/v1/manage/trips/{id}/parcels` | `{ capacity, load, totalKg, totalPieces, items }` (181) |
| PUT | `/v1/manage/trips/{id}/parcel-capacity` | `{ maxKg, maxPieces }` (222) |
| GET / PATCH | `/v1/manage/trips/{id}/waitlist`, `/manage/waitlist/{id}` | `{ freeSeats, items: [{..., position, customer}] }` / `{ status: waiting\|contacted\|fulfilled\|cancelled }` (172) |
| CRUD | `/v1/manage/trips/{tripId}/expenses` | Chi phí chuyến (241) |
| GET | `/v1/manage/trips/{id}/driver-suggestions` | `{ items: [{ driverId, name, available, isOff, conflicts, weekDrivingMinutes, tripsOnRoute, licenseExpiresOn, isCurrent }] }` (201) |
| GET | `/v1/manage/trips/merge-suggestions?from=&to=` | `{ items: [{ tripA, tripB, gapMinutes, combinedPassengers, fitsInA, fitsInB }] }` (167, chỉ gợi ý) |

**Trùng lịch (199):** cùng xe hoặc cùng tài xế, khoảng `[giờ đi, giờ đi + thời gian chạy + nghỉ tối thiểu)` chồng nhau → `409 schedule_conflict`:
```json
{ "code": "schedule_conflict", "conflicts": [{ "kind": "vehicle", "tripId": "980c…", "departAt": "2026-11-20T00:30:00Z" }], "hint": "force_with_reason" }
```
Muốn vẫn tạo: gửi lại với `force: true` + `overrideReason`. Tài xế nghỉ / đã nghỉ việc → `409 driver_unavailable`; xe không hoạt động → `409 vehicle_inactive`.

### 9.8 🛠 Chuyến lặp theo lịch
* `POST /v1/manage/series` `{ routeId*, vehicleId*, driverId, weekdays*: [0..6] (0 = Chủ nhật), departTime*, startDate*, endDate, basePrice*, prices, note }` → `201 { ...series, createdTrips }`. Server sinh chuyến tới **45 ngày** tới (cron chạy hằng ngày để nối tiếp), không sinh vô hạn.
* `GET /v1/manage/series`, `GET /v1/manage/series/{id}`.
* `PATCH /v1/manage/series/{id}` → sinh lại chuyến tương lai **chưa có đơn**; chuyến đã có đơn giữ nguyên → `keptTripsWithBookings`.
* `DELETE /v1/manage/series/{id}` → `{ deletedTrips, keptTripsWithBookings }`.
* `POST /v1/manage/series/{id}/exceptions` `{ date*, type*: skip|retime, newDepartTime, note }` (nghỉ hoặc đổi giờ một lần). Ngày đó đã có đơn → `409 trip_has_bookings` (hủy chuyến bằng 9.7).
* `POST /v1/manage/series/{id}/generate` sinh ngay.

### 9.9 🛠 Gửi đồ (quản trị)
| Method | Đường dẫn | Body |
|---|---|---|
| GET | `/v1/manage/parcels?status=&paid=true\|false&tripId=&routeId=&date=&q=` | |
| POST | `/v1/manage/parcels` | Nhận hàng tại quầy (139): như 6.3 + `sender*`, `tripId`, `payMethod*: cash\|transfer`, `fee`, `feeAdjustReason` → `201` + `handoverCode`, `shareText`; vào thẳng `received`, cước ghi nhận đã thu |
| POST | `/v1/manage/parcels/{id}/accept` | `{ tripId*, actualWeightKg, fee, feeAdjustReason }` — cước khác ước tính **bắt buộc lý do**; vượt tải → `409 capacity_exceeded` (152, 222) |
| POST | `/v1/manage/parcels/{id}/reject` | `{ reason* }` |
| POST | `/v1/manage/parcels/{id}/status` | `{ status*: received\|loaded\|arrived, note, actualWeightKg, fee, feeAdjustReason, payMethod?: cash\|transfer }` — **`received` = khách đã mang hàng tới quầy và trả cước**: cước được ghi nhận đã thu (`payMethod` mặc định `cash`), tính doanh thu từ lúc này (182) |
| POST | `/v1/manage/parcels/{id}/handover` | `{ code*, receiverName }` → `delivered`; sai → `400 handover_invalid` (`attemptsLeft`), 5 lần → `handover_locked` |
| POST | `/v1/manage/parcels/{id}/handover-code` | Tạo mã mới → `{ handoverCode }` (mở khóa) |
| POST | `/v1/manage/parcels/{id}/unclaimed` | Không có người nhận → báo người gửi |
| POST | `/v1/manage/parcels/{id}/issue` | `{ kind*: damaged\|lost\|late\|other, note*, compensationAmount }` → `issue`, bồi thường vào hàng đợi hoàn (183) |
| PUT | `/v1/manage/parcels/{id}/trip` | `{ tripId* }` chuyển chuyến |
| POST | `/v1/manage/parcels/{id}/cancel` | `{ note, refundAmount }` |
| GET | `/v1/manage/parcels/{id}/share-text?handoverCode=` | `{ text }` |

### 9.10 🛠 Đánh giá, báo cáo, khiếu nại, tin nhắn
* `GET /v1/manage/reviews?status=visible|hidden&routeId=&replied=false&stars=` · `POST /v1/manage/reviews/{id}/reply` `{ reply* }` · `POST .../hide` · `POST .../show` (232).
* `GET /v1/admin/reports?status=open|resolved` → mỗi báo cáo kèm `target {text, stars, status, authorAccountId, authorName, bookingId}`. `POST /v1/admin/reports/{id}/resolve` `{ action*: none|hide_content|warn|suspend_account, resolution* }` (233).
* `GET /v1/admin/complaints?status=open,in_progress` · `GET /v1/complaints/{id}` (admin thấy kèm `booking`/`parcel` và `messages`) · `POST /v1/complaints/{id}/replies` `{ text, status, resolution }` (234).
* `GET /v1/manage/messages?unread=true` → `{ items: [{ bookingId, bookingCode, customerName, unread, lastText, lastAt }] }`; đọc/trả lời bằng `/v1/bookings/{id}/messages` (235).
* `GET /v1/admin/contact-messages?status=open` · `POST /v1/admin/contact-messages/{id}/reply` `{ reply, status }` (236).
* `GET /v1/admin/actions?targetType=&targetId=` — lịch sử xử lý báo cáo, khiếu nại, khóa tài khoản (239).

### 9.11 🛠 Doanh thu, đối soát và báo cáo

**Trang Doanh thu:** `GET /v1/manage/revenue?from=yyyy-MM-dd&days=7|30|60` (mặc định 30 ngày kết thúc hôm nay) — tính hết ở máy chủ, app chỉ vẽ:
```json
{
  "from": "2026-10-21", "to": "2026-11-19", "days": 30, "previousFrom": "2026-09-21",
  "total": 5300000, "previousTotal": 4100000, "changePercent": 29.3, "averagePerDay": 176667, "bestDay": { "date": "2026-11-12", "amount": 900000 },
  "daily": [{ "date": "2026-10-21", "app": 0, "counter": 250000, "parcel": 0, "refunded": 0, "amount": 250000 }],
  "previousDaily": [ "…cùng dạng, kỳ ngay trước…" ],
  "bySource": { "app": 4000000, "counter": 1000000, "parcel": 300000 },
  "byRoute": [{ "routeId": "…", "name": "Hà Nội → Thái Bình", "amount": 3200000 }],
  "byWeekday": [{ "weekday": 0, "average": 120000 }, "… 7 phần tử, 0 = Chủ nhật"],
  "note": "by_route_uses_departure_day"
}
```
* **Doanh thu một ngày** = tiền thu trong ngày đó (đơn từ app đã thu, đơn đặt hộ tại quầy, cước gửi đồ từ lúc `received`) − hoàn tiền đã ghi nhận trong ngày; ghế miễn phí không tính. Đơn đã duyệt chưa thu **chưa** vào.
* `byRoute` tính theo **ngày chạy** (không phải ngày thu) nên tổng theo tuyến có thể lệch tổng theo ngày: app ghi chú điều này. `bySource` = 3 nguồn `app` / `counter` / `parcel` (vòng tròn tỷ trọng). `byWeekday` = trung bình theo thứ trong tuần.
* `changePercent` so với `previousTotal` (kỳ ngay trước, cùng độ dài; `null` khi kỳ trước = 0).

**Báo cáo khác:**
`GET /v1/manage/reports/{kind}?from=yyyy-MM-dd&to=yyyy-MM-dd` (mặc định 30 ngày; số liệu **theo ghi nhận trong app**, đối chiếu thêm với sao kê):
| `kind` | Tham số thêm | Nội dung |
|---|---|---|
| `reconciliation` | `routeId` | Theo chuyến: `byCash`, `byTransfer`, `parcelRevenue`, `refunded`, `refundPending`, **`approvedUnpaid`** (giá trị đơn đã duyệt chưa thu) + `approvedUnpaidCount`, `comps`, `net` + `totals` (240) |
| `profit` | `groupBy=trip\|route\|vehicle` | `revenue`, `refunded`, `expenses`, `grossProfit`, `seatsSold`, `averageTicket`, `breakEvenSeats` (241, 242, 253) |
| `occupancy` | `groupBy=trip\|route\|hour` | `seats`, `sold`, `fillPercent` (243) |
| `revenue` | `groupBy=day\|week\|month` | `app`, `counter`, `booking`, `parcel`, `refunds`, `net` theo kỳ + `totals` (244) |
| `top` | | `routes`, `hours` bán chạy (245) |
| `rates` | | `cancelRate`, `rejectRate`, `reviewTime {averageMinutes, maxMinutes}` — thời gian duyệt trung bình (246, 247) |
| `parcels` | | Theo tuyến, tháng + `averageLoadPerTrip` (248) |
| `comps` | | Ghế tặng / giá đặc biệt theo tháng, lý do (249) |
| `shuttle` | | Theo khu vực: `pickups`, `drops`, `absent`, `revenue` (250) |
| `forecast` | `routeId` | `enough`, `weekdayAverage`, `items: [{date, expectedSeats, holiday}]` — không dự báo khi < 4 tuần dữ liệu (252) |

Xuất tệp: `GET /v1/manage/export?type=bookings|trips|reconciliation|parcels&from=&to=` → **CSV** (UTF-8 BOM, mở bằng Excel) (251, 263).

### 9.12 🛠 Cấu hình nhà xe
`GET /v1/admin/settings` (tất cả) · `GET /v1/admin/settings/{key}` · `PUT|PATCH /v1/admin/settings/{key}` (gửi phần muốn đổi). Alias theo spec: `PUT /v1/admin/operator`, `/admin/cancel-policy`. Phụ thu ghế hàng đầu / VIP đặt **theo xe** (10, mục Xe) và được sao chép vào chuyến lúc tạo.

| `key` | Trường |
|---|---|
| `operator` (203) | `name, description, phone, email, address, openText, representativeName, licenseNoText, website` |
| `cancelPolicy` (205) | `tiers: [{hoursBefore, refundPercent}]`, `cancelFee`, `changeAllowedHoursBefore`, `changeFee`, `note` |
| `rules` (206) | `items: [{ kind: luggage\|food\|pets\|children\|other, text }]` |
| `system` (255) | `bookingLeadHours` (0-72, mặc định 4), `maxSeatsPerBooking` (mặc định 6), `bookDaysAhead` (mặc định 7), `reviewDeadlineMinutes` (mặc định 30), `driverRestMinutes`, `salesOpenDaysBefore`, `salesCloseMinutesBefore`, `lowFillPercent` |
| `shuttle` (214) | `registerHoursBefore`, `feeRefundable`, `note` |
| `loyalty` (230) | `enabled`, `earnPointsPer10k` (mặc định 1: cộng `total/10000` điểm khi duyệt đơn; **không đổi ra tiền**), `tiers: [{name, minPoints, benefitText}]` — Thành viên 0, Bạc 80, Vàng 200, Kim cương 500 |
| `referral` (231) | `enabled`, `referrerPromotionId`, `referredPromotionId`, `maxPerReferrer` |
| `parcel` (223, 224) | `enabled`, `acceptHoursBefore`, `unclaimedHours`, `defaultMaxKg`, `defaultMaxPieces`, `maxWeightKgPerOrder`, `sizeClasses`, `cancelAfterReceivePercent`, `maxCompensationMultiple`, `claimDays`, `compensationText`, `note` |
| `content` (237) | `termsVi, termsEn, privacyVi, privacyEn, helpVi, helpEn, aboutVi, aboutEn` |

Bật/tắt trung chuyển và gửi đồ theo tuyến: trường `shuttleEnabled`, `parcelEnabled` của tuyến (mục 10).

### 9.13 🛠 Quản trị viên và khách hàng
* `GET /v1/admin/admins` · `POST /v1/admin/admins` `{ email*, displayName*, phone }` (SĐT trùng → `409 phone_taken`) → `201 { account, temporaryPassword }` (hiện **một lần** để trao cho người mới) · `POST /v1/admin/admins/{id}/reset-password` → `{ temporaryPassword }` · `POST /v1/admin/admins/{id}/revoke` (hoặc `DELETE`) → `204`. Không tự thu hồi mình; quản trị viên cuối → `409 last_admin` (256, 260). Không ép đổi mật khẩu.
* **Khách hàng** (`/v1/manage/customers`, alias `/v1/admin/customers`):
  * `GET ?q=&status=active|suspended&kind=new|returning` → `{ items: [{ id, email, displayName, phone, status, locked, lockReason, adminNote, bookings, completedTrips, totalSpent, kind, firstBookingAt, lastBookingAt, lastLoginAt, createdAt }] }` (225).
  * `POST` `{ displayName*, phone*, email?, password* }` → `201` — admin tạo khách (cùng ràng buộc như đăng ký, mật khẩu ban đầu do admin đặt; khách mới có sẵn mã `CHAOBAN`).
  * `GET /{id}` (+ `loyalty`, `recentBookings`, `recentParcels`, `adminHistory`).
  * `PATCH /{id}` `{ displayName, phone, email, adminNote, password? }` — `password` để trống = giữ nguyên; có giá trị = đặt lại và **đăng xuất mọi thiết bị**.
  * `POST /{id}/reset-password` `{ password? }` → `{ temporaryPassword }` (khi không gửi `password`; hiện **một lần**) — dùng cho khách quên mật khẩu chỉ có SĐT; tự đóng tin `password_reset` trong hộp thư.
  * `POST /{id}/lock` `{ reason* }` · `POST /{id}/unlock` — khóa: đăng xuất mọi thiết bị, đăng nhập báo `account_suspended` (226). Alias cũ `POST /v1/admin/accounts/{id}/suspend|unsuspend`.
  * `DELETE /{id}` → `204` — **chỉ khi khách chưa có đơn đặt ghế / gửi đồ nào**; ngược lại `409 in_use` (`bookings`, `parcels`) và nên **khóa** thay vì xóa. Xóa được thì xóa luôn ví mã, điểm, mã giới thiệu, thông báo, thiết bị.
* `POST /v1/admin/promotions/{id}/grant` `{ accountIds: [...] }` → `{ granted, skipped }` — phát mã vào ví (227).

### 9.14 🛠 Công cụ
* `GET /v1/admin/search?q=` (≥2 ký tự, không dấu) → `{ bookings, customers, trips, parcels, guests }` (257).
* `POST /v1/admin/import/{routes|vehicles|staff}` `{ csv*, dryRun: true }` (258) → `{ type, columns, dryRun, total, valid, invalid, created, rows: [{ line, data, errors: [{field, code}] }] }`. Xem trước với `dryRun: true`, rồi gửi lại `dryRun: false` (chỉ ghi khi **mọi dòng hợp lệ**). Dấu phân cách `,` hoặc `;`. Cột:
  * `routes`: `name, fromProvince*, toProvince*, durationMinutes*, basePrice` (tỉnh theo tên, không dấu cũng được)
  * `vehicles`: `plateNo*, kindLabel*, layout*` (tên sơ đồ ghế), `year, colorText, note`
  * `staff`: `kind*` (`limo_driver|shuttle_driver|office_staff`), `name*`, `phone, positionText, office, joinedOn, licenseClassText, licenseExpiresOn, payPerTrip`
* `GET /v1/manage/seat-layouts/templates` → mẫu sơ đồ 9 / 11 / 16 chỗ, gửi nguyên vào `POST /manage/seat-layouts` (186).
* `POST /v1/manage/routes/{id}/duplicate` `{ reverse: true }` → tuyến chiều ngược (đổi tỉnh, văn phòng lên/xuống, giờ tới), trạng thái `paused` (216).
* `GET /v1/manage/routes/stats` → `{ items: [{ routeId, name, plannedMinutes, avgActualMinutes, avgDepartDelayMinutes, sampleTrips }] }` (218).

---

## 10. 🛠 CRUD danh mục

Mỗi bảng có 5 thao tác chuẩn:
* `GET {path}?q=&<lọc>&cursor=&limit=` → `{ items, nextCursor, total }`
* `GET {path}/{id}` · `POST {path}` → `201` · `PATCH {path}/{id}` (chỉ trường gửi lên) · `DELETE {path}/{id}` → `204`
* Mỗi bản ghi trả `id`, các trường dưới đây, `createdAt`, `updatedAt`. Trường *chỉ đọc* server tự tính.
* Trường `ref` sai id → `400` `fields[].code = "not_found"`.

<!-- CRUD:START -->

### Tỉnh / thành phố (219)

`GET /v1/admin/provinces` · `POST /v1/admin/provinces` · `GET|PATCH|DELETE /v1/admin/provinces/{id}` — 🔒 quản trị viên

Danh sách: lọc: `isActive`; `q` tìm không dấu theo `name`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤80 | ✓ |  |
| `nameNoAccent` | chuỗi ≤200 — *chỉ đọc* |  |  |
| `sortOrder` | số nguyên 0..10000 |  | `0` |
| `isActive` | true/false |  | `true` |

Không trùng: `name` → `409 duplicate`.
Không xóa được khi còn: offices, routes → `409 has_dependents` (`blockedBy`).

### Văn phòng (207)

`GET /v1/manage/offices` · `POST /v1/manage/offices` · `GET|PATCH|DELETE /v1/manage/offices/{id}` — 🔒 quản trị viên

Danh sách: lọc: `provinceId`, `isActive`; `q` tìm không dấu theo `name`, `address`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `provinceId` | id Province | ✓ |  |
| `name` | chuỗi ≤100 | ✓ |  |
| `address` | chuỗi ≤300 | ✓ |  |
| `phone` | SĐT |  |  |
| `openText` | chuỗi ≤200 |  |  |
| `directionNote` | văn bản ≤1000 |  |  |
| `isActive` | true/false |  | `true` |
| `sortOrder` | số nguyên 0..10000 |  | `0` |

Không xóa được khi còn: shuttleZones, routes, bookings, parcels → `409 has_dependents` (`blockedBy`).

### Khu vực xe trung chuyển (213)

`GET /v1/manage/shuttle-zones` · `POST /v1/manage/shuttle-zones` · `GET|PATCH|DELETE /v1/manage/shuttle-zones/{id}` — 🔒 quản trị viên

Danh sách: lọc: `officeId`, `isActive`; `q` tìm không dấu theo `name`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `officeId` | id Office | ✓ |  |
| `name` | chuỗi ≤100 | ✓ |  |
| `pickupEnabled` | true/false |  | `true` |
| `dropEnabled` | true/false |  | `true` |
| `fee` | tiền (đồng, số nguyên ≥ 0) |  | `0` |
| `leadMinutes` | số nguyên 0..600 |  | `30` |
| `dropMinutes` | số nguyên 0..600 |  | `30` |
| `isActive` | true/false |  | `true` |
| `note` | chuỗi ≤300 |  |  |

### Sơ đồ ghế (186)

`GET /v1/manage/seat-layouts` · `POST /v1/manage/seat-layouts` · `GET|PATCH|DELETE /v1/manage/seat-layouts/{id}` — 🔒 quản trị viên

Danh sách: `q` tìm không dấu theo `name`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤80 | ✓ |  |
| `rows` | số nguyên 2..7 | ✓ |  |
| `cols` | số nguyên 2..4 | ✓ |  |
| `seats` | mảng object (≤80): `id`* chuỗi ≤10 (`^[A-Za-z0-9_-]+$`); `label`* chuỗi ≤10; `row`* số nguyên 0..30; `col`* số nguyên 0..10; `seatClass` chuỗi ≤30; `isSellable` true/false | ✓ |  |
| `note` | chuỗi ≤300 |  |  |

Không xóa được khi còn: vehicles → `409 has_dependents` (`blockedBy`).

### Xe — limo và xe trung chuyển (185-192)

`GET /v1/manage/vehicles` · `POST /v1/manage/vehicles` · `GET|PATCH|DELETE /v1/manage/vehicles/{id}` — 🔒 quản trị viên

Danh sách: lọc: `type`, `status`, `layoutId`; `q` tìm không dấu theo `plateNo`, `name`, `kindLabel`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `type` | `limo` \| `shuttle` |  | `"limo"` |
| `plateNo` | chuỗi ≤20 | ✓ |  |
| `name` | chuỗi ≤80 |  |  |
| `kindLabel` | chuỗi ≤80 |  |  |
| `layoutId` | id SeatLayout |  |  |
| `capacity` | số nguyên 1..60 |  |  |
| `seatCount` | số nguyên — *chỉ đọc* |  |  |
| `frontSurcharge` | tiền (đồng, số nguyên ≥ 0) |  | `30000` |
| `vipSurcharge` | tiền (đồng, số nguyên ≥ 0) |  | `60000` |
| `year` | số nguyên 1980..2100 |  |  |
| `colorText` | chuỗi ≤40 |  |  |
| `status` | `active` \| `maintenance` \| `retired` |  | `"active"` |
| `defaultDriverId` | id StaffMember |  |  |
| `amenities` | mảng chuỗi (≤20 phần tử) |  |  |
| `docDates` | mảng object (≤10): `kind`* `registration` \| `insurance` \| `other`; `label` chuỗi ≤80; `expiresOn`* `yyyy-MM-dd` |  |  |
| `parcelMaxKg` | số ≤5000 |  |  |
| `parcelMaxPieces` | số nguyên 0..1000 |  |  |
| `note` | văn bản ≤1000 |  |  |

Không trùng: `plateNo` → `409 duplicate`.
Không xóa được khi còn: trips → `409 has_dependents` (`blockedBy`).

### Bảo dưỡng xe (191)

`GET /v1/manage/maintenance` · `POST /v1/manage/maintenance` · `GET|PATCH|DELETE /v1/manage/maintenance/{id}` — 🔒 quản trị viên

Danh sách: lọc: `vehicleId`; `q` tìm không dấu theo `description`; `from`/`to` theo `date`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `vehicleId` | id Vehicle | ✓ |  |
| `date` | `yyyy-MM-dd` | ✓ |  |
| `description` | chuỗi ≤300 | ✓ |  |
| `cost` | tiền (đồng, số nguyên ≥ 0) |  | `0` |
| `nextDueOn` | `yyyy-MM-dd` |  |  |
| `note` | văn bản ≤1000 |  |  |

### Nhân viên & tài xế (194-196, 202)

`GET /v1/admin/staff` · `POST /v1/admin/staff` · `GET|PATCH|DELETE /v1/admin/staff/{id}` — 🔒 quản trị viên

Danh sách: lọc: `kind`, `status`, `officeId`; `q` tìm không dấu theo `name`, `phone`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `kind` | `limo_driver` \| `shuttle_driver` \| `office_staff` | ✓ |  |
| `name` | chuỗi ≤80 | ✓ |  |
| `phone` | SĐT |  |  |
| `positionText` | chuỗi ≤80 |  |  |
| `officeId` | id Office |  |  |
| `joinedOn` | `yyyy-MM-dd` |  |  |
| `licenseClassText` | chuỗi ≤20 |  |  |
| `licenseExpiresOn` | `yyyy-MM-dd` |  |  |
| `status` | `active` \| `left` |  | `"active"` |
| `payPerTrip` | tiền (đồng, số nguyên ≥ 0) |  | `0` |
| `note` | văn bản ≤1000 |  |  |

Không xóa được khi còn: trips, vehicles → `409 has_dependents` (`blockedBy`).

### Lịch làm / ngày nghỉ / ca (197, 198)

`GET /v1/admin/staff-schedules` · `POST /v1/admin/staff-schedules` · `GET|PATCH|DELETE /v1/admin/staff-schedules/{id}` — 🔒 quản trị viên

Danh sách: lọc: `staffId`, `kind`, `shift`, `officeId`; `from`/`to` theo `date`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `staffId` | id StaffMember | ✓ |  |
| `date` | `yyyy-MM-dd` | ✓ |  |
| `kind` | `work` \| `off` | ✓ |  |
| `shift` | `morning` \| `afternoon` \| `night` \| `full` |  | `"full"` |
| `officeId` | id Office |  |  |
| `note` | chuỗi ≤300 |  |  |

Không trùng: `staffId` + `date` + `shift` → `409 duplicate`.

### Tuyến (210-217)

`GET /v1/manage/routes` · `POST /v1/manage/routes` · `GET|PATCH|DELETE /v1/manage/routes/{id}` — 🔒 quản trị viên

Danh sách: lọc: `status`, `fromProvinceId`, `toProvinceId`; `q` tìm không dấu theo `name`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤120 |  |  |
| `fromProvinceId` | id Province | ✓ |  |
| `toProvinceId` | id Province | ✓ |  |
| `durationMinutes` | số nguyên 10..2880 | ✓ |  |
| `status` | `active` \| `paused` |  | `"active"` |
| `basePrice` | tiền (đồng, số nguyên ≥ 0) |  | `0` |
| `stops` | mảng object (≤30): `name`* chuỗi ≤100; `sortOrder` số nguyên; `offsetMinutes` số nguyên 0..2880 |  |  |
| `offices` | mảng object (≤40): `officeId`* id Office; `side`* `pickup` \| `drop`; `offsetMinutes`* số nguyên 0..2880; `sortOrder` số nguyên |  |  |
| `shuttleEnabled` | true/false |  | `true` |
| `parcelEnabled` | true/false |  | `false` |
| `usefulInfo` | văn bản ≤3000 |  |  |
| `note` | văn bản ≤1000 |  |  |

Không xóa được khi còn: trips, series, parcelRates → `409 has_dependents` (`blockedBy`).

### Mã giảm giá (227)

`GET /v1/admin/promotions` · `POST /v1/admin/promotions` · `GET|PATCH|DELETE /v1/admin/promotions/{id}` — 🔒 quản trị viên

Danh sách: lọc: `isActive`, `audience`; `q` tìm không dấu theo `code`, `title`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `code` | chuỗi ≤20 (`^[A-Za-z0-9]{4,20}$`) | ✓ |  |
| `title` | chuỗi ≤120 |  |  |
| `description` | văn bản ≤1000 |  |  |
| `kind` | `percent` \| `amount` | ✓ |  |
| `value` | số nguyên 1..100000000 | ✓ |  |
| `maxDiscount` | tiền (đồng, số nguyên ≥ 0) |  |  |
| `minAmount` | tiền (đồng, số nguyên ≥ 0) |  | `0` |
| `startAt` | ISO 8601 |  |  |
| `endAt` | ISO 8601 |  |  |
| `usageLimit` | số nguyên 1..∞ |  |  |
| `perUserLimit` | số nguyên 1..∞ |  | `1` |
| `usedCount` | số nguyên — *chỉ đọc* |  | `0` |
| `audience` | `public` \| `wallet` |  | `"public"` |
| `routeId` | id Route |  |  |
| `isActive` | true/false |  | `true` |

Không trùng: `code` → `409 duplicate`.
Không xóa được khi còn: bookings → `409 has_dependents` (`blockedBy`).

### Giá theo mùa / dịp lễ (228)

`GET /v1/admin/seasonal-prices` · `POST /v1/admin/seasonal-prices` · `GET|PATCH|DELETE /v1/admin/seasonal-prices/{id}` — 🔒 quản trị viên

Danh sách: lọc: `routeId`, `isActive`; `q` tìm không dấu theo `name`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤100 | ✓ |  |
| `routeId` | id Route |  |  |
| `fromDate` | `yyyy-MM-dd` | ✓ |  |
| `toDate` | `yyyy-MM-dd` | ✓ |  |
| `adjustKind` | `percent` \| `amount` | ✓ |  |
| `adjustValue` | số nguyên -10000000..10000000 | ✓ |  |
| `isActive` | true/false |  | `true` |

### Thông báo chung / tin nhà xe (238)

`GET /v1/admin/announcements` · `POST /v1/admin/announcements` · `GET|PATCH|DELETE /v1/admin/announcements/{id}` — 🔒 quản trị viên

Danh sách: lọc: `kind`, `isPublished`; `q` tìm không dấu theo `title`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `title` | chuỗi ≤150 | ✓ |  |
| `body` | văn bản ≤5000 | ✓ |  |
| `kind` | `news` \| `schedule` \| `holiday` \| `info` \| `promo` |  | `"news"` |
| `routeId` | id Route |  |  |
| `startAt` | ISO 8601 |  |  |
| `endAt` | ISO 8601 |  |  |
| `isPublished` | true/false |  | `true` |
| `notify` | true/false |  | `true` |

### Câu hỏi thường gặp (237)

`GET /v1/admin/faq` · `POST /v1/admin/faq` · `GET|PATCH|DELETE /v1/admin/faq/{id}` — 🔒 quản trị viên

Danh sách: lọc: `language`, `category`, `isActive`; `q` tìm không dấu theo `question`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `language` | `vi` \| `en` | ✓ |  |
| `category` | `booking` \| `payment` \| `parcel` \| `account` \| `other` |  | `"other"` |
| `question` | chuỗi ≤300 | ✓ |  |
| `answer` | văn bản ≤5000 | ✓ |  |
| `sortOrder` | số nguyên |  | `0` |
| `isActive` | true/false |  | `true` |

### Mẫu việc trước giờ chạy (184)

`GET /v1/admin/checklist-items` · `POST /v1/admin/checklist-items` · `GET|PATCH|DELETE /v1/admin/checklist-items/{id}` — 🔒 quản trị viên

Danh sách: lọc: `isActive`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `title` | chuỗi ≤200 | ✓ |  |
| `sortOrder` | số nguyên |  | `0` |
| `isActive` | true/false |  | `true` |

### Loại hàng / hàng cấm (221)

`GET /v1/admin/parcel-categories` · `POST /v1/admin/parcel-categories` · `GET|PATCH|DELETE /v1/admin/parcel-categories/{id}` — 🔒 quản trị viên

Danh sách: lọc: `isProhibited`; `q` tìm không dấu theo `name`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤100 | ✓ |  |
| `isProhibited` | true/false |  | `false` |
| `note` | văn bản ≤1000 |  |  |
| `packingNote` | văn bản ≤1000 |  |  |
| `sortOrder` | số nguyên |  | `0` |

Không xóa được khi còn: parcels → `409 has_dependents` (`blockedBy`).

### Hàng cấm gửi (221)

`GET /v1/admin/prohibited-items` · `POST /v1/admin/prohibited-items` · `GET|PATCH|DELETE /v1/admin/prohibited-items/{id}` — 🔒 quản trị viên

Danh sách: `q` tìm không dấu theo `text`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `text` | chuỗi ≤300 | ✓ |  |
| `sortOrder` | số nguyên |  | `0` |

### Bảng cước gửi đồ (220)

`GET /v1/admin/parcel-rates` · `POST /v1/admin/parcel-rates` · `GET|PATCH|DELETE /v1/admin/parcel-rates/{id}` — 🔒 quản trị viên

Danh sách: lọc: `routeId`, `sizeClass`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `routeId` | id Route | ✓ |  |
| `sizeClass` | `small` \| `medium` \| `large` | ✓ |  |
| `maxWeightKg` | số ≤5000 | ✓ |  |
| `price` | tiền (đồng, số nguyên ≥ 0) | ✓ |  |
| `extraPerKg` | tiền (đồng, số nguyên ≥ 0) |  | `0` |
| `declaredValuePercent` | số ≤100 |  | `0` |

Không trùng: `routeId` + `sizeClass` + `maxWeightKg` → `409 duplicate`.

### Khách tại quầy / không dùng app (135)

`GET /v1/admin/guests` · `POST /v1/admin/guests` · `GET|PATCH|DELETE /v1/admin/guests/{id}` — 🔒 quản trị viên

Danh sách: lọc: `phone`, `linkedAccountId`; `q` tìm không dấu theo `name`, `phone`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤80 | ✓ |  |
| `phone` | SĐT (server chuẩn hóa 0xxxxxxxxx) | ✓ |  |
| `note` | văn bản ≤1000 |  |  |
| `linkedAccountId` | chuỗi ≤200 — *chỉ đọc* |  |  |

Không trùng: `phone` → `409 duplicate`.
Không xóa được khi còn: bookings, parcels → `409 has_dependents` (`blockedBy`).

### Chi phí chuyến (241)

`GET /v1/manage/trips/:tripId/expenses` · `POST /v1/manage/trips/:tripId/expenses` · `GET|PATCH|DELETE /v1/manage/trips/:tripId/expenses/{id}` — 🔒 quản trị viên

Danh sách: lọc: `category`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `category` | `fuel` \| `toll` \| `food` \| `driver_pay` \| `parking` \| `repair` \| `other` | ✓ |  |
| `amount` | tiền (đồng, số nguyên ≥ 0) | ✓ |  |
| `note` | chuỗi ≤300 |  |  |

<!-- CRUD:END -->

---

## 11. Bảng nhãn hiển thị

### 11.1 Trạng thái đơn đặt ghế (`booking.status`)
| `status` | Tiếng Việt | English | Màu gợi ý | Nút chính (khách) |
|---|---|---|---|---|
| `pending` | Chờ nhà xe duyệt | Awaiting approval | cam | Hủy đơn |
| `confirmed` | Đã duyệt | Approved | xanh lá | Vé điện tử; Hủy (đã thu thì chờ duyệt hủy) |
| `completed` | Đã đi | Completed | xám | Đánh giá |
| `rejected` | Bị từ chối | Rejected | đỏ | Đặt lại (cuối, không sửa được) |
| `cancel_requested` | Chờ duyệt hủy | Cancellation requested | cam | Rút yêu cầu |
| `cancelled` | Đã hủy | Cancelled | xám | — |

Đối chiếu với tên trong tài liệu app: `pending`=pending, `confirmed`=confirmed, `completed`=completed, `rejected`=rejected, `cancel_requested`=`cancelRequested`, `cancelled`=cancelled.

**Thanh toán** (`paid`, chỉ có nghĩa với đơn `confirmed`/`completed`): `paid = false` → "Chưa thanh toán · trả tại quầy"; `paid = true` → "Đã thanh toán tại quầy". `payMethod`: `cash` Tiền mặt · `transfer` Chuyển khoản trực tiếp · `free` Miễn phí. `source`: `app` (Đặt qua app) · `counter` (Đặt hộ tại quầy).

### 11.2 Trạng thái ghế trên sơ đồ
| `state` | Tiếng Việt | English | Chọn được |
|---|---|---|---|
| `free` | Trống | Available | ✓ |
| `pending` | Đã đặt · chờ duyệt | Booked · awaiting approval | ✗ |
| `sold` | Đã bán | Sold | ✗ |
| `locked` | Đã khóa | Locked | ✗ |
| `unsellable` | Chỗ tài xế / không bán | Driver / not for sale | ✗ (vẽ khác) |

### 11.3 Trạng thái chuyến (`status`)
| `status` | Tiếng Việt | English |
|---|---|---|
| `open` | Đang mở bán | On sale |
| `not_open` | Chưa mở bán (khách không thấy trong tìm kiếm) | Not on sale yet |
| `sold_out` | Hết chỗ | Sold out |
| `closed` | Đã đóng bán | Sales closed |
| `running` | Đang chạy | Running |
| `completed` | Hoàn thành | Completed |
| `cancelled` | Đã hủy | Cancelled |

Admin có thêm `tripStatus` (`scheduled` Đã lên lịch · `running` · `completed` · `cancelled`) và `salesClosed`.

### 11.4 Gửi đồ
| `status` | Tiếng Việt | English |
|---|---|---|
| `pending` | Chờ nhà xe xác nhận | Awaiting confirmation |
| `accepted` | Đã chấp nhận | Accepted |
| `received` | Nhà xe đã nhận hàng | Received at office |
| `loaded` | Đã lên xe | On board |
| `arrived` | Đã tới văn phòng nhận | Arrived |
| `delivered` | Đã giao | Delivered |
| `cancelled` | Đã hủy | Cancelled |
| `rejected` | Bị từ chối | Rejected |
| `issue` | Có sự cố | Issue |

`paid` (Đã thu cước tại quầy, từ `received`). `sizeClass`: `small` (Nhỏ) · `medium` (Vừa) · `large` (Lớn). `timeline.step`: `created` Đã tạo · `accepted` Nhà xe đã xác nhận · `paid` Đã thanh toán · `received` Đã nhận hàng · `loaded` Đã lên xe · `arrived` Đã tới nơi · `delivered` Đã giao.

### 11.5 Khác
| Trường | Giá trị → nhãn |
|---|---|
| Yêu cầu `request.type` | `cancel` Hủy (đơn đã thanh toán) |
| Yêu cầu `request.status` | `pending` Chờ duyệt · `approved` Đã chấp nhận · `rejected` Bị từ chối · `withdrawn` Đã rút |
| Hoàn tiền `refund.status` | `pending` Chờ nhà xe chuyển · `recorded` Nhà xe đã ghi nhận hoàn |
| Trung chuyển `shuttle.status` | `pending` Chờ đón/trả · `done` Đã đón/trả · `absent` Khách vắng · `cancelled` Đã hủy |
| `shuttle.direction` | `pickup` Đón (nhà → văn phòng) · `drop` Trả (văn phòng → nhà) |
| `boarding` | `none` Chưa điểm danh · `boarded` Đã lên xe · `absent` Vắng |
| Khiếu nại `status` | `open` Mới · `in_progress` Đang xử lý · `resolved` Đã xử lý |
| Danh sách chờ `status` | `waiting` Đang chờ · `contacted` Đã liên hệ · `fulfilled` Đã có ghế · `cancelled` Đã hủy |
| Xe `type` | `limo` Limousine (có sơ đồ ghế, chạy tuyến) · `shuttle` Xe trung chuyển (chỉ có sức chứa, không gán vào chuyến) |
| Xe `status` | `active` Hoạt động · `maintenance` Đang bảo dưỡng · `retired` Ngừng khai thác |
| Hạng ghế `seatClass` | `standard` Ghế thường · `front` Hàng đầu (+phụ thu) · `vip` VIP (+phụ thu) |
| Nhân viên `kind` | `limo_driver` Tài xế limo · `shuttle_driver` Tài xế trung chuyển · `office_staff` Nhân viên văn phòng |
| Quy định `rules[].kind` | `luggage` Hành lý · `food` Đồ ăn uống · `pets` Thú cưng · `children` Trẻ em · `other` Khác |
| Cảnh báo `alerts[].kind` | `vehicle_doc` Giấy tờ xe sắp hết hạn · `maintenance_due` Đến hạn bảo dưỡng · `license_expiring` Bằng lái sắp hết hạn · `low_fill` Chuyến ít khách · `trip_unassigned` Chuyến chưa xếp xe/tài xế · `unpaid_soon` Còn đơn chưa thu mà chuyến chạy trong 24 giờ |

---

## 12. Luồng màn hình đề xuất

### 12.0 Đăng nhập (khách & quản trị viên chung màn hình)
1. Ô "Email hoặc số điện thoại" + mật khẩu → `POST /auth/login { login, password, deviceName, deviceId }`.
2. `account.role = customer` → 4 tab khách; `admin` → 5 tab quản trị. Không có bước ép đổi mật khẩu.
3. "Quên mật khẩu" → `POST /auth/forgot { login }` → tài khoản có email: nhập mã + mật khẩu mới (`POST /auth/reset`); chỉ có SĐT: "nhà xe sẽ gọi lại cấp mật khẩu tạm".

### 12.1 Khách đặt ghế (một form + một màn xác nhận)
1. Tab Đặt chuyến → `GET /provinces?hasTrips=true&side=from` → điểm đi → `…&side=to&fromProvinceId=` → ngày.
2. `GET /trips?...` → chọn **giờ chạy** (một chuyến). Hết chỗ → "Đăng ký chờ" (`POST /trips/{id}/waitlist`) và `GET /trips/{id}/alternatives`.
3. `GET /trips/{id}` + `GET /trips/{id}/seats` → chọn **ghế** (tối đa 6). Ghế `pending` / `sold` / `locked` không chọn được.
4. Chọn **văn phòng lên / xuống** (chỉ hỏi khi có > 1 văn phòng ở phía đó), **xe trung chuyển tùy chọn** (`GET /offices/{id}/shuttle-zones`, nhập địa chỉ).
5. Màn xác nhận: tóm tắt + mã giảm giá (ví mã `GET /me/vouchers`) + bảng giá `POST /bookings/quote` → nút **Đặt vé** → `POST /bookings` (Idempotency-Key).
6. Thành công → "Đã đặt ghế B1, B2": mã đơn, chuyến, văn phòng, **số tiền trả tại quầy**. `409 seat_conflict` → tải lại sơ đồ ghế. `422 booking_closed` → "Chuyến đã đóng đặt vé".
7. Vé của tôi: tab Chờ duyệt / Sắp đi / Đã đi / Đã hủy. Mở lại app → `GET /home`, `GET /notifications` để thấy kết quả duyệt / từ chối (không có thông báo đẩy).

### 12.2 Quản trị viên duyệt đơn và thu tiền
Tab Cần xác nhận → `GET /manage/inbox/counts` (huy hiệu) → tab **Đơn chờ duyệt** (`type=booking`, cũ nhất trên, `overdue` tô đỏ) → duyệt / từ chối (lý do) / duyệt hàng loạt → khách đến quầy → tab **Chờ thu tiền** (`type=collect`, chuyến sớm nhất trên) → "Xác nhận đã thu tiền" (tiền mặt / chuyển khoản trực tiếp) → doanh thu ghi nhận. Khách hủy đơn đã thu → tab **Hủy** (`type=cancel`) → duyệt hủy → tab **Hoàn tiền** (`type=refund`) → gọi khách hoàn ngoài app rồi bấm "Đã hoàn".

### 12.3 Ngày chạy
Tab Chuyến → `GET /manage/trips?from=today` → chuyến → `manifest`, `shuttle`, `parcels` → `driver-text` gửi Zalo → điểm danh `boarding` → `logs` `depart` → (`delay` nếu trễ) → `logs` `arrive` (tự hoàn thành chuyến, cộng điểm cho khách).

---

## 13. Giới hạn

| Mục | Giới hạn |
|---|---|
| Đọc / ghi theo IP | 180 / 60 request mỗi phút; đăng nhập, đăng ký, quên mật khẩu: 10 / phút |
| Đăng nhập sai | 5 lần / 15 phút / tài khoản → `429 too_many_attempts` |
| Mã quên mật khẩu | 3 yêu cầu / giờ / email hoặc SĐT, mã hạn 30 phút |
| Tin nhắn trong đơn | 20 / phút; liên hệ nhà xe 10 / giờ |
| Đặt ghế | **Lúc nào cũng đặt được** (không chốt giờ, không giới hạn ngày); tối đa **6 ghế**/đơn (`system.maxSeatsPerBooking`) |
| Body JSON | 1 MB |
| Nhập CSV | 500 dòng |
| Chờ duyệt | Đơn `pending` **không tự hết hạn**: ghế giữ tới khi nhà xe duyệt / từ chối / khách hủy. Quá `system.reviewDeadlineMinutes` (mặc định 30 phút) chỉ được tô `overdue` ở hàng đợi |
| Đơn đã duyệt chưa thu | Chỉ cảnh báo (`unpaid_soon`); chưa tự hủy / nhả ghế |
| Chuyến lặp | sinh trước 45 ngày |

---

## Câu hỏi mở
Cần chốt giữa BE và app (hiện app theo mặc định bên dưới):
1. **Đơn đã duyệt mà khách không đến trả tiền:** hiện chỉ cảnh báo, **không tự hủy / nhả ghế**. Nếu muốn (ví dụ tự nhả khi còn X giờ trước giờ chạy mà chưa thu) thì đây là quy tắc nghiệp vụ mới.
2. **Đơn `pending` không hết hạn:** ghế giữ vô thời hạn tới khi nhà xe xử lý; chỉ đánh dấu `overdue` ở hàng đợi.
3. **Đơn `pending` còn tồn khi chuyến vào khung 4 giờ:** vẫn duyệt được. Khi chuyến **hoàn thành**, các đơn `pending` còn lại tự chuyển `rejected` (lý do `trip_completed`) và nhả ghế.
4. **Hoàn tiền** chỉ ghi nhận; nhà xe liên hệ khách ngoài app (không có tài khoản nhận hoàn).
