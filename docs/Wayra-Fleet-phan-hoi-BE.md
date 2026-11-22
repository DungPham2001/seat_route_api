# Wayra Fleet — phản hồi của BE

Trả lời `Wayra-Fleet-yeu-cau-BE.md`. Base URL giữ nguyên `https://seatrouteapi.vercel.app/v1`. Schema chi tiết theo `API-cho-FE.md`.

| Mục | Trạng thái | Nội dung |
|---|---|---|
| 2.1 Quyền sau đăng ký | ✅ Xong | `POST /auth/register` mặc định tạo tài khoản `role: "admin"`, vào thẳng `/manage/*` và `/admin/*`, không còn `403`. Tài khoản hành khách chỉ tạo khi gửi `accountType: "customer"` |
| 2.2 Một hay nhiều nhà xe | ✅ **Nhiều nhà xe** | Mỗi tài khoản đăng ký là một nhà xe riêng; xe, tuyến, văn phòng, nhân sự, chuyến, đơn, bưu kiện, khuyến mãi, cài đặt, báo cáo đều tách theo nhà xe (lấy ngầm từ token, app không gửi tham số). Nhà xe khác truy cập → `404`. Biển số, tên văn phòng, mã khuyến mãi chỉ cần duy nhất **trong nhà xe**. Tỉnh/thành dùng chung, **chỉ đọc**. Không có bước duyệt tài khoản |
| 2.3 `recentBookings` | ✅ Xong | Mỗi phần tử: `customer {displayName, phone}` (đặt hộ thì lấy tên/SĐT khách quầy), `passengers [{name, seat}]`, `routeName`, `departAt`, `paid`, `trip` luôn là object `{ id, route: {id, name}, departAt… }` |
| 2.4 Danh sách đơn kèm tên khách | ✅ Đã có | `GET /manage/bookings` và `/manage/inbox` trả `customer {displayName, phone}` hoặc `guest {name, phone}` |
| 2.5 `topHours` | ✅ Xong | Trả đủ mọi giờ có chuyến trong kỳ, giờ chưa bán được có `seats: 0` |
| 2.6 Gom theo vùng | ⏳ Chưa làm | Cần chốt danh sách cụm. Khi cần: thêm `region` vào `provinces`/`routes` và lọc `region` ở `/manage/trips`, `/manage/revenue` |
| 2.7 Dọn dẹp | Giữ nguyên | `/admin/admins*` vẫn có, nay chỉ liệt kê/quản lý quản trị viên **cùng nhà xe** |
| 2.8.3 Trường riêng nhà xe | ✅ Xong | Đăng ký nhận thêm `companyName` (mặc định = `displayName`), `address`, `taxCode`; nằm trong `GET /operator` → `profile` |
| 2.8.4 URL Google Play | Giữ | `/privacy`, `/account/delete` giữ nguyên URL |

## Khi đăng ký, nhà xe mới có sẵn
* Hồ sơ nhà xe (tên, SĐT, email, địa chỉ, mã số thuế).
* 3 mẫu sơ đồ ghế (limousine 9 và 11 chỗ, xe 16 chỗ) để chọn khi tạo xe.
* Loại hàng gửi, danh sách hàng cấm, checklist chuyến mẫu.
* **Chưa có**: văn phòng, tuyến, xe, tài xế, chuyến, bảng giá. Chủ nhà xe tự nhập.

## Lưu ý cho app
* Xóa tài khoản (`DELETE /me`) của chủ nhà xe cuối cùng sẽ **xóa toàn bộ dữ liệu nhà xe**. Nên cảnh báo rõ trước khi gọi.
* `accountType: "customer"` chỉ dành cho app hành khách cũ; Wayra Fleet không cần gửi.
* Các endpoint hành khách (`/trips`, `POST /bookings`…) vẫn chạy trên nhà xe mặc định (hoặc header `X-Operator-Id`).

## Kiểm thử gợi ý (bổ sung mục 5 của app)
1. Đăng ký hai tài khoản A, B → mỗi tài khoản tạo xe/tuyến riêng; A không thấy dữ liệu của B.
2. Tạo cùng biển số ở A và B → cả hai đều thành công; trùng trong cùng một nhà xe → `409 duplicate`.
3. Đăng ký tài khoản mới → mở 4 tab: không còn `403`, danh sách rỗng, chỉ có sẵn 3 mẫu sơ đồ ghế.

## Cập nhật 2026-11-22: chuyến theo tên, đón trả tận nơi, bỏ văn phòng
* **Chuyến:** `POST /manage/trips { name?, fromProvinceId, toProvinceId, durationMinutes?, date, departTime, vehicleId, basePrice }`. Không cần tuyến, không cần văn phòng. Tên chuyến hiện ở danh sách, chi tiết, đơn, dashboard (`name`; không đặt tên thì là "Từ → Đến").
* **Đặt vé:** chọn chuyến, nhập `pickup.address` và `drop.address` (bắt buộc), ghi chú, tọa độ tùy chọn. Đổi địa chỉ bằng `PATCH /bookings/{id}/places`.
* **Danh sách hành khách của chuyến** (`/manage/trips/{id}/manifest`) có `pickup`, `drop` từng người để tài xế đi đón.
* Mục Văn phòng và Vùng trung chuyển không còn trong app; API cũ còn nhưng không dùng.
* **Đặt vé lúc nào cũng được:** bỏ chốt 4 giờ trước giờ chạy và giới hạn 7 ngày. Chỉ chặn khi chuyến đã hủy / đang chạy / đã xong, hoặc chủ nhà xe đóng bán (`salesClosed`, lỗi `409 trip_not_on_sale`). Không còn `booking_closed`.

## Cập nhật 2026-11-22: bỏ hành khách, chỉ còn chủ nhà xe
* Đăng ký chỉ tạo nhà xe. Tài khoản hành khách cũ không đăng nhập được nữa (`403`). Các API phía khách trả `404` (bật lại bằng biến môi trường `CUSTOMERS_ENABLED=1` nếu cần).
* **Đặt hộ khách:** `POST /manage/bookings { tripId, pickup, drop, seats, guest:{name,phone}, payMethod? }`. Có `payMethod` → đã thu tiền ngay. **Không có `payMethod`** → đặt trước, thu sau: đơn `confirmed`, `paid:false`, hiện ở mục "Chờ thu tiền", thu bằng `POST /manage/bookings/{id}/collect { method }`.
* Đơn do chủ nhà xe tạo nên không còn đơn "chờ duyệt" hay "yêu cầu hủy" mới; các màn đó có thể trống.
