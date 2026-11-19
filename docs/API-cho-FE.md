# SeatRoute API — tài liệu ghép API cho app Android

| | |
|---|---|
| **Base URL** | `https://<seatroute-api>.vercel.app` (đổi khi deploy). Mọi endpoint nằm dưới `/v1` |
| **Kiểm tra sống** | `GET /v1/health` |
| **Trang xóa tài khoản** (khai trên Google Play) | `GET /account/delete` (`?lang=en` cho tiếng Anh) |
| **Chính sách quyền riêng tư** | `GET /privacy` (`?lang=en`) |
| **Định dạng** | Chỉ HTTPS, JSON UTF-8. Thời điểm ISO 8601 UTC (`2026-11-20T00:30:00Z`), ngày địa phương `yyyy-MM-dd`, giờ địa phương `HH:mm`. Tiền là **số nguyên đồng** |
| **Đăng nhập** | `Authorization: Bearer <accessToken>` ở mọi endpoint có 🔒 (gần như tất cả) |
| **Vai trò** | `customer` (khách hàng, tự đăng ký) và `admin` (quản trị viên). Máy chủ kiểm tra vai trò ở **mọi** endpoint |

### Thay đổi gần đây
| Ngày | Thay đổi | FE cần làm |
|---|---|---|
| 2026-11-19 | Đăng nhập và quên mật khẩu nhận **email hoặc số điện thoại** trong trường `login` (2.3, 2.6). Mỗi SĐT chỉ thuộc một tài khoản → lỗi mới `409 phone_taken` khi đăng ký / sửa hồ sơ / tạo admin (2.2, 2.8, 9.13) | Đổi ô "Email" thành "Email hoặc số điện thoại", gửi `login` thay cho `email`; hiện thông báo `phone_taken` |
| 2026-11-19 | Bổ sung hướng dẫn hiển thị ảnh chứng từ ở màn hình lịch sử của quản trị viên (5.6, 9.4) | Không đổi API |

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
| GET | `/v1/files/{id}?exp&sig` (ảnh chứng từ, link ký) | [5.6](#56-ảnh-chứng-từ-link-ký-có-hạn) |

### Cả hai vai trò 🔒
| Method | Đường dẫn | Mục |
|---|---|---|
| POST | `/v1/auth/change-password` | [2.7](#27--đổi-mật-khẩu) |
| GET / PATCH / DELETE | `/v1/me` | [2.8](#28--hồ-sơ-và-xóa-tài-khoản) |
| GET / DELETE | `/v1/devices`, `/v1/devices/{id}` | [2.9](#29--thiết-bị-đã-đăng-nhập) |
| GET / POST / DELETE | `/v1/notifications`, `/notifications/unread-count`, `/notifications/read`, `/notifications/{id}` | [7](#7--thông-báo) |
| GET | `/v1/operator`, `/banks`, `/provinces`, `/provinces/{id}/offices`, `/offices`, `/offices/{id}/shuttle-zones`, `/routes/available`, `/routes/{id}/info`, `/faq`, `/content/{key}`, `/announcements`, `/reviews` | [3](#3--danh-mục-chung) |
| GET | `/v1/trips`, `/trips/{id}`, `/trips/{id}/seats`, `/trips/{id}/alternatives` | [4](#4--tìm-chuyến-và-sơ-đồ-ghế) |
| POST | `/v1/bookings/quote` | [5.1](#51--báo-giá--máy-tính-giá) |
| GET | `/v1/bookings`, `/bookings/{id}`, `/bookings/{id}/history`, `/bookings/{id}/share-text` | [5.3](#53--danh-sách-và-chi-tiết-đơn) |
| GET / POST | `/v1/bookings/{id}/messages` | [5.11](#511--trao-đổi-trong-đơn) |
| PATCH | `/v1/bookings/{id}/shuttle` | [5.9](#59--sửa-xe-trung-chuyển) |
| GET | `/v1/proofs/{id}` | [5.6](#56-ảnh-chứng-từ-link-ký-có-hạn) |
| GET / POST | `/v1/parcels`, `/parcels/config`, `/parcels/quote`, `/parcels/{id}` | [6](#6--gửi-đồ) |
| GET / POST | `/v1/complaints/{id}`, `/complaints/{id}/replies` | [8.6](#86--đánh-giá-báo-cáo-khiếu-nại-liên-hệ) |
| POST | `/v1/reports` | [8.6](#86--đánh-giá-báo-cáo-khiếu-nại-liên-hệ) |

### Khách hàng 👤
| Method | Đường dẫn | Mục |
|---|---|---|
| GET | `/v1/home` | [8.1](#81--get-v1home) |
| POST | `/v1/bookings` | [5.2](#52--tạo-đơn-chưa-giữ-ghế) |
| GET | `/v1/bookings/{id}/payment-info` | [5.4](#54--thông-tin-chuyển-khoản-và-mã-qr) |
| POST | `/v1/bookings/{id}/proofs` | [5.5](#55--gửi-ảnh-chứng-từ) |
| POST | `/v1/bookings/{id}/reselect-seats` | [5.7](#57--khi-ghế-bị-người-khác-lấy-trước) |
| GET / POST | `/v1/bookings/{id}/cancel-preview`, `/bookings/{id}/cancel` | [5.8](#58--hủy-đơn) |
| POST | `/v1/bookings/{id}/requests` | [5.10](#510--yêu-cầu-đổi-ghế-đổi-chuyến-hoàn-tiền) |
| GET | `/v1/bookings/{id}/rebook` | [5.12](#512-đặt-lại-nhanh) |
| POST | `/v1/trips/{id}/waitlist` | [4.5](#45--danh-sách-chờ) |
| POST / GET | `/v1/parcels`, `/parcels/{id}/payment-info`, `/parcels/{id}/proofs`, `/parcels/{id}/cancel-preview`, `/parcels/{id}/cancel`, `/parcels/{id}/handover-code`, `/parcels/{id}/share-text`, `/parcels/{id}/issue` | [6](#6--gửi-đồ) |
| POST / PATCH / DELETE | `/v1/reviews`, `/reviews/{id}`, `/complaints`, `/contact` | [8.6](#86--đánh-giá-báo-cáo-khiếu-nại-liên-hệ) |
| CRUD | `/v1/me/passengers`, `/me/addresses`, `/me/receivers`, `/me/favorites` | [8.2](#82--dữ-liệu-lưu-sẵn) |
| GET / PUT / DELETE | `/v1/me/preferences`, `/me/refund-account`, `/me/emergency` | [8.2](#82--dữ-liệu-lưu-sẵn) |
| GET / POST | `/v1/me/loyalty`, `/me/vouchers`, `/me/referral`, `/me/stats` | [8.3](#83--điểm-hạng-ví-mã-giới-thiệu-thống-kê) |
| GET / DELETE | `/v1/me/requests`, `/me/requests/{id}`, `/me/refunds`, `/me/waitlist`, `/me/waitlist/{id}`, `/me/reviews`, `/me/complaints`, `/me/contact` | [8.4](#84--hoạt-động-của-tôi) |
| GET | `/v1/me/data`, `/me/export` | [8.5](#85--quyền-riêng-tư) |

### Quản trị viên 🛠
| Nhóm | Đường dẫn chính | Mục |
|---|---|---|
| Tổng quan | `GET /v1/manage/dashboard`, `/manage/inbox/counts`, `/manage/inbox?type=`, `/manage/calendar` | [9.2](#92--tổng-quan-tab-tổng-quan), [9.3](#93--cần-xác-nhận-hàng-đợi-và-lịch) |
| Chứng từ | `GET /v1/manage/proofs`, `POST /proofs/{id}/approve`, `/reject`, `/request-info`, `POST /manage/proofs/approve` | [9.4](#94--xử-lý-chứng-từ) |
| Đơn đặt ghế | `GET/POST /v1/manage/bookings`, `POST /bookings/{id}/assign-seats`, `/manage/bookings/{id}/move`, `/cancel`, `/notes`, `/refund` | [9.5](#95--đơn-đặt-ghế-đặt-hộ-xếp-chỗ) |
| Yêu cầu & hoàn tiền | `/v1/manage/requests`, `/manage/requests/{id}/approve`, `/reject`, `/manage/refunds`, `/manage/refunds/{id}/record` | [9.6](#96--yêu-cầu-hủy--đổi-và-hoàn-tiền) |
| Chuyến | `/v1/manage/trips` (+ ~25 thao tác), `/manage/series` | [9.7](#97--chuyến-tab-chuyến), [9.8](#98--chuyến-lặp-theo-lịch) |
| Gửi đồ | `/v1/manage/parcels` (+ accept, reject, status, handover, payment...) | [9.9](#99--gửi-đồ-quản-trị) |
| Nội dung | `/v1/manage/reviews`, `/manage/messages`, `/admin/reports`, `/admin/complaints`, `/admin/contact-messages`, `/admin/actions` | [9.10](#910--đánh-giá-báo-cáo-khiếu-nại-tin-nhắn) |
| Báo cáo | `GET /v1/manage/reports/{kind}`, `GET /manage/export` | [9.11](#911--đối-soát-và-báo-cáo) |
| Cấu hình | `/v1/admin/settings/{key}`, `/admin/operator`, `/admin/bank-info`, `/admin/cancel-policy`, `/admin/bank-info/preview-qr` | [9.12](#912--cấu-hình-nhà-xe) |
| Tài khoản | `/v1/admin/admins`, `/admin/customers`, `/admin/accounts/{id}/suspend` | [9.13](#913--quản-trị-viên-và-khách-hàng) |
| Công cụ | `/v1/admin/search`, `/admin/import/{type}`, `/admin/onboarding` | [9.14](#914--công-cụ) |
| Danh mục (CRUD) | văn phòng, khu vực trung chuyển, sơ đồ ghế, xe, bảo dưỡng, tuyến, nhân viên, lịch, tỉnh, khuyến mãi, giá mùa, tin, FAQ, việc trước giờ chạy, cước, loại hàng, khách không dùng app, chi phí chuyến | [10](#10--crud-danh-mục) |

---

## 1. Quy ước chung

### 1.1 Header
| Header | Khi nào | Ghi chú |
|---|---|---|
| `Authorization: Bearer <accessToken>` | Mọi endpoint 🔒 | Không đưa token vào URL, log hay tệp xuất |
| `Accept-Language: vi` hoặc `en` | Nên gửi ở mọi request | Ngôn ngữ của `message` lỗi, của chữ thông báo (`title`, `text`) và của email |
| `X-App-Version: 1.0.0` | Nên gửi ở mọi request | Cũ hơn `minAppVersion` → `426 upgrade_required` |
| `Content-Type: application/json` | Request có body JSON | Tải ảnh dùng `multipart/form-data` |
| `Idempotency-Key: <uuid>` | `POST /auth/register`, `POST /bookings`, `POST /parcels`, `POST .../proofs` | Sinh **một lần** cho mỗi thao tác, dùng lại khi thử lại sau mất mạng → không tạo đơn/ảnh trùng |

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
| 400 | `proof_invalid_file` | "Ảnh không hợp lệ, chỉ nhận JPG/PNG/WEBP" |
| 400 | `handover_invalid` | Mã nhận hàng sai, còn `attemptsLeft` lần |
| 401 | `unauthorized`, `token_expired`, `token_invalid` | Gọi `/auth/refresh` **một lần** rồi gửi lại request |
| 401 | `session_revoked`, `session_expired`, `refresh_invalid`, `refresh_reused` | Về màn hình đăng nhập, **giữ bản nháp đang nhập trong bộ nhớ** |
| 401 | `invalid_credentials` | "Email hoặc mật khẩu không đúng" |
| 403 | `forbidden` | Sai vai trò (khách gọi endpoint quản trị hoặc ngược lại) |
| 403 | `password_change_required` | Chỉ cho vào màn hình **đổi mật khẩu** (tài khoản quản trị mặc định / mật khẩu tạm) |
| 403 | `account_suspended` | "Tài khoản đang bị khóa" (có `reason` khi đăng nhập) |
| 403 | `wrong_password` | Mật khẩu xác nhận sai (đổi mật khẩu, đổi email, xóa tài khoản) |
| 404 | `not_found` | Bản ghi không còn, hoặc không phải của bạn |
| 409 | `email_taken`, `phone_taken`, `duplicate` | Thông báo tương ứng |
| 409 | `seat_taken` | "Ghế vừa có người giữ" — body có `takenSeats`, `freeSeats`: tải lại sơ đồ ghế |
| 409 | `seat_unavailable` | Ghế không bán / đang khóa |
| 409 | `trip_not_on_sale` | Chuyến hết hạn bán / chưa mở bán (`status` trong body) |
| 409 | `office_not_on_route`, `shuttle_unavailable`, `shuttle_deadline_passed` | Chọn lại văn phòng / khu vực; quá hạn trung chuyển → "liên hệ nhà xe" |
| 409 | `promo_invalid`, `promo_expired`, `promo_used_up`, `promo_min_amount` (`minAmount`), `points_insufficient` (`balance`) | Báo ở ô mã giảm giá / điểm |
| 409 | `bank_not_configured` | Nhà xe chưa cấu hình tài khoản nhận tiền: không cho đặt |
| 409 | `invalid_status` | Thao tác không hợp lệ ở trạng thái hiện tại: tải lại đơn |
| 409 | `cancel_not_allowed`, `change_not_allowed`, `pending_request_exists` | Thông báo tương ứng |
| 409 | `review_not_allowed`, `already_reviewed`, `waitlist_exists` | Thông báo tương ứng |
| 409 | `parcel_disabled`, `parcel_prohibited`, `parcel_too_heavy` (`maxWeightKg`), `parcel_no_rate`, `capacity_exceeded` (`capacity`, `load`), `handover_locked` | Thông báo tương ứng |
| 409 | `has_active_orders` | Không xóa được tài khoản khi còn chuyến chưa xong / hoàn tiền chờ |
| 409 | `has_dependents` | Không xóa được bản ghi vì còn liên kết; `blockedBy: [{resource, count}]` |
| 409 | `schedule_conflict` / `driver_unavailable` / `vehicle_inactive` / `seats_mismatch` / `trip_has_bookings` / `last_admin` | Xem phần quản trị |
| 413 | `proof_too_large` (`maxBytes`), `payload_too_large` | Nén ảnh nhỏ hơn |
| 426 | `upgrade_required` | Màn hình bắt buộc cập nhật (`minAppVersion`, `latestAppVersion`) |
| 429 | `too_many_attempts`, `rate_limited`, `upload_limit` | Chờ `Retry-After` giây (`retryAfter` trong body) |
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

### 2.2 `POST /v1/auth/register` → `201` (chỉ khách hàng)
```json
{ "email": "an@example.com", "password": "matkhau123", "displayName": "Nguyễn Văn An", "phone": "0901234567",
  "acceptTerms": true, "preferredLanguage": "vi", "referralCode": "U4MTLA", "deviceName": "Pixel 8", "deviceId": "<id cài đặt>" }
```
* `email*` (không phân biệt hoa thường), `password*` 8-72 byte có chữ và số, `displayName*` ≤60, `phone*` (server chuẩn hóa `+84 901 234 567` → `0901234567`; **mỗi SĐT chỉ một tài khoản** vì dùng để đăng nhập → trùng: `409 phone_taken`), `acceptTerms*` = `true`.
* `referralCode` tùy chọn (mã giới thiệu của bạn bè); sai → `400` `fields: [{field:"referralCode", code:"not_found"}]`.
* Gửi lại cùng `Idempotency-Key` + cùng email/mật khẩu → `200` với cùng tài khoản.

Phản hồi (dùng chung cho đăng ký và đăng nhập):
```json
{
  "account": {
    "id": "52be0ea0-…", "email": "an@example.com", "displayName": "Nguyễn Văn An", "phone": "0901234567",
    "role": "customer", "status": "active", "preferredLanguage": "vi", "mustChangePassword": false,
    "birthDate": null, "gender": null, "avatarColor": "#2E7D32", "initials": "VA", "referralCode": "U4MTLA",
    "createdAt": "2026-11-19T02:46:21Z"
  },
  "member": {
    "enabled": true, "points": 0, "lifetimeEarned": 0,
    "tier": { "name": "Thành viên", "minPoints": 0, "benefitText": "" },
    "nextTier": { "name": "Bạc", "minPoints": 300, "pointsNeeded": 300 },
    "redeemValuePerPoint": 500
  },
  "tokens": {
    "tokenType": "Bearer", "accessToken": "eyJ…", "accessTokenExpiresAt": "2026-11-19T04:46:21Z", "expiresIn": 7199,
    "refreshToken": "99bf….xxxx", "refreshTokenExpiresAt": "2026-11-19T05:46:21Z", "sessionExpiresAt": "2026-11-19T14:46:21Z",
    "deviceId": "99bfe355-…"
  }
}
```
* `member` chỉ có ở tài khoản khách hàng (thẻ điểm/hạng đầu Profile). Ảnh đại diện = `initials` trên nền `avatarColor` (không dùng ảnh).

### 2.3 `POST /v1/auth/login` → `200`
`{ "login": "an@example.com" | "0901234567", "password", "deviceName", "deviceId" }` → như 2.2 + `"mustChangePassword": true|false`.
* **`login` = email hoặc số điện thoại**, một ô nhập duy nhất ("Email hoặc số điện thoại"). Có `@` → email (không phân biệt hoa thường); không có → SĐT, server chuẩn hóa `+84 901 234 567`, `84901234567`, `0901.234.567` → `0901234567`. Sai định dạng → `400` `fields: [{field:"login", code:"invalid_format"}]`.
* Trường cũ `email` vẫn nhận (giá trị cũng có thể là SĐT), nhưng FE mới nên gửi `login`.
* **Cùng màn hình cho khách và quản trị viên.** `account.role` quyết định giao diện: `customer` → 4 tab khách; `admin` → 5 tab quản trị (vào thẳng Tổng quan).
* `mustChangePassword: true` (tài khoản quản trị mặc định tạo ở máy chủ, hoặc admin vừa được cấp mật khẩu tạm): chỉ hiện màn hình **đổi mật khẩu**; mọi endpoint khác trả `403 password_change_required` cho tới khi đổi (trừ `GET/PATCH /me`, `/devices`, `/auth/logout`).
* Sai → `401 invalid_credentials`. Sai 5 lần / 15 phút → `429 too_many_attempts`. Tài khoản bị khóa → `403 account_suspended` (`reason`).
* Đăng nhập lại từ cùng `deviceId` thay phiên cũ của máy đó.

### 2.4 `POST /v1/auth/refresh` → `200`
`{ "refreshToken" }` → `{ "tokens": {...} }`. Lỗi `401 refresh_invalid | refresh_reused | session_expired` → về đăng nhập.

### 2.5 `POST /v1/auth/logout` → `204`
`{ "refreshToken" }`, Bearer tùy chọn. Luôn `204`.

### 2.6 Quên / đặt lại mật khẩu
* `POST /v1/auth/forgot` `{ "login": "<email hoặc SĐT>" }` → **luôn `202`** `{ "status": "accepted" }` (không lộ email nào có tài khoản). Email chứa mã `ABCD-EFGH`, hạn 30 phút, dùng 1 lần; yêu cầu mã mới thì mã cũ hết hiệu lực; tối đa 3 mã/giờ/email hoặc SĐT. Nhập SĐT thì mã vẫn gửi tới **email của tài khoản** đó. Môi trường dev chưa có SMTP: phản hồi có thêm `devToken` để test (production không có).
* `POST /v1/auth/reset` `{ "token": "ABCD-EFGH", "newPassword" }` → `204`. `token` không phân biệt hoa thường, có hay không dấu gạch. Sai/hết hạn → `400 reset_invalid`. Thành công: **mọi thiết bị bị đăng xuất**, bỏ khóa sai mật khẩu, server gửi email "mật khẩu đã thay đổi".

Luồng: *Quên mật khẩu* (nhập email hoặc SĐT) → *Nhập mã + mật khẩu mới* (nút "Gửi lại mã" sau 60 giây) → *Đăng nhập* (điền sẵn email/SĐT vừa nhập).

### 2.7 🔒 Đổi mật khẩu
`POST /v1/auth/change-password` `{ "oldPassword", "newPassword" }` → `{ "status": "ok", "revokedSessions": 1, "account": {...} }`. Thiết bị hiện tại giữ phiên, thiết bị khác bị đăng xuất. Trùng mật khẩu cũ → `400 same_as_old`. Xóa cờ `mustChangePassword`.

### 2.8 🔒 Hồ sơ và xóa tài khoản
* `GET /v1/me` → `{ account, member?, mustChangePassword }`.
* `PATCH /v1/me` gửi trường muốn đổi: `displayName`, `phone`, `birthDate` (`yyyy-MM-dd`), `gender` (`male|female|other`), `avatarColor` (`#RRGGBB`), `preferredLanguage` (`vi|en`, lưu theo tài khoản), `email` (**kèm `password`**). SĐT đã thuộc tài khoản khác → `409 phone_taken`. Trả như `GET /me`.
* `DELETE /v1/me` `{ "password" }` → `204`.
  * Khách hàng: bị chặn `409 has_active_orders` (`activeBookings`, `activeParcels`, `pendingRefunds`) khi còn chuyến chưa hoàn thành, đơn gửi đồ đang xử lý hoặc hoàn tiền đang chờ. Xóa thật: tài khoản, dữ liệu lưu sẵn, **ảnh chứng từ**, tin nhắn, đánh giá, điểm, mã; đơn cũ chỉ còn số tiền (không tên/SĐT/địa chỉ).
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
| `GET /v1/banks` | `{ items: [{code, bin, shortName, name}] }` | Chọn ngân hàng (tài khoản hoàn tiền, cấu hình QR) |
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
| `onlyAvailable` | `true`: chỉ chuyến đang bán đủ ghế. Mặc định: chuyến đủ ghế + chuyến hết chỗ / chưa mở bán (để hiện "Đăng ký chờ") |
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
Như một phần tử ở 4.1 + `operator: {name, phone, rating, reviewCount, completedTrips}`, `cancelPolicy: {tiers:[{hoursBefore, refundPercent}], cancelFee, changeAllowedHoursBefore, changeFee, note}`, `rules: [{kind, text}]`, `childRule: {enabled, maxAge, discountPercent, note}`, `shuttleRule: {registerHoursBefore, feeRefundable, note, deadline}`, `seatRule: "first_receipt_wins"`.

### 4.3 `GET /v1/trips/{id}/seats` — sơ đồ ghế (34)
```json
{
  "tripId": "980c…", "status": "open",
  "layout": { "rows": 4, "cols": 3, "name": "Limousine 9 chỗ" },
  "seats": [
    { "seatId": "TX", "label": "TX", "row": 0, "col": 0, "seatClass": "standard", "seatClassName": "Ghế thường", "seatPrice": 250000, "surcharge": 0, "total": 250000, "state": "unsellable", "selectingCount": 0, "isMine": false },
    { "seatId": "A1", "label": "A1", "row": 0, "col": 1, "seatClass": "front", "seatClassName": "Hàng đầu", "seatPrice": 250000, "surcharge": 20000, "total": 270000, "state": "free", "selectingCount": 2, "isMine": false }
  ],
  "counts": { "free": 9, "claimed": 0, "sold": 0, "locked": 0 }
}
```
* Vẽ lưới `rows × cols`, mỗi ghế ở ô `(row, col)`; ô không có ghế là lối đi. `TX` (ghế tài xế) có `state: "unsellable"`.
* `state`: `free` (chọn được) · `claimed` (đã có người gửi chứng từ, chờ xác nhận — **không chọn được**) · `sold` · `locked` · `unsellable`. Nhãn ở [11.2](#112-trạng-thái-ghế-trên-sơ-đồ).
* `selectingCount` > 0 → hiện nhãn **"n người đang chọn"** (chỉ là gợi ý, không phải khóa). Không bao giờ có thông tin người đặt.
* `isMine: true` = ghế đơn của chính bạn đang giữ / đã mua.
* **Hiện quy tắc "chuyển khoản trước có chỗ trước" ngay ở màn hình chọn ghế** (35).

### 4.4 `GET /v1/trips/{id}/alternatives?seats=2` (44)
`{ items: [trip] }` — tối đa 6 chuyến cùng tuyến gần giờ nhất (±3 ngày) còn đủ ghế. Gọi khi chuyến hết chỗ hoặc khi bị lấy ghế.

### 4.5 👤 Danh sách chờ (45, 96)
* `POST /v1/trips/{id}/waitlist` `{ "seatCount": 2, "note": "" }` → `201 { id, tripId, seatCount, status: "waiting", position }`. Đã đăng ký → `409 waitlist_exists`.
* `GET /v1/me/waitlist` → `{ items: [{ id, tripId, seatCount, status, createdAt, trip }] }` · `DELETE /v1/me/waitlist/{id}` → `204`.
* Khi có ghế trống, người chờ đầu tiên nhận thông báo `waitlist_available`.

---

## 5. 🔒 Đặt ghế và thanh toán

> **Quy tắc cốt lõi (35):** tạo đơn **không giữ ghế**. Ghế thuộc về đơn **gửi ảnh chứng từ thành công sớm nhất theo giờ máy chủ**. Đơn gửi sau mà ghế đã có người gửi trước → trạng thái `seat_lost`, ảnh vẫn được lưu, khách chọn ghế khác / chuyến khác / hoàn tiền. App phải giải thích quy tắc **khi chọn ghế** và **ở màn hình thanh toán**, khuyến nghị gửi ảnh càng sớm càng tốt.

### 5.1 🔒 Báo giá / máy tính giá (40, 46)
`POST /v1/bookings/quote` — cùng bộ tính giá với đặt chỗ, **không lưu gì**. Hai cách gửi ghế:
```json
{ "tripId": "980c…", "seats": [{ "seatId": "B1" }, { "seatId": "B2", "isChild": true }],
  "pickupOfficeId": "0387…", "pickupShuttle": { "zoneId": "c308…", "addressText": "10 Xuân Thủy" }, "promoCode": "CHAOBAN", "usePoints": 20 }
```
hoặc (máy tính giá, chưa chọn ghế): `{ "tripId", "seatCount": 3, "childCount": 1, "seatClass": "standard", ... }`.
```json
{
  "tripId": "980c…",
  "lines": [{ "seatId": "B1", "label": "B1", "seatClass": "vip", "isChild": false, "seatPrice": 250000, "surcharge": 0, "childDiscount": 0, "lineAmount": 250000, "netAmount": 250000, "state": "free" }],
  "amounts": { "seatsAmount": 500000, "surchargeAmount": 0, "childDiscount": 0, "shuttleAmount": 30000, "subtotal": 530000, "promoDiscount": 0, "pointsDiscount": 0, "discountAmount": 0, "totalAmount": 530000, "seasonalApplied": [] },
  "promo": null, "pointsUsed": 0,
  "pickupShuttle": { "zoneName": "Cầu Giấy", "fee": 30000, "plannedAt": "2026-11-19T23:50:00Z", "plannedTime": "06:50" },
  "dropShuttle": null
}
```
* **Tổng tiền = giá ghế + phụ thu loại ghế − giảm trẻ em + phí trung chuyển − mã giảm − điểm.** Hiển thị từng dòng của `amounts`.
* `plannedTime` của trung chuyển đón = giờ xe tới văn phòng − `leadMinutes` của khu vực (38).
* Mã giảm giá sai → `409 promo_*` (có `fields[0].field = "promoCode"`).

### 5.2 👤 Tạo đơn (chưa giữ ghế)
`POST /v1/bookings` (+ `Idempotency-Key`) → `201` chi tiết đơn (5.3).
```json
{
  "tripId": "980c…",
  "seats": [
    { "seatId": "B1", "passengerName": "Nguyễn Văn An", "passengerPhone": "0901234567" },
    { "seatId": "B2", "passengerName": "Trần Thị Bình", "passengerPhone": "0907654321", "note": "Say xe", "isChild": false }
  ],
  "pickupOfficeId": "0387…", "dropOfficeId": "274a…",
  "pickupShuttle": { "zoneId": "c308…", "addressText": "10 Xuân Thủy, Cầu Giấy", "noteText": "Gọi trước 10 phút" },
  "dropShuttle": null,
  "promoCode": null, "usePoints": 0, "note": "Có 1 vali lớn"
}
```
* `seats*` 1-16 ghế, mỗi ghế `seatId*`, `passengerName*`, `passengerPhone*`, `note`, `isChild`. Chọn nhanh từ `/me/passengers`.
* `pickupOfficeId*` phải là văn phòng **lên xe** của tuyến, `dropOfficeId*` là văn phòng **xuống xe**.
* `pickupShuttle` / `dropShuttle` tùy chọn: khu vực phải thuộc văn phòng đã chọn, bật đúng chiều, trước hạn đăng ký (`shuttleRule.deadline`). Lấy từ `/me/addresses` để điền nhanh.
* Lỗi thường gặp: `409 seat_taken` (ghế đã có chứng từ / đã bán / khóa — kèm `freeSeats`), `trip_not_on_sale`, `office_not_on_route`, `shuttle_*`, `promo_*`, `bank_not_configured`.
* Đơn mới: `status = "awaiting_payment"`, `payDeadline` (mặc định 60 phút, cấu hình được), `payDeadlineSeconds` để chạy đồng hồ đếm ngược. **Ngay sau khi tạo đơn, mở màn hình "Gửi ảnh chuyển khoản trước" (47).**

### 5.3 🔒 Danh sách và chi tiết đơn
* `GET /v1/bookings?tab=to_pay|upcoming|past|cancelled&q=&month=yyyy-MM&cursor=` (70, 90). `q` tìm không dấu theo mã đơn, tên, SĐT hành khách, tên tuyến.

  | `tab` | Gồm |
  |---|---|
  | `to_pay` | `awaiting_payment`, `rejected`, `info_requested`, `seat_lost`, `expired` (chuyến chưa chạy) |
  | `upcoming` | `pending_review`, `confirmed` sắp đi |
  | `past` | `completed` (+ `confirmed` đã qua ngày) |
  | `cancelled` | `cancelled`, `expired` (chuyến đã qua) |

* `GET /v1/bookings/{id}` — cũng là **vé điện tử** (71) khi `status` = `confirmed`:
```json
{
  "id": "7166…", "code": "SR36X3HP", "status": "confirmed", "source": "app",
  "trip": {
    "id": "980c…", "departAt": "2026-11-20T00:30:00Z", "date": "2026-11-20", "departTime": "07:30", "tzOffset": "+07:00", "arriveAt": "…", "status": "scheduled",
    "route": { "id": "e45f…", "name": "Hà Nội → Thái Bình" }, "vehicle": { "kindLabel": "Limousine 9 chỗ", "plateNo": "29B-123.45" },
    "updates": [{ "kind": "delay", "text": "Tắc đường 15 phút", "delayMinutes": 15, "atTime": "…" }]
  },
  "pickupOffice": { "id": "0387…", "name": "VP Mỹ Đình", "address": "1 Mỹ Đình", "phone": "0241111111", "directionNote": "", "isActive": true, "arriveAt": "…", "arriveTime": "07:30" },
  "dropOffice": { "id": "274a…", "name": "VP TP Thái Bình", "…": "…", "arriveTime": "10:00" },
  "pickupShuttle": { "id": "d011…", "direction": "pickup", "officeId": "0387…", "zoneId": "c308…", "zoneName": "Cầu Giấy", "addressText": "10 Xuân Thủy, Cầu Giấy", "noteText": "Gọi trước 10 phút", "fee": 30000, "plannedAt": "2026-11-19T23:50:00Z", "plannedTime": "06:50", "status": "pending" },
  "dropShuttle": null,
  "seats": [{ "id": "6af3…", "seatId": "B1", "label": "B1", "seatClass": "vip", "passengerName": "Nguyễn Văn An", "passengerPhone": "0901234567", "note": "", "isChild": false, "seatPrice": 250000, "surcharge": 0, "childDiscount": 0, "netAmount": 250000, "claimState": "held", "boarding": "none" }],
  "lostSeats": [],
  "amounts": { "seatsAmount": 500000, "surchargeAmount": 0, "childDiscount": 0, "shuttleAmount": 30000, "subtotal": 530000, "promoDiscount": 0, "pointsDiscount": 0, "discountAmount": 0, "totalAmount": 530000, "seasonalApplied": [] },
  "totalAmount": 530000, "paidAmount": 530000, "refundedAmount": 0, "promoCode": null, "pointsUsed": 0, "note": "Có 1 vali lớn",
  "payDeadline": "2026-11-19T03:46:22Z", "payDeadlineSeconds": null,
  "proofSubmittedAt": "…", "confirmedAt": "…", "completedAt": null, "cancelledAt": null, "cancelReason": null,
  "proofs": [{ "id": "289f…", "status": "approved", "uploadedAt": "…", "reviewedAt": "…", "rejectReason": null, "note": "" }],
  "pendingRequest": null,
  "notices": [],
  "reviewed": false,
  "actions": { "uploadProof": false, "cancel": false, "requestCancel": true, "changeSeat": true, "changeTrip": true, "reselectSeats": false, "requestRefund": false, "editShuttle": true, "review": false, "chat": true },
  "createdAt": "…", "updatedAt": "…"
}
```
* **`actions` cho biết nút nào được hiện** — app không cần tự suy luận từ trạng thái:

  | `actions.*` | Nút |
  |---|---|
  | `uploadProof` | "Gửi ảnh chuyển khoản" / "Gửi lại" / "Gửi thêm ảnh" |
  | `cancel` | "Hủy đơn" (đơn chưa thanh toán, hủy ngay) |
  | `requestCancel` | "Yêu cầu hủy" (đã gửi chứng từ / đã xác nhận → nhà xe duyệt, xem phí hủy trước) |
  | `changeSeat`, `changeTrip` | "Đổi ghế", "Đổi chuyến / đổi ngày" |
  | `reselectSeats`, `requestRefund` | Khi bị lấy ghế: "Chọn ghế khác", "Yêu cầu hoàn tiền" (+ `changeTrip`) |
  | `editShuttle` | Sửa xe trung chuyển |
  | `review` | "Đánh giá chuyến" |
  | `chat` | Khung trao đổi với nhà xe |

* `seats[].claimState`: `selecting` (chưa giữ) · `held` (đang giữ / đã mua) · `lost` (bị người khác lấy trước). `boarding`: `none|boarded|absent`.
* `trip.vehicle.plateNo` chỉ có khi đơn đã xác nhận. `trip.updates` = báo trễ / sự cố nhà xe ghi (78).
* `notices` = cảnh báo như văn phòng đóng cửa: `[{ kind: "office_closed", officeId, at }]`.
* `pendingRequest` = yêu cầu đang chờ nhà xe duyệt (`{ id, type, status, createdAt }`).

* `GET /v1/bookings/{id}/history` (77) → `{ items: [{ id, at, kind, byRole, oldValue, newValue, note }] }`. `kind`: `created`, `seats_held`, `seat_lost`, `proof_added`, `proof_rejected`, `info_requested`, `confirmed`, `seat_changed`, `trip_changed`, `shuttle_changed`, `cancel_requested`, `change_seat_requested`, `change_trip_requested`, `refund_requested`, `request_approved`, `request_rejected`, `cancelled`, `refund_recorded`, `expired`, `completed`, `complaint`...
* `GET /v1/bookings/{id}/share-text?lang=` (79) → `{ text }` dạng chữ để chia sẻ sang Zalo (không chứa chứng từ).

### 5.4 👤 Thông tin chuyển khoản và mã QR
`GET /v1/bookings/{id}/payment-info` (48, 49):
```json
{
  "orderType": "booking", "orderId": "7166…", "code": "SR36X3HP", "status": "awaiting_payment",
  "bank": { "code": "VCB", "bin": "970436", "shortName": "Vietcombank", "name": "Ngân hàng TMCP Ngoại thương Việt Nam" },
  "accountNo": "0123456789", "holderName": "CONG TY TEST", "amount": 530000, "transferContent": "SR36X3HP",
  "qrPayload": "00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA530370454065300005802VN62120808SR36X3HP63049481",
  "payDeadline": "2026-11-19T03:46:22Z", "payDeadlineSeconds": 3600, "rule": "first_receipt_wins"
}
```
* **App chỉ vẽ `qrPayload` thành mã QR** (chuỗi VietQR đầy đủ, đã có số tiền, nội dung và mã kiểm tra) bằng thư viện mã hóa QR; app không quét mã.
* Luôn hiện kèm số tài khoản, chủ tài khoản, ngân hàng, số tiền, nội dung (= mã đơn), mỗi mục có nút sao chép; cảnh báo "chỉ chuyển theo thông tin trong đơn". Thông tin ngân hàng là **bản sao lúc tạo đơn**.
* Không dùng logo ngân hàng (chính sách Play). Hiện `shortName`.

### 5.5 👤 Gửi ảnh chứng từ
`POST /v1/bookings/{id}/proofs` — `multipart/form-data`: trường `file` (ảnh JPG/PNG/WEBP) + `note` (tùy chọn). Hoặc JSON `{ "image": "<base64>", "note": "" }`. **Gửi `Idempotency-Key`** (sinh một lần cho mỗi ảnh) để thử lại khi mất mạng không tạo ảnh trùng.

* App nén ảnh (≤ `maxProofBytes`, mặc định 3 MB) và xóa siêu dữ liệu trước khi gửi; server **kiểm tra lại** nội dung tệp, kích thước, xóa EXIF/GPS của JPEG.
* Gửi được khi `actions.uploadProof = true` (trạng thái `awaiting_payment`, `rejected`, `expired`, `info_requested`, `pending_review`, `seat_lost`; chuyến chưa chạy). **Quá hạn (`expired`) vẫn gửi được** nếu ghế còn trống.

Phản hồi `201`:
```json
{
  "proof": { "id": "289f…", "orderType": "booking", "orderId": "7166…", "orderCode": "SR36X3HP", "status": "pending", "amount": 530000, "note": "", "mime": "image/jpeg", "sizeBytes": 3012, "uploadedAt": "…", "reviewedAt": null, "rejectReason": null },
  "booking": { "…": "chi tiết đơn như 5.3, status = pending_review hoặc seat_lost" },
  "lostSeats": [],
  "seatLost": false
}
```
* `seatLost: false` → "Đã giữ ghế, chờ nhà xe xác nhận". `seatLost: true` → **màn hình "Ghế bị người khác lấy trước"** với `lostSeats` (ví dụ `["B1"]`) — xem 5.7.
* Lỗi: `413 proof_too_large` (`maxBytes`), `400 proof_invalid_file`, `429 upload_limit` (30 ảnh/giờ/tài khoản), `409 invalid_status`.
* Gửi bổ sung khi nhà xe yêu cầu (`info_requested`): cùng endpoint, đơn quay về `pending_review`.

### 5.6 Ảnh chứng từ (link ký có hạn)
* `GET /v1/proofs/{id}` (chủ đơn hoặc quản trị viên) → `{ ...proof, image: { url, expiresAt } | null, imageDeleted }`.
* `image.url` = `/v1/files/{fileId}?exp=…&sig=…`, **hết hạn sau 5 phút**, không cần header Bearer (dùng thẳng trong Coil/Glide). Nếu `url` bắt đầu bằng `/` thì ghép với Base URL. Hết hạn → gọi lại `GET /proofs/{id}` để lấy link mới.
* `imageDeleted: true` khi ảnh đã tự xóa theo thời gian lưu giữ (mặc định 90 ngày, `proofRetentionDays`).
* Ảnh **không có đường dẫn cố định**: server lưu ảnh riêng tư (collection `files`) và mỗi lần đọc API sinh một link ký mới. FE **không lưu `url` lâu dài** (vào DB máy, cache theo URL); cache ảnh theo `proof.id` nếu cần.

Nơi có ảnh:

| Màn hình | API | Trường ảnh |
|---|---|---|
| 🛠 Hàng chờ duyệt | `GET /v1/manage/proofs?status=pending` | `items[].image.url` |
| 🛠 Lịch sử chứng từ (đã duyệt / bị từ chối) | `GET /v1/manage/proofs?status=approved` hoặc `rejected` (lọc `orderType`, `tripId`, `date`) | `items[].image.url` |
| Xem ảnh phóng to (khách & admin) | `GET /v1/proofs/{id}` | `image.url` |
| Chi tiết đơn (`GET /bookings/{id}`, `/parcels/{id}`) | `proofs[]` chỉ có `id`, `status`, `uploadedAt`... **không có link** | bấm vào → `GET /v1/proofs/{id}` |

### 5.7 👤 Khi ghế bị người khác lấy trước
Trạng thái `seat_lost` (55). Ba lựa chọn hiện rõ:
1. **Chọn ghế khác cùng chuyến:** `POST /v1/bookings/{id}/reselect-seats` `{ "seats": [{ "bookingSeatId": "<seats[].id>", "seatId": "C1" }] }` → ghế mới được **giữ ngay** (chứng từ đã có) → `pending_review`. Ghế vừa bị lấy → `409 seat_taken` + `freeSeats`.
2. **Chuyển chuyến khác:** `POST /bookings/{id}/requests` `{ type: "change_trip", tripId }` (5.10).
3. **Yêu cầu hoàn tiền:** `POST /bookings/{id}/requests` `{ type: "refund" }` → nhà xe duyệt rồi chuyển hoàn ngoài app.

Tiền đã chuyển không mất: ảnh được giữ, nhà xe thấy đơn trong mục "đơn mất ghế".

### 5.8 👤 Hủy đơn
* `GET /v1/bookings/{id}/cancel-preview` (73):
```json
{ "bookingId": "7166…", "status": "confirmed", "immediate": false, "paidAmount": 530000, "hoursBefore": 21.7,
  "tier": { "hoursBefore": 4, "refundPercent": 50 }, "refundPercent": 50, "shuttleRefund": 30000, "cancelFee": 0, "refundAmount": 280000,
  "policy": [{ "hoursBefore": 24, "refundPercent": 90 }, { "hoursBefore": 4, "refundPercent": 50 }, { "hoursBefore": 0, "refundPercent": 0 }] }
```
  Số hoàn = (đã trả − phí trung chuyển) × % mốc + phí trung chuyển (nếu được hoàn) − phí hủy, ≥ 0. Mốc theo **giờ hủy so với giờ khởi hành**, chính sách **lúc đặt**.
* `POST /v1/bookings/{id}/cancel` `{ "note" }` (72):
  * `immediate: true` (chưa thanh toán) → `{ "status": "cancelled", "booking" }`.
  * Đã gửi chứng từ / đã xác nhận → `{ "status": "requested", "request": {...}, "booking" }` — chờ nhà xe duyệt; khi duyệt, khoản hoàn vào hàng đợi, nhà xe chuyển hoàn rồi ghi nhận (thông báo `refund_recorded`).

### 5.9 🔒 Sửa xe trung chuyển
`PATCH /v1/bookings/{id}/shuttle` `{ "pickupShuttle": { "zoneId", "addressText", "noteText" } | null, "dropShuttle": … }` (76). Trước hạn đăng ký. Đổi địa chỉ/ghi chú lúc nào cũng được (trước hạn); **đổi khu vực hoặc bỏ trung chuyển làm thay đổi tiền chỉ được khi đơn chưa thanh toán**, nếu không → `409 invalid_status` `hint: "contact_operator"`. Quá hạn → `409 shuttle_deadline_passed`.

### 5.10 👤 Yêu cầu đổi ghế, đổi chuyến, hoàn tiền
`POST /v1/bookings/{id}/requests` → `201 { "request": {...} }`
| `type` | Body | Điều kiện |
|---|---|---|
| `change_seat` | `seats: [{ bookingSeatId, seatId }]` | `pending_review`/`confirmed`, ghế mới đang trống, trước `changeAllowedHoursBefore` |
| `change_trip` | `tripId` (cùng tuyến), `seats?` | Như trên (cả `seat_lost`). `request.priceDiff` = chênh lệch giá (+ phí đổi): > 0 khách bù, < 0 nhà xe hoàn |
| `refund` | — | Chỉ `seat_lost` |
| `cancel` | `note` | Như `POST /cancel` |

`request` = `{ id, orderId, orderCode, type, status: pending|approved|rejected|withdrawn, payload, priceDiff, refundPreview, note, decisionNote, decidedAt, createdAt }`. Mỗi đơn chỉ một yêu cầu chờ (`409 pending_request_exists`). Rút yêu cầu: `DELETE /v1/me/requests/{id}`.

### 5.11 🔒 Trao đổi trong đơn
* `GET /v1/bookings/{id}/messages` → `{ items: [{ id, bookingId, senderRole: customer|admin, isMine, text, status, readAt, at }] }` (đánh dấu đã đọc tin của phía kia).
* `POST /v1/bookings/{id}/messages` `{ "text" }` → `201`. Chỉ chữ, không ảnh. Tin bị ẩn do vi phạm có `status: "hidden"`, `text: ""`.
* Báo cáo tin nhắn: `POST /v1/reports` `{ targetType: "message", targetId, reason }`.

### 5.12 Đặt lại nhanh
`GET /v1/bookings/{id}/rebook` → `{ fromProvinceId, toProvinceId, routeId, pickupOfficeId, dropOfficeId, seatCount, passengers: [{passengerName, passengerPhone, isChild, note}], pickupShuttle, dropShuttle }` để điền sẵn tab Đặt chuyến (12, 90).

---

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
  "id": "62d8…", "code": "GD9VHD3W", "status": "accepted", "payStatus": "unpaid", "payMethod": null, "source": "app",
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
  "proofs": [], "handoverLocked": false,
  "actions": { "uploadProof": true, "cancel": true, "regenerateCode": true, "reportIssue": true },
  "createdAt": "…", "updatedAt": "…"
}
```
* `timeline` vẽ thanh mốc (64). `fee` là cước chốt; khác `estimate.total` thì hiện `feeAdjustReason`.

### 6.5 👤 Thanh toán cước (62)
* Khi `status` = `accepted`/`received` và `payStatus = unpaid`: `GET /v1/parcels/{id}/payment-info` (như 5.4, thêm `cashAtOffice: true`) → QR + số tài khoản, hoặc trả **tiền mặt tại văn phòng** (nhà xe ghi nhận).
* `POST /v1/parcels/{id}/proofs` (như 5.5) → `payStatus = pending_review` → nhà xe xác nhận → `paid`. Không có ghi nợ, không thu hộ (COD).

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
| `order` (đơn, thanh toán) | `booking_confirmed`, `proof_rejected`, `proof_info_requested`, `seat_lost`, `seat_changed`, `booking_moved`, `booking_cancelled`, `booking_expired`, `request_approved`, `request_rejected`, `refund_pending`, `refund_recorded`, `booking_linked`, `message_new`, `review_reply`, `complaint_update`, `points_earned`, `points_reverted` |
| `trip` | `trip_time_changed`, `trip_delay`, `trip_incident`, `trip_cancelled`, `trip_notice`, `trip_reminder`, `vehicle_changed`, `office_closed`, `shuttle_changed`, `waitlist_available` |
| `parcel` | `parcel_accepted`, `parcel_rejected`, `parcel_paid`, `parcel_proof_rejected`, `parcel_received`, `parcel_loaded`, `parcel_arrived`, `parcel_delivered`, `parcel_issue`, `parcel_unclaimed`, `parcel_cancelled`, `parcel_fee_adjusted`, `proof_info_requested`, `refund_recorded`, `complaint_update` |
| `promo` | `announcement` (tin khuyến mãi), `voucher_received`, `referral_rewarded` |
| `system` | `announcement`, `account_warning`, `content_hidden`, `contact_reply` |

Cài đặt hiện nhóm (104): `PUT /v1/me/preferences` `{ notifyPromo, notifyNews }` (thông báo đơn và chuyến luôn bật).

---

## 8. 🔒 Home và Profile (khách hàng)

### 8.1 👤 `GET /v1/home`
Một lần gọi cho cả tab Home (9-19):
```json
{
  "greeting": { "displayName": "Nguyễn Văn An" },
  "operator": { "name": "Nhà xe Test", "phone": "0241234567" },
  "upcomingTrip": { "…": "chi tiết đơn như 5.3", "countdownSeconds": 78480 },
  "todo": [
    { "kind": "upload_proof", "bookingId": "…", "code": "SR…", "status": "awaiting_payment", "deadline": "…", "deadlineSeconds": 3400, "trip": {…}, "totalAmount": 530000, "lostSeats": [] },
    { "kind": "parcel_payment", "parcelId": "…", "code": "GD…", "fee": 45000 }
  ],
  "shortcuts": {
    "recentRoutes": [{ "fromProvinceId", "fromProvinceName", "toProvinceId", "toProvinceName", "pickupOfficeId", "dropOfficeId" }],
    "favoriteRoutes": [{ "id", "label", "fromProvinceId", "fromProvinceName", "toProvinceId", "toProvinceName" }],
    "rebookBookingId": "…"
  },
  "services": [{ "key": "parcel", "enabled": true }],
  "activeParcels": [{ "id", "code", "status", "payStatus", "receiverName", "toOffice", "trip" }],
  "promotions": [{ "id", "code", "title", "description", "kind": "percent", "value": 10, "maxDiscount", "minAmount", "startAt", "endAt", "routeId", "audience", "remaining" }],
  "announcements": [{ "id", "title", "body", "kind", "createdAt" }],
  "toReview": [{ "bookingId", "code", "trip" }],
  "suggestions": [ "trip như 4.1 (chuyến sắp chạy trên tuyến hay đi, nhiều ghế)" ],
  "unread": { "total": 2, "byCategory": {…} },
  "serverTime": "2026-11-19T02:46:22Z"
}
```
`todo.kind`: `upload_proof` (nổi bật nút **Gửi ảnh chuyển khoản**), `resubmit_proof`, `info_requested`, `seat_lost`, `parcel_payment`, `parcel_unclaimed` (hàng tới nơi chưa ai nhận, 69). Hiện "cập nhật lúc `serverTime`" (19).

### 8.2 👤 Dữ liệu lưu sẵn
CRUD chuẩn (bảng trường ở [mục 10](#10--crud-danh-mục)): `/v1/me/passengers` (83), `/v1/me/addresses` (84), `/v1/me/receivers` (86), `/v1/me/favorites` (87, `kind: route` cần `fromProvinceId`+`toProvinceId`, `kind: office` cần `officeId`).

Một bản ghi duy nhất — `GET` / `PUT` (/ `DELETE`):
| Đường dẫn | Body `PUT` |
|---|---|
| `/v1/me/preferences` (85, 103, 104) | `{ defaultPickupOfficeId, defaultDropOfficeId, seatPref: any\|front\|window\|aisle\|back, shuttleDefault, fontScale: small\|medium\|large, theme: system\|light\|dark, notifyPromo, notifyNews }` (gửi phần muốn đổi) |
| `/v1/me/refund-account` (88) | `{ holderName*, accountNo*, bankName*, bankCode }` — chỉ quản trị viên xem khi hoàn tiền |
| `/v1/me/emergency` (89) | `{ name*, phone*, relation }` — quản trị viên thấy trong danh sách khách của chuyến |

### 8.3 👤 Điểm, hạng, ví mã, giới thiệu, thống kê
* `GET /v1/me/loyalty` (92) → `{ enabled, points, lifetimeEarned, tier, nextTier, redeemValuePerPoint, rules: {earnPointsPer10k, redeemValuePerPoint, maxRedeemPercent}, tiers: [...], entries: { items: [{ id, points, reason: trip|redeem|redeem_refund|cancel_reversal, refType, refId, at }], nextCursor, total } }`. Dùng điểm khi đặt: `usePoints` ở 5.1/5.2.
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
* `GET /v1/me/data` (111) → `{ account, hasRefundAccount, hasEmergencyContact, counts: {bookings, parcels, receiptPhotos, savedPassengers, savedAddresses, savedReceivers, reviews, messages, notifications}, retention: { receiptPhotoDays: 90, rule: "days_after_trip_completed" }, deletion: { inApp, web } }`.
* `GET /v1/me/export` (110) → tệp **CSV** (UTF-8 BOM, mở được bằng Excel), `Content-Disposition: attachment`. App lưu qua trình chọn tệp hệ thống (`ACTION_CREATE_DOCUMENT`).
* Xóa tài khoản: 2.8.

### 8.6 🔒 Đánh giá, báo cáo, khiếu nại, liên hệ
* 👤 `POST /v1/reviews` `{ bookingId*, stars* 1-5, text }` → `201` (chỉ đơn `completed`, mỗi đơn 1 đánh giá). `PATCH /v1/reviews/{id}` `{ stars, text }`, `DELETE /v1/reviews/{id}`.
* 🔒 `POST /v1/reports` `{ targetType*: review|message, targetId*, reason*: spam|offensive|false_info|personal_data|other, text }` → `201` (100).
* 👤 `POST /v1/complaints` `{ orderType*: booking|parcel, orderId*, category, text* }` → `201` (101). `GET /v1/complaints/{id}`, `POST /v1/complaints/{id}/replies` `{ text }` (bổ sung). Complaint = `{ id, orderType, orderId, orderCode, category, text, status: open|in_progress|resolved, replies: [{byRole, text, at}], resolution, resolvedAt, createdAt }`.
* 👤 `POST /v1/contact` `{ subject, text* }` → `201` (108). Gọi điện: mở trình quay số với `operator.profile.phone` (`ACTION_DIAL`).

---

## 9. 🛠 Quản trị viên

Mọi đường dẫn `/v1/manage/*`, `/v1/admin/*` và các thao tác duyệt (`/proofs/{id}/approve`...) chỉ dành cho `role = admin`; khách hàng gọi → `403 forbidden`. Các endpoint đọc chung (`/bookings`, `/parcels`, `/trips/{id}/seats`...) khi gọi bằng token admin trả **dữ liệu đầy đủ** (thêm khách hàng, ghi chú nội bộ, thông tin người đặt ghế).

### 9.1 Khởi đầu (114-117)
1. Tài khoản quản trị mặc định tạo ở máy chủ (`npm run db:init`, mật khẩu ngẫu nhiên in một lần). Đăng nhập → `mustChangePassword: true` → màn hình đổi mật khẩu bắt buộc.
2. `GET /v1/admin/onboarding` → `{ steps: [{ key, done }], completed, total }` — `key`: `change_password`, `operator_profile`, `bank_info`, `offices`, `vehicles`, `drivers`, `routes`, `first_trip`, `cancel_policy`. Đánh dấu tay: `POST /v1/admin/onboarding/{key}` `{ done: true }`.

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
  "recentBookings": [{ "id", "code", "status", "source", "totalAmount", "trip", "createdAt" }],
  "longestWaiting": [{ "proofId", "orderType", "orderId", "orderCode", "amount", "uploadedAt", "waitingMinutes" }],
  "topRoutes": [{ "routeId", "name", "seats", "bookings", "revenue" }],
  "topHours": [{ "hour": 7, "seats": 12 }],
  "alerts": [{ "kind": "vehicle_doc|maintenance_due|license_expiring|low_fill|trip_unassigned", "severity": "high|medium|low", "…": "…" }],
  "updatedAt": "…"
}
```
* Doanh thu = tiền đã ghi nhận (chứng từ đã xác nhận + tiền mặt + chuyển khoản trực tiếp) − hoàn tiền đã ghi nhận, theo giờ nhà xe; **ghế miễn phí không tính**. `changePercent` so với kỳ trước cùng độ dài (`null` khi kỳ trước = 0).
* Bấm thẻ "Cần xác nhận" → tab Cần xác nhận đúng mục (dùng `inbox` keys).

### 9.3 🛠 Cần xác nhận: hàng đợi và lịch
* `GET /v1/manage/inbox/counts` → `{ proofs, proofsBooking, proofsParcel, cancelRequests, changeRequests, refundRequests, lostSeat, refunds, parcels, reports, complaints, messages, contacts, total, oldestProofWaitingMinutes }` (cùng nguồn với thẻ Tổng quan).
* `GET /v1/manage/inbox?type=…` (một cửa vào cho tab):

  | `type` | Danh sách | Thao tác |
  |---|---|---|
  | `proof` | Chứng từ chờ, **ai gửi trước ở trên** (9.4) | duyệt / từ chối / yêu cầu bổ sung |
  | `cancel` | Yêu cầu hủy | `POST /manage/requests/{id}/approve\|reject` |
  | `change` | Yêu cầu đổi ghế / đổi chuyến | như trên |
  | `refund_request` | Khách mất ghế xin hoàn | như trên |
  | `lostseat` | Đơn `seat_lost` | xếp ghế khác (9.5), chuyển chuyến, hủy + hoàn |
  | `refund` | Khoản hoàn chờ chuyển | `POST /manage/refunds/{id}/record` |
  | `parcel` | Yêu cầu gửi đồ chờ | accept / reject (9.9) |
  | `report`, `complaint`, `message`, `contact` | 9.10 | |

* `GET /v1/manage/calendar?from=&to=` (mặc định tuần này) → `{ from, to, days: [{ date, trips, proofs, requests, lostSeat, parcels, toConfirm }] }` (141).

### 9.4 🛠 Xử lý chứng từ
* `GET /v1/manage/proofs?status=pending|approved|rejected&orderType=booking|parcel&tripId=&date=` (140):
```json
{ "items": [{
    "id": "289f…", "orderType": "booking", "orderId": "7166…", "orderCode": "SR36X3HP", "status": "pending", "amount": 530000, "note": "",
    "mime": "image/jpeg", "sizeBytes": 3012, "uploadedAt": "…", "accountId": "…", "tripId": "…", "departAt": "…",
    "waitingMinutes": 12, "deadlineAt": "…", "overdue": false,
    "duplicateOf": [{ "proofId", "orderType", "orderId", "orderCode": "SR7K3M9Q", "uploadedAt", "sameCustomer": false }],
    "customer": { "displayName": "Nguyễn Văn An", "phone": "0901234567" },
    "order": { "code": "SR36X3HP", "status": "pending_review", "totalAmount": 530000, "seats": [{ "label": "B1", "claimState": "held" }], "departAt": "…" },
    "image": { "url": "/v1/files/…?exp=…&sig=…", "expiresAt": "…" }
  }], "nextCursor": null, "total": 1 }
```
* Màn hình **lịch sử chứng từ** dùng cùng endpoint với `status=approved|rejected` (mới nhất trên). Ảnh nằm ở `image.url` (link ký 5 phút, xem 5.6): hết hạn thì tải lại trang hoặc gọi `GET /proofs/{id}`.
* `duplicateOf` không rỗng → **cảnh báo "nghi trùng chứng từ"** (146), chỉ là cảnh báo.
* `POST /v1/proofs/{id}/approve` `{ note? }` → đơn `confirmed`, ghế `sold` (đơn gửi đồ → `paid`). Chỉ duyệt được khi đơn `pending_review`/`info_requested`; đơn `seat_lost` phải xếp ghế trước (`409 invalid_status`).
* `POST /v1/proofs/{id}/reject` `{ reason* }` → ghế được **nhả** cho đơn kế tiếp, đơn `rejected` (khách gửi lại được).
* `POST /v1/proofs/{id}/request-info` `{ note* }` → đơn `info_requested`, ghế vẫn giữ.
* `POST /v1/manage/proofs/approve` `{ ids: [...] }` → `{ results: [{ id, ok, code? }], approved }` (144, sau màn hình xác nhận lại).
* `GET /v1/proofs/{id}` → ảnh phóng to (link ký).

### 9.5 🛠 Đơn đặt ghế, đặt hộ, xếp chỗ
* `GET /v1/manage/bookings?status=&tripId=&source=app|admin&customerAccountId=&guestContactId=&routeId=&from=&to=&q=` — như `GET /bookings` nhưng toàn bộ, mỗi đơn có thêm `customer: {id, displayName, phone, email, refundAccount, emergencyContact}`, `guest: {id, name, phone}`, `payMethod`, `compReason`, `internalNotes`, `bankSnapshot`, `cancelPolicySnapshot`.
* **Đặt ghế hộ** `POST /v1/manage/bookings` (131-134) → `201` đơn `confirmed` + `shareText`:
```json
{
  "tripId": "…", "pickupOfficeId": "…", "dropOfficeId": "…",
  "seats": [{ "seatId": "C2", "passengerName": "Bà Lan", "passengerPhone": "0988777666" }],
  "guest": { "name": "Bà Lan", "phone": "0988777666", "note": "" },
  "payMethod": "cash", "specialPrice": null, "compReason": null, "paymentNote": "", "pickupShuttle": null, "note": ""
}
```
  * `guest` (khách không dùng app) **hoặc** `customerAccountId`. `payMethod*`: `cash` | `transfer` | `free`. `free` hoặc `specialPrice` (giá riêng mỗi ghế) **bắt buộc `compReason`**. Không có "chưa thu".
  * Ghế đang có chứng từ của đơn khác → `409 seat_taken` `{ takenSeats, takenState: "claimed", freeSeats }` — **không bao giờ lấy ghế của người đã gửi chứng từ**.
  * Gõ SĐT ở quầy: `GET /v1/admin/guests/lookup?phone=` → `{ guest: {id, name, phone, note, linkedAccountId, recentBookings}, accounts: [{id, displayName, email, phone}] }` (135).
  * Khách đăng ký sau: `POST /v1/admin/guests/{id}/link` `{ accountId }` → `{ linkedBookings, linkedParcels }` (136).
* **Xếp / đổi ghế** `POST /v1/bookings/{id}/assign-seats` (hoặc `/manage/bookings/{id}/assign-seats`) `{ "assignments": [{ "bookingSeatId", "seatId" }], "reason" }` (169, 170) — chỉ sang ghế trống; khách nhận thông báo.
* **Chuyển chuyến** `POST /v1/manage/bookings/{id}/move` `{ tripId*, seats?: [{bookingSeatId, seatId}], reason }` (cùng tuyến; giữ số ghế nếu trống).
* **Hủy** `POST /v1/manage/bookings/{id}/cancel` `{ reason, note, refundAmount? }` → `{ refundAmount, preview, booking }`.
* **Ghi chú nội bộ** `POST /v1/manage/bookings/{id}/notes` `{ text }` → `201 { id, text, byAccountId, byName, at }` (154, khách không thấy).
* **Ghi nhận hoàn** `POST /v1/bookings/{id}/refund` `{ amount*, note }` (149).
* Lịch sử xử lý: `GET /v1/bookings/{id}/history` (admin thấy cả `byName`, mục `internal`).

### 9.6 🛠 Yêu cầu hủy / đổi và hoàn tiền
* `GET /v1/manage/requests?status=pending&type=cancel|change_seat,change_trip|refund&bookingId=` (cũ nhất trước).
* `POST /v1/manage/requests/{id}/approve` `{ note, refundAmount? }` → `{ request, booking, refundAmount? }`. Hủy: số hoàn mặc định = `refundPreview.refundAmount` lúc khách yêu cầu (sửa được bằng `refundAmount`). Đổi chuyến có `priceDiff < 0` → tạo khoản hoàn chờ.
* `POST /v1/manage/requests/{id}/reject` `{ note }`.
* `GET /v1/manage/refunds?status=pending|recorded&orderType=` → `[{ id, orderType, orderId, orderCode, accountId, amount, reason: cancel|seat_lost|trip_cancelled|change_diff|parcel_cancel|compensation|manual|customer, status, refundAccount, customer, note, recordedAt, createdAt }]`.
* `POST /v1/manage/refunds/{id}/record` `{ amount?, note }` — nhà xe đã chuyển hoàn ngoài app (**app không chuyển tiền**).

### 9.7 🛠 Chuyến (tab Chuyến)
| Method | Đường dẫn | Body / ghi chú |
|---|---|---|
| GET | `/v1/manage/trips?from=&to=&routeId=&vehicleId=&driverId=&tripStatus=&needs=vehicle\|driver` | Lịch theo ngày/tuần (157). Mỗi chuyến có `tripStatus`, `vehicle {id, plateNo...}`, `driver {id, name, phone}`, `seats {total, free, claimed, sold, locked}`, `fillPercent`, `needsVehicle`, `needsDriver`, `warnings: ["vehicle_conflict", "driver_conflict"]`, `parcelLoad`, `checklistDone/Total`... |
| POST | `/v1/manage/trips` | `{ routeId*, date*, departTime*, vehicleId (hoặc layoutId), driverId, basePrice, prices: [{seatClass, price}], salesOpenAt, salesCloseAt, parcelCapacity: {maxKg, maxPieces}, driverPay, note, force, overrideReason }` (158, 160, 162) |
| GET | `/v1/manage/trips/{id}` | Chi tiết + `checklist`, `shuttleDuties`, `logs`, `expenses {items, total, driverPay}`, `bookingsByStatus`, `waitlistCount` |
| PATCH | `/v1/manage/trips/{id}` | `{ date, departTime, basePrice, prices, salesOpenAt, salesCloseAt, salesClosed, parcelCapacity, driverPay, note, force, overrideReason }`. Đổi giờ → báo khách. Đổi giá chỉ áp đơn mới (161) |
| DELETE | `/v1/manage/trips/{id}` | Chỉ khi chưa có đơn nào (`409 trip_has_bookings`) |
| PUT | `/v1/manage/trips/{id}/driver` | `{ driverId, force?, overrideReason? }` (200) |
| PUT | `/v1/manage/trips/{id}/vehicle` | `{ vehicleId, force?, overrideReason? }` (166). Sơ đồ mới thiếu ghế đã bán → `409 seats_mismatch` `{ missingSeats }` |
| POST | `/v1/manage/trips/{id}/status` | `{ status: scheduled\|running\|completed }`. `completed` → đơn xác nhận thành `completed`, cộng điểm |
| POST | `/v1/manage/trips/{id}/cancel` | `{ reason*, moveToTripId? }` → hủy mọi đơn, hoàn tiền chờ, báo khách (164) |
| POST | `/v1/manage/trips/{id}/move-passengers` | `{ toTripId*, bookingIds?, reason }` → `{ moved: [codes], failed: [{code, error}] }` (165) |
| GET | `/v1/manage/trips/{id}/seats` | Sơ đồ ghế + `booking {id, code, status, source, passengerName, passengerPhone}`, `lockReason`, `claimedAt`, `selectingCount` mỗi ghế (168) |
| POST | `/v1/manage/trips/{id}/seats/{seatId}/lock` · `/unlock` | `{ reason* }` (171) |
| GET | `/v1/manage/trips/{id}/manifest` | `{ total, boarded, absent, items: [{ bookingId, bookingCode, bookingSeatId, seatLabel, passengerName, passengerPhone, isChild, note, pickupOffice, dropOffice, pickupShuttle, dropShuttle, boarding, emergencyContact }] }` — không email, không chứng từ (173) |
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
| GET | `/v1/manage/parcels?status=&payStatus=&tripId=&routeId=&date=&q=` | |
| POST | `/v1/manage/parcels` | Nhận hàng tại quầy (139): như 6.3 + `sender*`, `tripId`, `payMethod*: cash\|transfer`, `fee`, `feeAdjustReason` → `201` + `handoverCode`, `shareText` |
| POST | `/v1/manage/parcels/{id}/accept` | `{ tripId*, actualWeightKg, fee, feeAdjustReason }` — cước khác ước tính **bắt buộc lý do**; vượt tải → `409 capacity_exceeded` (152, 222) |
| POST | `/v1/manage/parcels/{id}/reject` | `{ reason* }` |
| POST | `/v1/manage/parcels/{id}/status` | `{ status*: received\|loaded\|arrived, note, actualWeightKg, fee, feeAdjustReason, cashAmount }` — `received` có thể ghi tiền mặt (`cashAmount`); `loaded` cần đã thanh toán (182) |
| POST | `/v1/manage/parcels/{id}/payment` | `{ method*: cash\|transfer, amount, note }` |
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

### 9.11 🛠 Đối soát và báo cáo
`GET /v1/manage/reports/{kind}?from=yyyy-MM-dd&to=yyyy-MM-dd` (mặc định 30 ngày; số liệu **theo ghi nhận trong app**, đối chiếu thêm với sao kê):
| `kind` | Tham số thêm | Nội dung |
|---|---|---|
| `reconciliation` | `routeId` | Theo chuyến: `byProof`, `byCash`, `byTransfer`, `parcelRevenue`, `refunded`, `refundPending`, `pendingProofAmount`, `comps`, `net` + `totals` (240) |
| `profit` | `groupBy=trip\|route\|vehicle` | `revenue`, `refunded`, `expenses`, `grossProfit`, `seatsSold`, `averageTicket`, `breakEvenSeats` (241, 242, 253) |
| `occupancy` | `groupBy=trip\|route\|hour` | `seats`, `sold`, `fillPercent` (243) |
| `revenue` | `groupBy=day\|week\|month` | `app`, `admin`, `booking`, `parcel`, `refunds`, `net` theo kỳ + `totals` (244) |
| `top` | | `routes`, `hours` bán chạy (245) |
| `rates` | | `cancelRate`, `proofRejectRate`, `seatLostRate`, `reviewTime {averageMinutes, maxMinutes}` (246, 247) |
| `parcels` | | Theo tuyến, tháng + `averageLoadPerTrip` (248) |
| `comps` | | Ghế tặng / giá đặc biệt theo tháng, lý do (249) |
| `shuttle` | | Theo khu vực: `pickups`, `drops`, `absent`, `revenue` (250) |
| `forecast` | `routeId` | `enough`, `weekdayAverage`, `items: [{date, expectedSeats, holiday}]` — không dự báo khi < 4 tuần dữ liệu (252) |

Xuất tệp: `GET /v1/manage/export?type=bookings|trips|reconciliation|parcels&from=&to=` → **CSV** (UTF-8 BOM, mở bằng Excel) (251, 263).

### 9.12 🛠 Cấu hình nhà xe
`GET /v1/admin/settings` (tất cả) · `GET /v1/admin/settings/{key}` · `PUT|PATCH /v1/admin/settings/{key}` (gửi phần muốn đổi). Alias theo spec: `PUT /v1/admin/operator`, `/admin/bank-info`, `/admin/cancel-policy`.

| `key` | Trường |
|---|---|
| `operator` (203) | `name, description, phone, email, address, openText, representativeName, licenseNoText, website` |
| `bank` (204) | `bankCode` (từ `/banks`), `accountNo`, `holderName` (tự viết hoa). Xem trước QR: `GET /v1/admin/bank-info/preview-qr?amount=10000&content=SRTEST` |
| `cancelPolicy` (205) | `tiers: [{hoursBefore, refundPercent}]`, `cancelFee`, `changeAllowedHoursBefore`, `changeFee`, `note` |
| `rules` (206) | `items: [{ kind: luggage\|food\|pets\|children\|other, text }]` |
| `system` (255) | `payDeadlineMinutes` (5-1440), `reviewDeadlineMinutes`, `maxProofBytes`, `proofRetentionDays`, `driverRestMinutes`, `salesOpenDaysBefore`, `salesCloseMinutesBefore`, `lowFillPercent` |
| `shuttle` (214) | `registerHoursBefore`, `feeRefundable`, `note` |
| `seatClasses` (187) | `items: [{ code (a-z0-9_), name, surcharge }]` — bắt buộc có `standard` |
| `child` (229) | `enabled`, `maxAge`, `discountPercent`, `note` |
| `loyalty` (230) | `enabled`, `earnPointsPer10k`, `redeemValuePerPoint`, `maxRedeemPercent`, `tiers: [{name, minPoints, benefitText}]` |
| `referral` (231) | `enabled`, `referrerPromotionId`, `referredPromotionId`, `maxPerReferrer` |
| `parcel` (223, 224) | `enabled`, `acceptHoursBefore`, `unclaimedHours`, `defaultMaxKg`, `defaultMaxPieces`, `maxWeightKgPerOrder`, `sizeClasses`, `cancelAfterReceivePercent`, `maxCompensationMultiple`, `claimDays`, `compensationText`, `note` |
| `content` (237) | `termsVi, termsEn, privacyVi, privacyEn, helpVi, helpEn, aboutVi, aboutEn` |

Bật/tắt trung chuyển và gửi đồ theo tuyến: trường `shuttleEnabled`, `parcelEnabled` của tuyến (mục 10).

### 9.13 🛠 Quản trị viên và khách hàng
* `GET /v1/admin/admins` · `POST /v1/admin/admins` `{ email*, displayName*, phone }` (SĐT trùng → `409 phone_taken`) → `201 { account, temporaryPassword }` (hiện **một lần** để trao cho người mới; họ phải đổi khi đăng nhập) · `POST /v1/admin/admins/{id}/reset-password` → `{ temporaryPassword }` · `POST /v1/admin/admins/{id}/revoke` (hoặc `DELETE`) → `204`. Không tự thu hồi mình; quản trị viên cuối → `409 last_admin` (256, 260).
* `GET /v1/admin/customers?q=&status=active|suspended&kind=new|returning` → `[{ id, email, displayName, phone, status, suspendReason, adminNote, bookings, completedTrips, totalSpent, kind, firstBookingAt, lastBookingAt, lastLoginAt, createdAt }]` (225).
* `GET /v1/admin/customers/{id}` (+ `refundAccount`, `emergencyContact`, `loyalty`, `recentBookings`, `recentParcels`, `adminHistory`) · `PATCH /v1/admin/customers/{id}` `{ adminNote }`.
* `POST /v1/admin/accounts/{id}/suspend` `{ reason* }` (đăng xuất mọi thiết bị ngay) · `POST /v1/admin/accounts/{id}/unsuspend` (226).
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
| `rows` | số nguyên 1..30 | ✓ |  |
| `cols` | số nguyên 1..10 | ✓ |  |
| `seats` | mảng object (≤80): `id`* chuỗi ≤10 (`^[A-Za-z0-9_-]+$`); `label`* chuỗi ≤10; `row`* số nguyên 0..30; `col`* số nguyên 0..10; `seatClass` chuỗi ≤30; `isSellable` true/false | ✓ |  |
| `note` | chuỗi ≤300 |  |  |

Không xóa được khi còn: vehicles → `409 has_dependents` (`blockedBy`).

### Xe (185-192)

`GET /v1/manage/vehicles` · `POST /v1/manage/vehicles` · `GET|PATCH|DELETE /v1/manage/vehicles/{id}` — 🔒 quản trị viên

Danh sách: lọc: `status`, `layoutId`; `q` tìm không dấu theo `plateNo`, `kindLabel`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `plateNo` | chuỗi ≤20 | ✓ |  |
| `kindLabel` | chuỗi ≤80 | ✓ |  |
| `layoutId` | id SeatLayout | ✓ |  |
| `seatCount` | số nguyên — *chỉ đọc* |  |  |
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
| `code` | chuỗi ≤20 (`^[A-Za-z0-9_-]{3,20}$`) | ✓ |  |
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

### Khách không dùng app (135)

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

### Hành khách đi cùng đã lưu (83)

`GET /v1/me/passengers` · `POST /v1/me/passengers` · `GET|PATCH|DELETE /v1/me/passengers/{id}` — 🔒 khách hàng (chỉ dữ liệu của mình)

Danh sách: `q` tìm không dấu theo `name`, `phone`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤80 | ✓ |  |
| `phone` | SĐT |  |  |
| `note` | chuỗi ≤300 |  |  |
| `isChild` | true/false |  | `false` |

### Địa chỉ trung chuyển đã lưu (84)

`GET /v1/me/addresses` · `POST /v1/me/addresses` · `GET|PATCH|DELETE /v1/me/addresses/{id}` — 🔒 khách hàng (chỉ dữ liệu của mình)

Danh sách: `q` tìm không dấu theo `label`, `addressText`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `label` | chuỗi ≤40 | ✓ |  |
| `zoneId` | id ShuttleZone |  |  |
| `addressText` | chuỗi ≤300 | ✓ |  |
| `noteText` | chuỗi ≤300 |  |  |

### Sổ người nhận hàng (86)

`GET /v1/me/receivers` · `POST /v1/me/receivers` · `GET|PATCH|DELETE /v1/me/receivers/{id}` — 🔒 khách hàng (chỉ dữ liệu của mình)

Danh sách: `q` tìm không dấu theo `name`, `phone`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `name` | chuỗi ≤80 | ✓ |  |
| `phone` | SĐT | ✓ |  |
| `addressText` | chuỗi ≤300 |  |  |
| `note` | chuỗi ≤300 |  |  |

### Tuyến / văn phòng yêu thích (87)

`GET /v1/me/favorites` · `POST /v1/me/favorites` · `GET|PATCH|DELETE /v1/me/favorites/{id}` — 🔒 khách hàng (chỉ dữ liệu của mình)

Danh sách: lọc: `kind`.

| Trường | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `kind` | `route` \| `office` | ✓ |  |
| `fromProvinceId` | id Province |  |  |
| `toProvinceId` | id Province |  |  |
| `officeId` | id Office |  |  |
| `label` | chuỗi ≤80 |  |  |

<!-- CRUD:END -->

---

## 11. Bảng nhãn hiển thị

### 11.1 Trạng thái đơn đặt ghế (`booking.status`)
| `status` | Tiếng Việt | English | Màu gợi ý | Nút chính |
|---|---|---|---|---|
| `awaiting_payment` | Chờ chuyển khoản | Awaiting transfer | cam | Gửi ảnh chuyển khoản (đếm ngược `payDeadlineSeconds`) |
| `pending_review` | Đã gửi chứng từ – chờ xác nhận | Receipt sent – awaiting confirmation | xanh dương | — (ghế đã giữ) |
| `info_requested` | Cần bổ sung chứng từ | More information needed | cam | Gửi thêm ảnh |
| `seat_lost` | Ghế bị người khác lấy trước | Seat taken by an earlier receipt | đỏ | Chọn ghế khác / Đổi chuyến / Hoàn tiền |
| `rejected` | Chứng từ bị từ chối – gửi lại | Receipt rejected – upload again | đỏ | Gửi lại ảnh |
| `expired` | Quá hạn gửi chứng từ | Receipt deadline passed | xám | Gửi ảnh (nếu ghế còn trống) / Đặt lại |
| `confirmed` | Đã xác nhận | Confirmed | xanh lá | Vé điện tử |
| `completed` | Đã đi | Completed | xám | Đánh giá |
| `cancelled` | Đã hủy | Cancelled | xám | — |

`source`: `app` (Đặt qua app) · `admin` (Nhà xe đặt hộ). `payMethod`: `proof` (Chuyển khoản – chứng từ) · `cash` (Tiền mặt) · `transfer` (Chuyển khoản trực tiếp) · `free` (Miễn phí).

### 11.2 Trạng thái ghế trên sơ đồ
| `state` | Tiếng Việt | English | Chọn được |
|---|---|---|---|
| `free` | Trống (+ "n người đang chọn") | Available (+ "n people choosing") | ✓ |
| `claimed` | Đã có chứng từ – chờ xác nhận | Receipt sent – pending | ✗ |
| `sold` | Đã bán | Sold | ✗ |
| `locked` | Đã khóa | Locked | ✗ |
| `unsellable` | Ghế tài xế / không bán | Driver / not for sale | ✗ (vẽ khác) |

`claimState` trong đơn: `selecting` (Chưa giữ chỗ) · `held` (Đã giữ chỗ) · `lost` (Bị lấy trước).

### 11.3 Trạng thái chuyến (`status`)
| `status` | Tiếng Việt | English |
|---|---|---|
| `open` | Đang mở bán | On sale |
| `not_open` | Chưa mở bán | Not on sale yet |
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

`payStatus`: `unpaid` (Chưa thanh toán) · `pending_review` (Đã gửi chứng từ) · `paid` (Đã thanh toán). `sizeClass`: `small` (Nhỏ) · `medium` (Vừa) · `large` (Lớn). `timeline.step`: `created` Đã tạo · `accepted` Nhà xe đã xác nhận · `paid` Đã thanh toán · `received` Đã nhận hàng · `loaded` Đã lên xe · `arrived` Đã tới nơi · `delivered` Đã giao.

### 11.5 Khác
| Trường | Giá trị → nhãn |
|---|---|
| Chứng từ `proof.status` | `pending` Chờ xác nhận · `approved` Đã xác nhận · `rejected` Bị từ chối |
| Yêu cầu `request.type` | `cancel` Hủy · `change_seat` Đổi ghế · `change_trip` Đổi chuyến · `refund` Hoàn tiền |
| Yêu cầu `request.status` | `pending` Chờ duyệt · `approved` Đã chấp nhận · `rejected` Bị từ chối · `withdrawn` Đã rút |
| Hoàn tiền `refund.status` | `pending` Chờ nhà xe chuyển · `recorded` Nhà xe đã ghi nhận hoàn |
| Trung chuyển `shuttle.status` | `pending` Chờ đón/trả · `done` Đã đón/trả · `absent` Khách vắng · `cancelled` Đã hủy |
| `shuttle.direction` | `pickup` Đón (nhà → văn phòng) · `drop` Trả (văn phòng → nhà) |
| `boarding` | `none` Chưa điểm danh · `boarded` Đã lên xe · `absent` Vắng |
| Khiếu nại `status` | `open` Mới · `in_progress` Đang xử lý · `resolved` Đã xử lý |
| Danh sách chờ `status` | `waiting` Đang chờ · `contacted` Đã liên hệ · `fulfilled` Đã có ghế · `cancelled` Đã hủy |
| Xe `status` | `active` Hoạt động · `maintenance` Đang bảo dưỡng · `retired` Ngừng khai thác |
| Nhân viên `kind` | `limo_driver` Tài xế limo · `shuttle_driver` Tài xế trung chuyển · `office_staff` Nhân viên văn phòng |
| Quy định `rules[].kind` | `luggage` Hành lý · `food` Đồ ăn uống · `pets` Thú cưng · `children` Trẻ em · `other` Khác |
| Cảnh báo `alerts[].kind` | `vehicle_doc` Giấy tờ xe sắp hết hạn · `maintenance_due` Đến hạn bảo dưỡng · `license_expiring` Bằng lái sắp hết hạn · `low_fill` Chuyến ít khách · `trip_unassigned` Chuyến chưa xếp xe/tài xế |

---

## 12. Luồng màn hình đề xuất

### 12.0 Đăng nhập (khách & quản trị viên chung màn hình)
1. Ô "Email hoặc số điện thoại" + mật khẩu → `POST /auth/login { login, password, deviceName, deviceId }`.
2. `account.role = customer` → 4 tab khách; `admin` → 5 tab quản trị. `mustChangePassword: true` → chỉ màn hình đổi mật khẩu (2.7).
3. "Quên mật khẩu" → `POST /auth/forgot { login }` → nhập mã từ email → `POST /auth/reset` → quay lại đăng nhập.

### 12.1 Khách đặt ghế
1. Tab Đặt chuyến → `GET /provinces?hasTrips=true&side=from` → chọn điểm đi → `…&side=to&fromProvinceId=` → ngày, số người.
2. `GET /trips?...` → danh sách + bộ lọc (`facets`). Hết chỗ → nút "Đăng ký chờ" (`POST /trips/{id}/waitlist`) và `GET /trips/{id}/alternatives`.
3. `GET /trips/{id}` (chi tiết, chính sách) → `GET /trips/{id}/seats` (sơ đồ, **giải thích quy tắc chuyển khoản trước có chỗ trước**).
4. Chọn văn phòng lên/xuống (`pickupOffices`/`dropOffices` của chuyến), xe trung chuyển (`GET /offices/{id}/shuttle-zones`), nhập hành khách, mã giảm giá → `POST /bookings/quote` mỗi lần thay đổi.
5. `POST /bookings` (Idempotency-Key) → **màn hình khuyến nghị gửi ảnh trước** (đếm ngược, các bước 1-2-3).
6. `GET /bookings/{id}/payment-info` → QR + số tài khoản → khách chuyển khoản trong app ngân hàng.
7. Chụp (CameraX, xin quyền Camera lúc bấm) hoặc chọn ảnh (Photo Picker) → nén → `POST /bookings/{id}/proofs` (Idempotency-Key).
8. `seatLost: false` → "Đã giữ ghế, chờ xác nhận". `seatLost: true` → màn hình 5.7.
9. Mở lại app → `GET /home`, `GET /notifications` để thấy kết quả (không có thông báo đẩy).

### 12.2 Quản trị viên xử lý chứng từ
Tab Cần xác nhận → `GET /manage/inbox/counts` (huy hiệu) → `GET /manage/proofs` (cũ nhất trên) → mở ảnh (`image.url`), đối chiếu sao kê, chú ý `duplicateOf` → duyệt / từ chối (lý do) / yêu cầu bổ sung → mục "Đơn mất ghế" (`type=lostseat`): `POST /bookings/{id}/assign-seats` hoặc chuyển chuyến hoặc hủy + hoàn.

### 12.3 Ngày chạy
Tab Chuyến → `GET /manage/trips?from=today` → chuyến → `manifest`, `shuttle`, `parcels` → `driver-text` gửi Zalo → điểm danh `boarding` → `logs` `depart` → (`delay` nếu trễ) → `logs` `arrive` (tự hoàn thành chuyến, cộng điểm cho khách).

---

## 13. Giới hạn

| Mục | Giới hạn |
|---|---|
| Đọc / ghi theo IP | 180 / 60 request mỗi phút; đăng nhập, đăng ký, quên mật khẩu: 10 / phút |
| Đăng nhập sai | 5 lần / 15 phút / tài khoản → `429 too_many_attempts` |
| Mã quên mật khẩu | 3 mã / giờ / email, hạn 30 phút |
| Ảnh chứng từ | ≤ `maxProofBytes` (mặc định 3 MB, tối đa 4 MB), JPG/PNG/WEBP; 30 ảnh / giờ / tài khoản |
| Link ảnh | 5 phút |
| Tin nhắn trong đơn | 20 / phút; liên hệ nhà xe 10 / giờ |
| Ghế mỗi đơn | 16 |
| Body JSON | 4 MB |
| Nhập CSV | 500 dòng |
| Hạn gửi chứng từ | mặc định 60 phút (`system.payDeadlineMinutes`), quá hạn đơn thành `expired` (vẫn gửi được nếu ghế trống) |
| Lưu ảnh chứng từ | mặc định 90 ngày sau khi chuyến hoàn thành (`system.proofRetentionDays`) |
| Chuyến lặp | sinh trước 45 ngày |
