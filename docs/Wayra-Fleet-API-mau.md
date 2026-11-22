# Wayra Fleet — API mẫu từ dữ liệu thật trên BE

App **không chạy dữ liệu cục bộ**: mọi màn lấy từ API. Tài liệu này ghi, theo từng màn hình, **gửi lên trường gì** và **API trả về trường gì**. Các JSON bên dưới là phản hồi thật lấy từ `https://seatrouteapi.vercel.app/v1` (mỗi danh sách rút gọn còn 1 phần tử). Quy ước chung (lỗi, phân trang, token…) xem `API-cho-FE.md`.

| | |
|---|---|
| Base URL | `https://seatrouteapi.vercel.app/v1` |
| Tài khoản mẫu | `quantri@nhaxevietnam.vn` (mật khẩu BE gửi riêng) — nhà xe "Nhà xe Việt Nam Limousine" đã có dữ liệu mẫu |
| Header | `Authorization: Bearer <accessToken>` ở mọi API 🔒; `Accept-Language: vi\|en` |
| Tiền | số nguyên đồng · Thời điểm: ISO UTC `…Z` · Ngày `yyyy-MM-dd` · Giờ `HH:mm` (giờ VN) |
| Phân trang | `{ items, nextCursor, total }`; gửi lại `?cursor=<nextCursor>&limit=` |
| Mỗi tài khoản = một nhà xe | App không gửi tham số nhà xe; BE lấy từ token |

Dữ liệu mẫu hiện có: 3 xe (2 limo + 1 trung chuyển), các chuyến Hà Nội ⇄ Thái Bình (mỗi chuyến có tên), 3 nhân sự, các chuyến 4 tuần tới, 8 đơn đủ trạng thái (chờ duyệt, chờ thu tiền, đã thu, từ chối, yêu cầu hủy, đã hủy, đặt hộ tại quầy), 2 bưu kiện, 2 khuyến mãi, 1 thông báo.

---

## 1. Đăng ký, đăng nhập
### Đăng ký (màn Đăng ký)
`POST /auth/register → 201`

Không cần token. Mặc định tạo **một nhà xe mới** (role `admin`). Lỗi: `409 phone_taken` / `email_taken`, `400 validation_failed` (`weak_password`, `acceptTerms`…).

**Gửi lên:**
```json
{ "displayName": "Nhà xe Hà Nội Limo", "phone": "0901234567", "email": "tuyen@example.com",
  "password": "Matkhau123", "acceptTerms": true, "preferredLanguage": "vi",
  "companyName": "Công ty Hà Nội Limo", "address": "1 Phạm Hùng, Hà Nội", "taxCode": "0101234567",
  "deviceName": "Android · Wayra Fleet", "deviceId": "<id cài đặt>" }
```

**Trả về:** `{ account, tokens }`. `account`: `id, email (có thể null), displayName, phone, role ("admin"), status, preferredLanguage, avatarColor, initials, createdAt`. `tokens`: `tokenType, accessToken, accessTokenExpiresAt, expiresIn, refreshToken, refreshTokenExpiresAt, sessionExpiresAt, deviceId`. Tài khoản mới **rỗng** nhưng đã có 3 mẫu sơ đồ ghế, loại hàng, hàng cấm, checklist.

### Đăng nhập
`POST /auth/login → 200`

`login` là email hoặc SĐT. Lỗi `401 invalid_credentials`, `429 login_locked` (sai 5 lần/15 phút).

**Gửi lên:**
```json
{ "login": "quantri@nhaxevietnam.vn", "password": "…", "deviceName": "Android · Wayra Fleet", "deviceId": "<id>" }
```

Cùng dạng trả về với đăng ký. Làm mới token: `POST /auth/refresh {refreshToken, deviceId}`; đăng xuất: `POST /auth/logout {refreshToken}`.

### Hồ sơ
`GET /me`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "account": {
  "id": "437d3db8-e62c-4386-8116-953eb226b267",
  "email": "quantri@nhaxevietnam.vn",
  "displayName": "Nguyễn Văn Hùng",
  "phone": null,
  "role": "admin",
  "status": "active",
  "preferredLanguage": "vi",
  "birthDate": null,
  "gender": null,
  "avatarColor": "#1E4F8A",
  "initials": "VH",
  "referralCode": null,
  "createdAt": "2026-11-22T12:27:14Z"
 }
}
```

Đổi mật khẩu `POST /auth/change-password {currentPassword,newPassword}`; xóa tài khoản `DELETE /me {password}` (**chủ nhà xe cuối cùng xóa là xóa cả dữ liệu nhà xe**).

---

## 2. Tab Tổng quan
### Tổng quan
`GET /manage/dashboard?range=today|7d|30d&chart=7|30`

Trả về mọi thứ của màn Tổng quan trong một lần gọi.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "range": {
  "preset": "7d",
  "from": "2026-11-16",
  "to": "2026-11-22"
 },
 "revenue": {
  "today": {
   "from": "2026-11-22",
   "to": "2026-11-22",
   "amount": 1150000,
   "booking": 1120000,
   "parcel": 30000,
   "orders": 4,
   "previous": 0,
   "changePercent": null
  },
  "last7Days": {
   "from": "2026-11-16",
   "to": "2026-11-22",
   "amount": 1150000,
   "booking": 1120000,
   "parcel": 30000,
   "orders": 4,
   "previous": 0,
   "changePercent": null
  },
  "thisMonth": {
   "from": "2026-11-01",
   "to": "2026-11-22",
   "amount": 1150000,
   "booking": 1120000,
   "parcel": 30000,
   "orders": 4,
   "previous": 0,
   "changePercent": null
  },
  "range": {
   "from": "2026-11-16",
   "to": "2026-11-22",
   "amount": 1150000,
   "booking": 1120000,
   "parcel": 30000,
   "orders": 4,
   "previous": 0,
   "changePercent": null
  }
 },
 "chart": [
  {
   "date": "2026-11-16",
   "amount": 0,
   "orders": 0
  }
 ],
 "vehicles": {
  "total": 3,
  "active": 3,
  "maintenance": 0,
  "retired": 0,
  "docsExpiringSoon": 0
 },
 "staff": {
  "total": 3,
  "byKind": {
   "limo_driver": 2,
   "shuttle_driver": 0,
   "office_staff": 1
  },
  "offToday": 0
 },
 "inbox": {
  "bookings": 2,
  "cancelRequests": 1,
  "toCollect": 1,
  "toCollectAmount": 310000,
  "refunds": 0,
  "parcels": 1,
  "reports": 0,
  "complaints": 0,
  "messages": 1,
  "contacts": 0,
  "total": 6,
  "oldestBookingWaitingMinutes": 33
 },
 "parcels": {
  "createdToday": 2,
  "pending": 1,
  "waitingPickupAtOffice": 0,
  "revenueInRange": 30000
 },
 "tripsToday": {
  "count": 0,
  "passengers": 0,
  "fillPercent": 0,
  "unassigned": 0,
  "items": []
 },
 "recentBookings": [
  {
   "id": "2704eb59-d62b-45cc-8309-c34ec818f640",
   "code": "SRJCULKU",
   "status": "confirmed",
   "source": "counter",
   "totalAmount": 310000,
   "paid": true,
   "createdAt": "2026-11-22T12:28:24Z",
   "customer": {
    "displayName": "Bà Lan",
    "phone": "0988777666"
   },
   "passengers": [
    {
     "name": "Bà Lan",
     "seat": "B2"
    }
   ],
   "routeName": "Hà Nội → Thái Bình",
   "departAt": "2026-11-22T23:00:00Z",
   "trip": {
    "id": "4a5f11ea-54ba-4297-a559-57a10a1f60d2",
    "departAt": "2026-11-22T23:00:00Z",
    "date": "2026-11-23",
    "departTime": "06:00",
    "tzOffset": "+07:00",
    "arriveAt": "2026-11-23T01:30:00Z",
    "status": "scheduled",
    "route": {
     "id": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
     "name": "Hà Nội → Thái Bình"
    },
    "vehicle": {
     "kindLabel": "Limousine 9 chỗ",
     "name": "Dcar Limousine",
     "plateNo": "29B-000.01"
    },
    "updates": []
   }
  }
 ],
 "toCollect": {
  "count": 1,
  "amount": 310000,
  "tripsWithin24h": 0,
  "amountWithin24h": 0
 },
 "longestWaiting": [
  {
   "bookingId": "54d84152-dfed-44e0-95f4-5fb4b16286b7",
   "code": "SRPA2X6J",
   "amount": 620000,
   "createdAt": "2026-11-22T12:28:17Z",
   "waitingMinutes": 33
  }
 ],
 "topRoutes": [
  {
   "routeId": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
   "name": "Hà Nội → Thái Bình",
   "seats": 4,
   "bookings": 3,
   "revenue": 870000
  }
 ],
 "topHours": [
  {
   "hour": 6,
   "seats": 3
  }
 ],
 "alerts": [
  {
   "kind": "low_fill",
   "severity": "low",
   "tripId": "c996531a-b3e3-4052-99fe-b0e9a8f70712",
   "route": "Hà Nội → Thái Bình",
   "departAt": "2026-11-23T06:00:00Z",
   "fillPercent": 0
  }
 ],
 "updatedAt": "2026-11-22T13:01:07Z"
}
```

Ghi chú các khối chính: `revenue.{today,last7Days,thisMonth,range}` (doanh thu tính theo **ngày thu tiền**), `chart[]` (`date, amount, orders`), `inbox` (số việc cần làm: `bookings` chờ duyệt, `cancelRequests`, `toCollect` + `toCollectAmount` chờ thu tiền, `refunds`, `parcels`…), `tripsToday.items[]` (bảng giờ xe chạy), `recentBookings[]` (đã có `customer`, `passengers`, `routeName`, `departAt`), `topRoutes[]`, `topHours[]` (đủ mọi giờ có chuyến, giờ chưa bán `seats: 0`), `vehicles`, `staff`, `parcels`, `alerts[]`.

### Doanh thu theo kỳ
`GET /manage/revenue?from=yyyy-MM-dd&days=7|30|60`

`from` mặc định là hôm nay trừ `days`−1.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "from": "2026-11-16",
 "to": "2026-11-22",
 "days": 7,
 "previousFrom": "2026-11-09",
 "total": 1150000,
 "previousTotal": 0,
 "changePercent": null,
 "averagePerDay": 164286,
 "bestDay": {
  "date": "2026-11-22",
  "amount": 1150000
 },
 "daily": [
  {
   "date": "2026-11-16",
   "app": 0,
   "counter": 0,
   "parcel": 0,
   "refunded": 0,
   "amount": 0
  }
 ],
 "previousDaily": [
  {
   "date": "2026-11-09",
   "app": 0,
   "counter": 0,
   "parcel": 0,
   "refunded": 0,
   "amount": 0
  }
 ],
 "bySource": {
  "app": 810000,
  "counter": 310000,
  "parcel": 30000
 },
 "byRoute": [],
 "byWeekday": [
  {
   "weekday": 0,
   "average": 1150000
  }
 ],
 "note": "by_route_uses_departure_day"
}
```

### Số việc cần làm (badge)
`GET /manage/inbox/counts`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "bookings": 2,
 "cancelRequests": 1,
 "toCollect": 1,
 "toCollectAmount": 310000,
 "refunds": 0,
 "parcels": 1,
 "reports": 0,
 "complaints": 0,
 "messages": 1,
 "contacts": 0,
 "total": 6,
 "oldestBookingWaitingMinutes": 33
}
```


---

## 3. Tab Lịch biểu
### Danh sách chuyến theo ngày
`GET /manage/trips?from=yyyy-MM-dd&to=yyyy-MM-dd&routeId=`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "from": "2026-11-22",
 "to": "2026-11-30",
 "items": [
  {
   "id": "4a5f11ea-54ba-4297-a559-57a10a1f60d2",
   "routeId": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
   "route": {
    "id": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
    "name": "Hà Nội → Thái Bình",
    "fromProvinceId": "73905cfe-f297-410f-b240-ff06d70192e7",
    "toProvinceId": "3522ff70-84fc-4065-a8f6-49aa49fe31d5",
    "durationMinutes": 150
   },
   "departAt": "2026-11-22T23:00:00Z",
   "date": "2026-11-23",
   "departTime": "06:00",
   "tzOffset": "+07:00",
   "arriveAt": "2026-11-23T01:30:00Z",
   "arriveTime": "08:30",
   "status": "open",
   "salesOpenAt": "2026-11-15T23:00:00Z",
   "salesCloseAt": "2026-11-22T19:00:00Z",
   "vehicle": {
    "id": "529cfc58-80c2-462a-9374-be142a610858",
    "plateNo": "29B-000.01",
    "kindLabel": "Limousine 9 chỗ",
    "seatCount": 10,
    "status": "active"
   },
   "seats": {
    "total": 9,
    "free": 6,
    "pending": 0,
    "sold": 3,
    "locked": 0
   },
   "basePrice": 250000,
   "frontSurcharge": 30000,
   "vipSurcharge": 60000,
   "minPrice": 250000,
   "prices": [],
   "shuttleEnabled": true,
   "parcelEnabled": true,
   "tripStatus": "scheduled",
   "salesClosed": false,
   "vehicleId": "529cfc58-80c2-462a-9374-be142a610858",
   "driverId": "efcc58b6-8d64-4c3e-a059-33852b2c1d68",
   "driver": {
    "id": "efcc58b6-8d64-4c3e-a059-33852b2c1d68",
    "name": "Trần Văn Lái",
    "phone": "0912000111"
   },
   "fillPercent": 33,
   "needsVehicle": false,
   "needsDriver": false,
   "seriesId": "3e0f5b2d-a77f-4cc3-add2-87db00cf6f82",
   "parcelCapacity": {
    "maxKg": 100,
    "maxPieces": 20
   },
   "parcelLoad": {
    "kg": 1,
    "pieces": 1
   },
   "actualDepartAt": null,
   "actualArriveAt": null,
   "driverPay": 0,
   "cancelReason": null,
   "overrideReason": null,
   "note": "",
   "checklistDone": 0,
   "checklistTotal": 0,
   "createdAt": "2026-11-22T12:27:18Z",
   "updatedAt": "2026-11-22T12:27:18Z",
   "warnings": []
  }
 ]
}
```

### Chi tiết chuyến
`GET /manage/trips/{id}`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{"id":"4a5f11ea-54ba-4297-a559-57a10a1f60d2","routeId":"d93aa1a5-27b5-435f-81ca-8af72a3f05d5","route":{"id":"d93aa1a5-27b5-435f-81ca-8af72a3f05d5","name":"Hà Nội → Thái Bình","fromProvinceId":"73905cfe-f297-410f-b240-ff06d70192e7","toProvinceId":"3522ff70-84fc-4065-a8f6-49aa49fe31d5","durationMinutes":150,"from":{"id":"73905cfe-f297-410f-b240-ff06d70192e7","name":"Hà Nội"},"to":{"id":"3522ff70-84fc-4065-a8f6-49aa49fe31d5","name":"Thái Bình"}},"departAt":"2026-11-22T23:00:00Z","date":"2026-11-23","departTime":"06:00","tzOffset":"+07:00","arriveAt":"2026-11-23T01:30:00Z","arriveTime":"08:30","status":"open","salesOpenAt":"2026-11-15T23:00:00Z","salesCloseAt":"2026-11-22T19:00:00Z","vehicle":{"id":"529cfc58-80c2-462a-9374-be142a610858","plateNo":"29B-000.01","kindLabel":"Limousine 9 chỗ","seatCount":10,"status":"active"},"seats":{"total":9,"free":6,"pending":0,"sold":3,"locked":0},"basePrice":250000,"frontSurcharge":30000,"vipSurcharge":60000,"minPrice":250000,"prices":[],"shuttleEnabled":true,"parcelEnabled":true,"pickupOffices":[{"officeId":"5710b260-427b-437f-95ac-96b2dc1ccfc9","name":"VP Mỹ Đình","address":"20 Phạm Hùng, Nam Từ Liêm","phone":"0241111111","openText":"05:00 - 21:00","directionNote":"","isActive":true,"offsetMinutes":0,"sortOrder":0,"arriveAt":"2026-11-22T23:00:00Z","arriveTime":"06:00"}],"dropOffices":[{"officeId":"5bf98f85-1c82-4857-a0a5-a78db7b6de44","name":"VP TP Thái Bình","address":"15 Lý Bôn, TP Thái Bình","phone":"0227333333","openText":"05:00 - 21:00","directionNote":"","isActive":true,"offsetMinutes":140,"sortOrder":0,"arriveAt":"2026-11-23T01:20:00Z","arriveTime":"08:20"}],"stops":[{"name":"Trạm dừng Phủ Lý","offsetMinutes":70,"arriveTime":"07:10"}],"usefulInfo":"Có mặt tại văn phòng trước giờ xe tới 10 phút. Xe dừng nghỉ 10 phút tại trạm dừng Phủ Lý.","tripStatus":"scheduled","salesClosed":false,"vehicleId":"529cfc58-80c2-462a-9374-be142a610858","driverId":"efcc58b6-8d64-4c3e-a059-33852b2c1d68","driver":{"id":"efcc58b6-8d64-4c3e-a059-33852b2c1d68","name":"Trần Văn Lái","phone":"0912000111"},"fillPercent":33,"needsVehicle":false,"needsDriver":false,"seriesId":"3e0f5b2d-a77f-4cc3-add2-87db00cf6f82","parcelCapacity":{"maxKg":100,"maxPieces":20},"parcelLoad":{"kg":1,"pieces":1},"actualDepartAt":null,"actualArriveAt":null,"driverPay":0,"cancelReason":null,"overrideReason":null,"note":"","checklistDone":0,"checklistTotal":0,"createdAt":"2026-11-22T12:27:18Z","updatedAt":"2026-11-22T12:27:18Z","operator":{"name":"Nhà xe Việt Nam Limousine","phone":"0347218023","rating":null,"reviewCount":0,"completedTrips":0},"cancelPolicy":{"tiers":[{"hoursBefore":24,"refundPercent":100}],"cancelFee":10000,"changeAllowedHoursBefore":4,"changeFee":0,"note":""},"rules":[{"kind":"luggage","text":"Mỗi khách 1 vali 20kg và 1 túi xách."}],"shuttleRule":{"registerHoursBefore":3,"feeRefundable":true,"note":"","deadline":"2026-11-22T20:00:00Z"},"bookingRule":{"leadHours":4,"maxSeats":6,"daysAhead":7},"checklist":[],"shuttleDuties":[],"logs":[],"expenses":{"items":[],"total":0,"driverPay":0},"bookingsByStatus":{"confirmed":2},"waitlistCount":0}
```

### Sơ đồ ghế của chuyến
`GET /manage/trips/{id}/seats`

`seats[].state`: `free | pending | sold | locked`. Khóa/mở ghế: `POST /manage/trips/{id}/seats/{label}/lock|unlock {reason}`.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "tripId": "4a5f11ea-54ba-4297-a559-57a10a1f60d2",
 "status": "open",
 "layout": {
  "rows": 4,
  "cols": 3,
  "name": "Limousine 9 chỗ"
 },
 "seats": [
  {
   "seatId": "TX",
   "label": "TX",
   "row": 0,
   "col": 0,
   "seatClass": "standard",
   "seatClassName": "Ghế thường",
   "seatPrice": 250000,
   "surcharge": 0,
   "total": 250000,
   "state": "unsellable",
   "isMine": false,
   "lockReason": "not_sellable",
   "claimedAt": null,
   "booking": null
  }
 ],
 "counts": {
  "free": 6,
  "pending": 0,
  "sold": 3,
  "locked": 0
 }
}
```

### Danh sách khách trên chuyến
`GET /manage/trips/{id}/manifest`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "tripId": "4a5f11ea-54ba-4297-a559-57a10a1f60d2",
 "total": 3,
 "boarded": 0,
 "absent": 0,
 "items": [
  {
   "bookingId": "d9caeac3-85b2-43d5-b077-92b7c98488ed",
   "bookingCode": "SRNVKMWX",
   "bookingStatus": "confirmed",
   "source": "app",
   "bookingSeatId": "8bcb6551-5ab7-4e0a-9a46-2c6ef9e667a6",
   "seatId": "A1",
   "seatLabel": "A1",
   "passengerName": "Nguyễn Minh Quân",
   "passengerPhone": "0909000111",
   "note": "",
   "pickupOffice": "VP Mỹ Đình",
   "dropOffice": "VP TP Thái Bình",
   "pickupShuttle": false,
   "dropShuttle": false,
   "boarding": "none"
  }
 ]
}
```

**Gửi lên khi thao tác chuyến**
| Việc | API | Body |
|---|---|---|
| Tạo chuyến | `POST /manage/trips` | `{ name?, fromProvinceId, toProvinceId, durationMinutes?, date, departTime, vehicleId, driverId?, basePrice, repeatWeekdays?: [0..6] }` — **nhập tên chuyến + từ đâu đến đâu**, không cần tuyến hay văn phòng (BE tự tạo/tái dùng tuyến theo cặp tỉnh). Không có `name` thì tên chuyến = "Từ → Đến". Vẫn nhận `routeId` thay cho cặp tỉnh. `repeatWeekdays` → tạo 4 tuần, bỏ ngày trùng; trả `repeatedTrips`, `skippedDates` |
| Sửa / xóa | `PATCH` / `DELETE /manage/trips/{id}` | trường cần sửa (có cả `name`) |
| Đổi trạng thái | `POST /manage/trips/{id}/status` | `{ status: "running"\|"completed"\|… }` |
| Hủy chuyến | `POST /manage/trips/{id}/cancel` | `{ reason }` |
| Gán tài xế / xe | `PUT /manage/trips/{id}/driver` · `/vehicle` | `{ driverId }` · `{ vehicleId }` (xe khác phải **cùng sơ đồ ghế**, lỗi `seats_mismatch`) |
| Chi phí | `POST /manage/trips/{id}/expenses` | `{ category, amount, note }` |
| Checklist | `PATCH /manage/trips/{id}/checklist/{itemId}` | `{ done: true }` |

---

## 4. Tab Đặt xe
### Đơn chờ duyệt
`GET /manage/bookings?status=pending`

Lọc: `status=pending|confirmed|cancel_requested|completed|rejected|cancelled`, `payment=unpaid|paid`, `tripId`, `q`, `from`/`to` (ngày đi). `payment=unpaid` = **đơn đã duyệt chưa thu tiền** (số này luôn bằng `inbox.toCollect`).

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "54d84152-dfed-44e0-95f4-5fb4b16286b7",
   "code": "SRPA2X6J",
   "status": "pending",
   "source": "app",
   "trip": {
    "id": "88dcf39e-e097-4a06-9ff3-9b081673e754",
    "departAt": "2026-11-24T06:00:00Z",
    "date": "2026-11-24",
    "departTime": "13:00",
    "tzOffset": "+07:00",
    "arriveAt": "2026-11-24T08:30:00Z",
    "status": "scheduled",
    "route": {
     "id": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
     "name": "Hà Nội → Thái Bình"
    },
    "vehicle": {
     "kindLabel": "Limousine 9 chỗ",
     "name": "Dcar Limousine",
     "plateNo": "29B-000.01"
    },
    "updates": []
   },
   "pickupOffice": {
    "id": "5710b260-427b-437f-95ac-96b2dc1ccfc9",
    "name": "VP Mỹ Đình",
    "address": "20 Phạm Hùng, Nam Từ Liêm",
    "phone": "0241111111",
    "directionNote": "",
    "isActive": true,
    "arriveAt": "2026-11-24T06:00:00Z",
    "arriveTime": "13:00"
   },
   "dropOffice": {
    "id": "5bf98f85-1c82-4857-a0a5-a78db7b6de44",
    "name": "VP TP Thái Bình",
    "address": "15 Lý Bôn, TP Thái Bình",
    "phone": "0227333333",
    "directionNote": "",
    "isActive": true,
    "arriveAt": "2026-11-24T08:20:00Z",
    "arriveTime": "15:20"
   },
   "pickupShuttle": null,
   "dropShuttle": null,
   "seats": [
    {
     "id": "a57567a9-6791-442a-9e92-3888728ac3d9",
     "seatId": "C1",
     "label": "C1",
     "seatClass": "vip",
     "passengerName": "Nguyễn Minh Quân",
     "passengerPhone": "0909000111",
     "seatPrice": 250000,
     "surcharge": 60000,
     "netAmount": 310000,
     "boarding": "none"
    }
   ],
   "amounts": {
    "seatsAmount": 500000,
    "surchargeAmount": 120000,
    "shuttleAmount": 0,
    "subtotal": 620000,
    "promoDiscount": 0,
    "discountAmount": 0,
    "totalAmount": 620000,
    "seasonalApplied": []
   },
   "totalAmount": 620000,
   "paidAmount": 0,
   "paid": false,
   "paidAt": null,
   "payMethod": null,
   "refundedAmount": 0,
   "promoCode": null,
   "note": "",
   "payAtCounter": true,
   "confirmedAt": null,
   "completedAt": null,
   "cancelledAt": null,
   "cancelReason": null,
   "pendingRequest": null,
   "notices": [],
   "reviewed": false,
   "actions": {
    "cancel": true,
    "cancelNeedsApproval": false,
    "editShuttle": true,
    "review": false,
    "chat": true
   },
   "createdAt": "2026-11-22T12:28:17Z",
   "updatedAt": "2026-11-22T12:28:17Z",
   "customer": {
    "id": "81ebdfee-ed31-4216-8c87-1163dae886f5",
    "displayName": "Nguyễn Minh Quân",
    "phone": "0909000111",
    "email": "minhquan.nguyen@nhaxevietnam.vn"
   },
   "guest": null,
   "compReason": null,
   "canCollect": false,
   "internalNotes": [],
   "cancelPolicySnapshot": {
    "tiers": [
     {
      "hoursBefore": 24,
      "refundPercent": 100
     }
    ],
    "cancelFee": 10000,
    "changeAllowedHoursBefore": 4,
    "changeFee": 0,
    "shuttleFeeRefundable": true,
    "takenAt": "2026-11-22T12:28:17Z"
   },
   "waitingMinutes": 33,
   "overdue": true
  }
 ],
 "nextCursor": null,
 "total": 2
}
```

### Chi tiết đơn
`GET /bookings/{id}`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "id": "54d84152-dfed-44e0-95f4-5fb4b16286b7",
 "code": "SRPA2X6J",
 "status": "pending",
 "source": "app",
 "trip": {
  "id": "88dcf39e-e097-4a06-9ff3-9b081673e754",
  "departAt": "2026-11-24T06:00:00Z",
  "date": "2026-11-24",
  "departTime": "13:00",
  "tzOffset": "+07:00",
  "arriveAt": "2026-11-24T08:30:00Z",
  "status": "scheduled",
  "route": {
   "id": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
   "name": "Hà Nội → Thái Bình"
  },
  "vehicle": {
   "kindLabel": "Limousine 9 chỗ",
   "name": "Dcar Limousine",
   "plateNo": "29B-000.01"
  },
  "updates": []
 },
 "pickupOffice": {
  "id": "5710b260-427b-437f-95ac-96b2dc1ccfc9",
  "name": "VP Mỹ Đình",
  "address": "20 Phạm Hùng, Nam Từ Liêm",
  "phone": "0241111111",
  "directionNote": "",
  "isActive": true,
  "arriveAt": "2026-11-24T06:00:00Z",
  "arriveTime": "13:00"
 },
 "dropOffice": {
  "id": "5bf98f85-1c82-4857-a0a5-a78db7b6de44",
  "name": "VP TP Thái Bình",
  "address": "15 Lý Bôn, TP Thái Bình",
  "phone": "0227333333",
  "directionNote": "",
  "isActive": true,
  "arriveAt": "2026-11-24T08:20:00Z",
  "arriveTime": "15:20"
 },
 "pickupShuttle": null,
 "dropShuttle": null,
 "seats": [
  {
   "id": "a57567a9-6791-442a-9e92-3888728ac3d9",
   "seatId": "C1",
   "label": "C1",
   "seatClass": "vip",
   "passengerName": "Nguyễn Minh Quân",
   "passengerPhone": "0909000111",
   "seatPrice": 250000,
   "surcharge": 60000,
   "netAmount": 310000,
   "boarding": "none"
  }
 ],
 "amounts": {
  "seatsAmount": 500000,
  "surchargeAmount": 120000,
  "shuttleAmount": 0,
  "subtotal": 620000,
  "promoDiscount": 0,
  "discountAmount": 0,
  "totalAmount": 620000,
  "seasonalApplied": []
 },
 "totalAmount": 620000,
 "paidAmount": 0,
 "paid": false,
 "paidAt": null,
 "payMethod": null,
 "refundedAmount": 0,
 "promoCode": null,
 "note": "",
 "payAtCounter": true,
 "confirmedAt": null,
 "completedAt": null,
 "cancelledAt": null,
 "cancelReason": null,
 "pendingRequest": null,
 "notices": [],
 "reviewed": false,
 "actions": {
  "cancel": true,
  "cancelNeedsApproval": false,
  "editShuttle": true,
  "review": false,
  "chat": true
 },
 "createdAt": "2026-11-22T12:28:17Z",
 "updatedAt": "2026-11-22T12:28:17Z",
 "customer": {
  "id": "81ebdfee-ed31-4216-8c87-1163dae886f5",
  "displayName": "Nguyễn Minh Quân",
  "phone": "0909000111",
  "email": "minhquan.nguyen@nhaxevietnam.vn"
 },
 "guest": null,
 "compReason": null,
 "canCollect": false,
 "internalNotes": [],
 "cancelPolicySnapshot": {
  "tiers": [
   {
    "hoursBefore": 24,
    "refundPercent": 100
   }
  ],
  "cancelFee": 10000,
  "changeAllowedHoursBefore": 4,
  "changeFee": 0,
  "shuttleFeeRefundable": true,
  "takenAt": "2026-11-22T12:28:17Z"
 },
 "waitingMinutes": 33,
 "overdue": true
}
```

**Gửi lên khi xử lý đơn** (tất cả `POST`, trả về đơn đã cập nhật)
| Việc | API | Body |
|---|---|---|
| Duyệt | `/manage/bookings/{id}/approve` | `{}` |
| Duyệt hàng loạt | `/manage/bookings/approve` | `{ ids: ["…"] }` |
| Từ chối | `/manage/bookings/{id}/reject` | `{ reason }` |
| **Xác nhận đã thu tiền** | `/manage/bookings/{id}/collect` | `{ method: "cash"\|"transfer", note? }` |
| Duyệt / từ chối yêu cầu hủy | `/manage/bookings/{id}/approve-cancel` · `/reject-cancel` | `{ note? }` |
| Hủy đơn | `/manage/bookings/{id}/cancel` | `{ reason }` |
| Ghi hoàn tiền | `/manage/bookings/{id}/refund` | `{ amount?, note }` |
| Đổi ghế / chuyển chuyến | `/manage/bookings/{id}/assign-seats` · `/move` | `{ seats:[{seatId,…}] }` · `{ tripId, seats }` |
| Ghi chú nội bộ | `/manage/bookings/{id}/notes` | `{ text }` |
| Đặt hộ tại quầy | `POST /manage/bookings` | `{ tripId, pickup:{address*,note?,lat?,lng?}, drop:{address*,note?,lat?,lng?}, seats:[{seatId,passengerName,passengerPhone?}], guest:{name,phone}, payMethod:"cash"\|"transfer" }` → có `payMethod`: đã duyệt và **đã thu** ngay; **bỏ `payMethod`**: đặt trước, thu sau (hiện ở "Chờ thu tiền") |
| **Đổi địa chỉ đón / trả** | `PATCH /bookings/{id}/places` | `{ pickup?:{address,note?}, drop?:{address,note?} }` (tới khi xe chạy) |

Trường quyết định nút bấm trên đơn: `status`, `paid`, `paidAt`, `payMethod`, `canCollect`, `payAtCounter`, `waitingMinutes`, `overdue`, `actions{cancel, cancelNeedsApproval, editShuttle, review, chat}`. Tên khách: `customer{displayName,phone}` hoặc `guest{name,phone}` (đặt hộ).

### Gửi đồ
`GET /manage/parcels?status=&q=`

`status`: `pending|accepted|received|loaded|arrived|delivered|cancelled|rejected|issue`. Thao tác: `POST /manage/parcels/{id}/accept|reject|status|handover|cancel|issue` (`status` nhận `{status:"received"\|"loaded"\|"arrived", payMethod?}`; phí thu tại quầy khi sang `received`).

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "6de6c59f-42cd-4e6e-964d-0e068dde669d",
   "code": "GDSLPHEJ",
   "status": "received",
   "paid": true,
   "payMethod": "cash",
   "source": "app",
   "sender": {
    "name": "Trần Thị Bình",
    "phone": "0909000222"
   },
   "receiver": {
    "name": "Lê Văn Hùng",
    "phone": "0977000222",
    "addressText": ""
   },
   "route": {
    "id": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
    "name": "Hà Nội → Thái Bình"
   },
   "date": "2026-11-23",
   "trip": {
    "id": "4a5f11ea-54ba-4297-a559-57a10a1f60d2",
    "departAt": "2026-11-22T23:00:00Z",
    "date": "2026-11-23",
    "departTime": "06:00",
    "status": "scheduled"
   },
   "fromOffice": {
    "id": "5710b260-427b-437f-95ac-96b2dc1ccfc9",
    "name": "VP Mỹ Đình",
    "address": "20 Phạm Hùng, Nam Từ Liêm",
    "phone": "0241111111"
   },
   "toOffice": {
    "id": "5bf98f85-1c82-4857-a0a5-a78db7b6de44",
    "name": "VP TP Thái Bình",
    "address": "15 Lý Bôn, TP Thái Bình",
    "phone": "0227333333"
   },
   "category": null,
   "descriptionText": "Giấy tờ",
   "pieceCount": 1,
   "weightKg": 1,
   "actualWeightKg": null,
   "sizeClass": "small",
   "declaredValue": 0,
   "note": "",
   "pickupShuttle": null,
   "dropShuttle": null,
   "estimate": {
    "rateId": "717e63f0-e95c-40fd-8d06-567b0ee8e624",
    "weightKg": 1,
    "sizeClass": "small",
    "base": 30000,
    "extraKg": 0,
    "extraAmount": 0,
    "declaredValue": 0,
    "declaredValuePercent": 1,
    "declaredSurcharge": 0,
    "pickupFee": 0,
    "dropFee": 0,
    "total": 30000
   },
   "fee": 30000,
   "feeBreakdown": {
    "rateId": "717e63f0-e95c-40fd-8d06-567b0ee8e624",
    "weightKg": 1,
    "sizeClass": "small",
    "base": 30000,
    "extraKg": 0,
    "extraAmount": 0,
    "declaredValue": 0,
    "declaredValuePercent": 1,
    "declaredSurcharge": 0,
    "pickupFee": 0,
    "dropFee": 0,
    "total": 30000,
    "finalFee": 30000
   },
   "feeAdjustReason": null,
   "paidAmount": 30000,
   "refundedAmount": 0,
   "rejectReason": null,
   "cancelReason": null,
   "unclaimed": false,
   "arrivedAt": null,
   "deliveredAt": null,
   "timeline": [
    {
     "step": "created",
     "at": "2026-11-22T12:28:26Z",
     "done": true
    }
   ],
   "history": [
    {
     "kind": "created",
     "at": "2026-11-22T12:28:26Z",
     "note": "",
     "byRole": "customer"
    }
   ],
   "handoverLocked": false,
   "actions": {
    "cancel": true,
    "regenerateCode": true,
    "reportIssue": true
   },
   "createdAt": "2026-11-22T12:28:26Z",
   "updatedAt": "2026-11-22T12:28:27Z",
   "senderAccountId": "e0fef5b5-a3c1-4be8-9bb5-6ecc83b3fef3",
   "guestContactId": null,
   "handoverFailures": 0,
   "internalNotes": []
  }
 ],
 "nextCursor": null,
 "total": 2
}
```

### Khiếu nại / báo cáo / liên hệ
`GET /admin/complaints · /admin/reports · /admin/contact-messages`

Đều trả `{ items, nextCursor, total }`; hiện chưa có bản ghi mẫu. Xử lý: `POST /admin/reports/{id}/resolve`, `POST /admin/contact-messages/{id}/reply`, `POST /complaints/{id}/replies`.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [],
 "nextCursor": null,
 "total": 0
}
```


---

## 5. Tab Thêm
### 5.1 Đội xe (không còn mục Văn phòng)
### Xe
`GET /manage/vehicles`

Tạo `POST /manage/vehicles`, sửa `PATCH /manage/vehicles/{id}`.

**Gửi lên:**
```json
{ "type": "limo", "plateNo": "29B-000.01", "name": "Dcar Limousine", "kindLabel": "Limousine 9 chỗ", "layoutId": "<id sơ đồ>",
  "frontSurcharge": 30000, "vipSurcharge": 60000, "year": 2024, "colorText": "Đen", "amenities": ["wifi","sạc"],
  "defaultDriverId": "<id tài xế>", "parcelMaxKg": 100, "parcelMaxPieces": 20,
  "docDates": [{ "kind": "registration", "expiresOn": "2027-05-01" }] }
// Xe trung chuyển: { "type": "shuttle", "plateNo": "…", "name": "Ford Transit", "capacity": 16 } (không có layoutId)
```

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "529cfc58-80c2-462a-9374-be142a610858",
   "type": "limo",
   "plateNo": "29B-000.01",
   "name": "Dcar Limousine",
   "kindLabel": "Limousine 9 chỗ",
   "layoutId": "63cee1c9-1357-4067-a379-71c9f83eedb5",
   "capacity": null,
   "seatCount": 10,
   "frontSurcharge": 30000,
   "vipSurcharge": 60000,
   "year": 2024,
   "colorText": "Đen",
   "status": "active",
   "defaultDriverId": "efcc58b6-8d64-4c3e-a059-33852b2c1d68",
   "amenities": [
    "wifi"
   ],
   "docDates": [
    {
     "kind": "registration",
     "label": null,
     "expiresOn": "2027-05-01"
    }
   ],
   "parcelMaxKg": 100,
   "parcelMaxPieces": 20,
   "note": null,
   "createdAt": "2026-11-22T12:27:17Z",
   "updatedAt": "2026-11-22T12:27:17Z"
  }
 ],
 "nextCursor": null,
 "total": 3
}
```

### Sơ đồ ghế
`GET /manage/seat-layouts · GET /manage/seat-layouts/templates`

Mẫu sẵn: 9, 11, 16 chỗ (lấy từ `/templates`, rồi `POST /manage/seat-layouts {name, rows, cols, seats}`). Ô (0,0) là ghế tài xế, không bán.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "63cee1c9-1357-4067-a379-71c9f83eedb5",
   "name": "Limousine 9 chỗ",
   "rows": 4,
   "cols": 3,
   "seats": [
    {
     "id": "TX",
     "label": "TX",
     "row": 0,
     "col": 0,
     "seatClass": "standard",
     "isSellable": false
    }
   ],
   "note": null,
   "createdAt": "2026-11-22T12:27:16Z",
   "updatedAt": "2026-11-22T12:27:16Z"
  }
 ],
 "nextCursor": null,
 "total": 1
}
```

### Nhân sự
`GET /admin/staff`

`kind`: `limo_driver | shuttle_driver | office_staff`. Lịch nghỉ: `GET/POST/DELETE /admin/staff-schedules`.

**Gửi lên:**
```json
{ "kind": "limo_driver", "name": "Trần Văn Lái", "phone": "0912000111", "licenseClassText": "D", "licenseExpiresOn": "2030-06-30", "officeId": null }
```

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "dfae77dd-28fa-4e81-b439-c97005022aa9",
   "kind": "limo_driver",
   "name": "Lê Văn Xe",
   "phone": "0912000222",
   "positionText": null,
   "officeId": null,
   "joinedOn": null,
   "licenseClassText": "D",
   "licenseExpiresOn": "2029-12-31",
   "status": "active",
   "payPerTrip": 0,
   "note": null,
   "createdAt": "2026-11-22T12:27:16Z",
   "updatedAt": "2026-11-22T12:27:16Z"
  }
 ],
 "nextCursor": null,
 "total": 3
}
```

### Tuyến
`GET /manage/routes`

Không bắt buộc: chuyến tự tạo tuyến theo cặp tỉnh. Tạo `POST /manage/routes`, nhân bản/đảo chiều `POST /manage/routes/{id}/duplicate {reverse:true}`. `fromProvinceId`/`toProvinceId` lấy từ `GET /provinces`.

**Gửi lên:**
```json
{ "fromProvinceId": "<id>", "toProvinceId": "<id>", "durationMinutes": 150, "basePrice": 250000, "parcelEnabled": true,
  "usefulInfo": "…", "stops": [{ "name": "Trạm Phủ Lý", "sortOrder": 0, "offsetMinutes": 70 }] }
```

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "d93aa1a5-27b5-435f-81ca-8af72a3f05d5",
   "name": "Hà Nội → Thái Bình",
   "fromProvinceId": "73905cfe-f297-410f-b240-ff06d70192e7",
   "toProvinceId": "3522ff70-84fc-4065-a8f6-49aa49fe31d5",
   "durationMinutes": 150,
   "status": "active",
   "basePrice": 250000,
   "stops": [
    {
     "name": "Trạm dừng Phủ Lý",
     "sortOrder": 0,
     "offsetMinutes": 70
    }
   ],
   "offices": [
    {
     "officeId": "5710b260-427b-437f-95ac-96b2dc1ccfc9",
     "side": "pickup",
     "offsetMinutes": 0,
     "sortOrder": 0
    }
   ],
   "shuttleEnabled": true,
   "parcelEnabled": true,
   "usefulInfo": "Có mặt tại văn phòng trước giờ xe tới 10 phút. Xe dừng nghỉ 10 phút tại trạm dừng Phủ Lý.",
   "note": null,
   "createdAt": "2026-11-22T12:27:17Z",
   "updatedAt": "2026-11-22T12:27:17Z"
  }
 ],
 "nextCursor": null,
 "total": 2
}
```

### Tỉnh / thành (dùng chung, chỉ đọc)
`GET /provinces`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "73905cfe-f297-410f-b240-ff06d70192e7",
   "name": "Hà Nội",
   "nameNoAccent": "ha noi",
   "sortOrder": 1
  }
 ]
}
```

### 5.2 Các mục còn lại
### Khách hàng
`GET /manage/customers?q=`

Khóa/mở: `POST /manage/customers/{id}/lock|unlock {reason}`. Khách quầy: `GET/POST /admin/guests`.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "e0fef5b5-a3c1-4be8-9bb5-6ecc83b3fef3",
   "email": "thibinh.tran@nhaxevietnam.vn",
   "displayName": "Trần Thị Bình",
   "phone": "0909000222",
   "status": "active",
   "suspendReason": null,
   "adminNote": "",
   "locked": false,
   "lockReason": null,
   "bookings": 3,
   "completedTrips": 0,
   "totalSpent": 250000,
   "kind": "returning",
   "firstBookingAt": "2026-11-22T12:28:18Z",
   "lastBookingAt": "2026-11-22T12:28:20Z",
   "lastLoginAt": null,
   "createdAt": "2026-11-22T12:28:11Z"
  }
 ],
 "nextCursor": null,
 "total": 2
}
```

### Khuyến mãi
`GET /admin/promotions`

**Gửi lên:**
```json
{ "code": "TET2027", "title": "Giảm 50.000đ dịp Tết", "kind": "amount", "value": 50000, "minAmount": 200000, "perUserLimit": 1 }  // kind: "amount" | "percent"
```

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "858559c1-1ebe-4b3a-87f0-89ad756061d2",
   "code": "CHAOBAN",
   "title": "Chào bạn mới",
   "description": "Giảm 10% cho đơn đầu tiên",
   "kind": "percent",
   "value": 10,
   "maxDiscount": null,
   "minAmount": 0,
   "startAt": null,
   "endAt": null,
   "usageLimit": null,
   "perUserLimit": 1,
   "usedCount": 0,
   "audience": "wallet",
   "routeId": null,
   "isActive": true,
   "createdAt": "2026-11-22T12:28:11Z",
   "updatedAt": "2026-11-22T12:28:11Z"
  }
 ],
 "nextCursor": null,
 "total": 2
}
```

### Đánh giá
`GET /manage/reviews`

Trả lời / ẩn / hiện: `POST /manage/reviews/{id}/reply {text}` · `/hide` · `/show`.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [],
 "nextCursor": null,
 "total": 0
}
```

### Thông báo chung
`GET /admin/announcements`

**Gửi lên:**
```json
{ "title": "Chào mừng", "body": "…", "kind": "news", "notify": false }
```

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "a6baeff4-5b46-402b-8cb6-1f333ae95beb",
   "title": "Chào mừng",
   "body": "Nhà xe Việt Nam mở bán vé trên ứng dụng.",
   "kind": "news",
   "routeId": null,
   "startAt": null,
   "endAt": null,
   "isPublished": true,
   "notify": false,
   "createdAt": "2026-11-22T12:28:10Z",
   "updatedAt": "2026-11-22T12:28:10Z"
  }
 ],
 "nextCursor": null,
 "total": 1
}
```

### Loại hàng gửi
`GET /admin/parcel-categories`

Hàng cấm: `GET/POST/DELETE /admin/prohibited-items {text}`.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "items": [
  {
   "id": "76dd5109-1cd8-4c75-9387-eca5185c897a",
   "name": "Giấy tờ",
   "isProhibited": false,
   "note": null,
   "packingNote": null,
   "sortOrder": 0,
   "createdAt": "2026-11-22T12:28:09Z",
   "updatedAt": "2026-11-22T12:28:09Z"
  }
 ],
 "nextCursor": null,
 "total": 5
}
```

### Báo cáo & đối soát
`GET /manage/reports/{kind}?from=&to=`

`kind`: `reconciliation|profit|occupancy|revenue|top|rates|parcels|comps|shuttle|forecast`. Xuất CSV: `GET /manage/export?type=bookings|trips|reconciliation|parcels&from=&to=`.

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "from": "2026-11-16",
 "to": "2026-11-22",
 "note": "figures_recorded_in_app",
 "items": [],
 "totals": {
  "received": 0,
  "byCash": 0,
  "byTransfer": 0,
  "parcelRevenue": 0,
  "refunded": 0,
  "refundPending": 0,
  "approvedUnpaid": 0,
  "comps": 0,
  "net": 0
 }
}
```

### Cấu hình
`GET /admin/settings → PUT /admin/settings/{key}`

`key`: `operator, cancelPolicy, rules, system, shuttle, loyalty, referral, parcel, content`. Gửi một phần, BE gộp vào giá trị cũ.

**Gửi lên:**
```json
// PUT /admin/settings/cancelPolicy
{ "tiers": [{ "hoursBefore": 24, "refundPercent": 100 }, { "hoursBefore": 6, "refundPercent": 70 }, { "hoursBefore": 0, "refundPercent": 0 }], "cancelFee": 10000 }
// PUT /admin/operator (hồ sơ nhà xe)
{ "name": "…", "phone": "…", "address": "…", "openText": "…", "representativeName": "…", "licenseNoText": "…", "taxCode": "…" }
```

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "operator": {
  "name": "Nhà xe Việt Nam Limousine",
  "description": "Limousine 9 chỗ Hà Nội - Thái Bình, xuất bến đúng giờ.",
  "phone": "0347218023",
  "email": "",
  "address": "1 Phạm Hùng, Hà Nội",
  "openText": "05:00 - 21:00 hằng ngày",
  "representativeName": "Nguyễn Văn Hùng",
  "licenseNoText": "0412/GPKDVT-SGTVT",
  "taxCode": "",
  "website": "",
  "updatedAt": "2026-11-22T12:27:15Z"
 },
 "cancelPolicy": {
  "tiers": [
   {
    "hoursBefore": 24,
    "refundPercent": 100
   }
  ],
  "cancelFee": 10000,
  "changeAllowedHoursBefore": 4,
  "changeFee": 0,
  "note": "",
  "updatedAt": "2026-11-22T12:27:15Z"
 },
 "rules": {
  "items": [
   {
    "kind": "luggage",
    "text": "Mỗi khách 1 vali 20kg và 1 túi xách."
   }
  ],
  "updatedAt": "2026-11-22T12:27:15Z"
 },
 "system": {
  "bookingLeadHours": 4,
  "maxSeatsPerBooking": 6,
  "bookDaysAhead": 7,
  "reviewDeadlineMinutes": 30,
  "driverRestMinutes": 60,
  "salesOpenDaysBefore": 7,
  "salesCloseMinutesBefore": 240,
  "lowFillPercent": 30,
  "updatedAt": null
 },
 "shuttle": {
  "registerHoursBefore": 3,
  "feeRefundable": true,
  "note": "",
  "updatedAt": null
 },
 "loyalty": {
  "enabled": true,
  "earnPointsPer10k": 1,
  "tiers": [
   {
    "name": "Thành viên",
    "minPoints": 0,
    "benefitText": ""
   }
  ],
  "updatedAt": null
 },
 "referral": {
  "enabled": false,
  "referrerPromotionId": null,
  "referredPromotionId": null,
  "maxPerReferrer": 20,
  "updatedAt": null
 },
 "parcel": {
  "enabled": true,
  "acceptHoursBefore": 2,
  "unclaimedHours": 24,
  "defaultMaxKg": 100,
  "defaultMaxPieces": 20,
  "maxWeightKgPerOrder": 50,
  "sizeClasses": [
   {
    "code": "small",
    "label": "Nhỏ",
    "maxDimText": "Dưới 30 x 30 x 30 cm"
   }
  ],
  "cancelAfterReceivePercent": 50,
  "maxCompensationMultiple": 5,
  "claimDays": 7,
  "compensationText": "",
  "note": "",
  "updatedAt": null
 },
 "content": {
  "termsVi": "",
  "termsEn": "",
  "privacyVi": "",
  "privacyEn": "",
  "helpVi": "",
  "helpEn": "",
  "aboutVi": "",
  "aboutEn": "",
  "updatedAt": null
 }
}
```

### Hồ sơ nhà xe (công khai)
`GET /operator`

**Trả về** (rút gọn còn 1 phần tử mỗi danh sách):
```json
{
 "profile": {
  "name": "Nhà xe Việt Nam Limousine",
  "description": "Limousine 9 chỗ Hà Nội - Thái Bình, xuất bến đúng giờ.",
  "phone": "0347218023",
  "email": "",
  "address": "1 Phạm Hùng, Hà Nội",
  "openText": "05:00 - 21:00 hằng ngày",
  "representativeName": "Nguyễn Văn Hùng",
  "licenseNoText": "0412/GPKDVT-SGTVT",
  "taxCode": "",
  "website": "",
  "updatedAt": "2026-11-22T12:27:15Z"
 },
 "rating": null,
 "reviewCount": 0,
 "completedTrips": 0,
 "offices": [
  {
   "provinceId": "73905cfe-f297-410f-b240-ff06d70192e7",
   "provinceName": "Hà Nội",
   "offices": [
    {
     "id": "cfab54ca-6be8-403d-b6ee-7aee736172d1",
     "provinceId": "73905cfe-f297-410f-b240-ff06d70192e7",
     "name": "VP Giáp Bát",
     "address": "897 Giải Phóng, Hoàng Mai",
     "phone": "0242222222",
     "openText": "05:00 - 21:00",
     "directionNote": "",
     "isActive": true
    }
   ]
  }
 ],
 "rules": [
  {
   "kind": "luggage",
   "text": "Mỗi khách 1 vali 20kg và 1 túi xách."
  }
 ],
 "cancelPolicy": {
  "tiers": [
   {
    "hoursBefore": 24,
    "refundPercent": 100
   }
  ],
  "cancelFee": 10000,
  "changeAllowedHoursBefore": 4,
  "changeFee": 0,
  "note": ""
 },
 "shuttleRule": {
  "registerHoursBefore": 3,
  "feeRefundable": true,
  "note": "",
  "updatedAt": null
 },
 "parcel": {
  "enabled": true,
  "compensationText": "",
  "claimDays": 7
 }
}
```


---

## 6. Trạng thái và quy tắc FE cần biết
* **Đơn:** `pending` (chờ duyệt, ghế đang giữ) → `confirmed` (đã duyệt; `paid=false` = chờ thu tiền, `paid=true` = đã thu) → `completed`; nhánh phụ `rejected`, `cancel_requested`, `cancelled`.
* **Ghế:** `free | pending | sold | locked`. **Chuyến:** `scheduled | running | completed | cancelled`; trạng thái bán `open | sold_out | closed`.
* **Đặt lúc nào cũng được** (không chốt giờ, không giới hạn ngày; chỉ chặn khi chuyến đã hủy/đang chạy/đã chạy xong hoặc chủ nhà xe đóng bán → `409 trip_not_on_sale`); tối đa 6 ghế/đơn (`400 too_many_seats`); ghế bị người khác giữ (`409 seat_conflict`).
* **Hủy:** đơn chưa thu tiền hủy ngay, không hoàn; đơn đã thu tiền → `cancel_requested` rồi nhà xe duyệt/từ chối; hoàn = phần trăm theo khung giờ trừ phí hủy (chỉ ghi nhận, không chuyển tiền).
* **Đón trả tận nơi:** mỗi đơn có `pickup` và `drop` = `{ address, note, lat?, lng? }` (**bắt buộc** khi tạo đơn, thiếu → `400 validation_failed`, field `pickup.address` / `drop.address`; cũng nhận `pickupAddress`/`dropAddress` dạng chuỗi). Địa chỉ có trong chi tiết đơn, danh sách đơn, `GET /manage/trips/{id}/manifest` (`pickup`, `drop` trên từng hành khách), tìm kiếm và nội dung chia sẻ. Không tính thêm phí đón trả.
* **Không còn văn phòng:** chuyến chỉ là "từ đâu đến đâu" kèm tên chuyến; đơn, bưu kiện không có điểm lên/xuống theo văn phòng (`pickupOffice`, `dropOffice` = `null`). Các API văn phòng/trung chuyển cũ vẫn tồn tại nhưng app không dùng.
* **Doanh thu** cộng theo **ngày xác nhận thu tiền** (`collect`), không theo ngày đặt hay ngày chạy.
* Lỗi luôn dạng `{ code, message, fields?, requestId }`; `403 forbidden` nếu thiếu quyền, `404 not_found` nếu dữ liệu thuộc nhà xe khác.
