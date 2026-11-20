# SeatRoute — Tài liệu chức năng cho Backend

> Bản tổng hợp theo **app hiện tại** (Flutter). Hiện app chạy bằng bộ nhớ giả (`AppStore` + dữ liệu mẫu), chưa gọi máy chủ thật. Tài liệu này mô tả đúng những gì app làm để BE dựng API và CSDL khớp.
> Tài liệu gốc `SeatRoute-mo-ta.md` vẫn là bản mô tả ban đầu; **mục 1 liệt kê những chỗ app đã khác nó (bổ sung / xoá / đổi)**. Khi hai tài liệu mâu thuẫn, lấy tài liệu này.

---

## 1. Thay đổi so với bản mô tả ban đầu

### 1.1 ĐÃ XOÁ (BE không cần làm)

| Chức năng cũ | Ghi chú |
|---|---|
| Thanh toán trong app: QR VietQR, số tài khoản nhà xe, màn hình chuyển khoản | Khách **thanh toán tại quầy**. Không có thông tin ngân hàng trong app. |
| Tải ảnh chứng từ chuyển khoản (camera / thư viện), `PaymentProof`, `FileObject` cho chứng từ | Không còn upload ảnh nào. App không xin quyền camera / ảnh. |
| Quy tắc "chuyển khoản trước có chỗ trước", mất ghế, xử lý đơn mất ghế (đổi ghế / đổi chuyến / hoàn 100%) | Thay bằng **giữ ghế ngay khi đặt** (mục 3.2). |
| Trạng thái đơn: chờ chuyển khoản, cần bổ sung chứng từ, mất ghế, hết hạn | Còn 6 trạng thái (mục 4.1). |
| Hạn gửi chứng từ (`payDeadline`), dọn đơn hết hạn, số người đang chọn ghế | Không còn. |
| Cảnh báo nghi trùng ảnh (hash), lưu giữ ảnh, dung lượng ảnh tối đa, `BankCatalog`, `BankInfo`, `bankSnapshotJson` | Không còn. |
| Chứng từ cước gửi đồ + hàng đợi xác nhận chứng từ gửi đồ | Gửi đồ: mang hàng tới quầy, trả cước tại quầy. |
| Dữ liệu lưu sẵn của khách: hành khách đi cùng, địa chỉ trung chuyển, sổ người nhận, tài khoản nhận hoàn, liên hệ khẩn cấp, sở thích & tuyến yêu thích (`SavedPassenger`, `SavedAddress`, `SavedReceiver`, `RefundAccount`, `EmergencyContact`, `UserPreference`) | Xoá cả bảng lẫn API `/me/passengers`, `/me/addresses`, `/me/receivers`, `/me/refund-account`, `/me/emergency`, `/me/preferences`. |
| Máy tính giá nhanh | Giá chỉ xem trên form đặt vé. |
| Màn "Thanh toán & mã QR" của admin | Bỏ. |
| Nhập thông tin riêng từng ghế, đánh dấu trẻ em giảm 25%, ô ghi chú cho nhà xe (luồng khách) | Đơn dùng tên + SĐT của tài khoản cho mọi ghế; giá ghế = giá chuyến (+ phụ thu). |

### 1.2 ĐÃ BỔ SUNG (BE cần làm thêm)

| Chức năng mới | Mục |
|---|---|
| Duyệt đơn bởi admin (thay cho duyệt chứng từ): `approve` / `reject` | 3.2, 8 |
| Giữ ghế nguyên tử ngay khi tạo đơn | 3.2 |
| **Chốt đặt trước giờ chạy 4 giờ** (khách **và** đặt hộ tại quầy) | 3.1 |
| Đặt vé 1 form + xác nhận 1 lần; xe trung chuyển **tùy chọn** (đón tại nhà / trả tận nơi, nhập địa chỉ) | 3.3, 5 |
| CRUD đầy đủ: xe (limo 9/11/16 chỗ hoặc sơ đồ tự dựng, xe trung chuyển), chuyến (sửa / xoá), tuyến, văn phòng, khu vực trung chuyển, nhân viên / tài xế, khuyến mãi, khách hàng (admin tạo / sửa / khoá / xoá), khách tại quầy | 6, 7 |
| Quy tắc **chặn xoá** khi dữ liệu đã được dùng, thay bằng tắt hoạt động | 6.2 |
| Trang **Đơn hàng** của admin (tìm, lọc trạng thái) | 6 |
| Trang **Doanh thu** + biểu đồ (xu hướng, theo nguồn, theo tuyến, theo thứ) | 6, 9 |
| Phụ thu ghế theo xe (hàng đầu / VIP) | 7 |
| Đăng nhập bằng email **hoặc** SĐT; email không bắt buộc; ghi nhớ đăng nhập (phía app) | 2 |
| Đặt lại mật khẩu cho khách do admin thực hiện | 2, 6 |
| Tên xe (dòng xe) tách khỏi loại xe | 7 |

### 1.3 ĐÃ ĐỔI

| Mục | Cũ | Mới |
|---|---|---|
| Thời điểm giữ ghế | Khi gửi ảnh chứng từ | Khi tạo đơn |
| Người duyệt | Admin duyệt chứng từ | Admin duyệt đơn |
| Doanh thu | Theo chứng từ đã xác nhận | Theo đơn đã duyệt + bán tại quầy + cước gửi đồ (mục 9) |
| Sơ đồ ghế | Suy từ số chỗ | Lưu theo từng xe, chuyến sao chép lúc tạo (mục 3.5) |
| Đơn đã duyệt mà huỷ | Hoàn theo mốc | Vẫn có mốc + phí huỷ; chỉ **ghi nhận** hoàn, không có tài khoản nhận hoàn |
| Cước gửi đồ | Chứng từ ảnh | Trả tại quầy; nhà xe chuyển trạng thái "đã nhận hàng" |

---

## 2. Vai trò và xác thực

- **Hai vai trò:** `customer`, `admin`. Tài xế / nhân viên chỉ là hồ sơ, **không có tài khoản**.
- **Đăng nhập:** `identifier` là **email hoặc SĐT** + mật khẩu. SĐT chuẩn hoá về dạng `0xxxxxxxxx` (bỏ khoảng trắng, `+84` → `0`). Phiên chỉ giữ trong bộ nhớ app; app có thể lưu mật khẩu mã hoá trên máy khi khách chọn "Ghi nhớ" (không liên quan BE).
- **Đăng ký:** họ tên, SĐT (bắt buộc, duy nhất), email (tuỳ chọn, duy nhất nếu có), mật khẩu ≥ 8 ký tự có hoa / thường / số, nhập lại mật khẩu. Tài khoản mới: có sẵn mã `CHAOBAN` (giảm 10%) trong ví, tạo mã giới thiệu `SR…`.
- **Admin tạo khách:** cùng ràng buộc; admin đặt mật khẩu ban đầu và có thể đặt lại sau (ô để trống = giữ nguyên).
- **Không ép đổi mật khẩu lần đầu.** Đổi mật khẩu tuỳ ý trong Hồ sơ.
- **Quên mật khẩu:** email → gửi liên kết; chỉ có SĐT → tạo tin trong hộp thư liên hệ của admin ("gọi lại để xác minh và cấp mật khẩu tạm").
- **Khoá tài khoản:** `locked` + `lockReason`; khách bị khoá không đăng nhập được (`account_locked`).
- **Xoá tài khoản (khách tự xoá):** cần mật khẩu; chặn nếu còn đơn đang hoạt động (`has_active_orders`); admin cuối cùng không tự xoá được (`last_admin`).
- **Thiết bị đã đăng nhập:** danh sách tên máy + lần cuối; đổi mật khẩu thì đăng xuất các thiết bị khác.
- **Tài khoản demo trong app (chỉ dev):** `khach@seatroute.vn` / `Khach@123`, `admin@seatroute.vn` / `Admin@123`. **Không** đưa vào môi trường thật.

---

## 3. Quy tắc nghiệp vụ

### 3.1 Cửa sổ đặt vé
- Chỉ bán chuyến có `departAt > now + 4 giờ` (hằng số `bookingLeadHours = 4`, nên cấu hình được).
- Áp dụng cho **cả khách và đặt hộ tại quầy**. Quá giờ → `booking_closed`.
- Khách đặt được tối đa **7 ngày** tới; tối đa **6 ghế / đơn**.
- Chuyến không hiện trong tìm kiếm nếu: sai tuyến / ngày, đã `cancelled`, hoặc trong khung 4 giờ.
- Tuyến có chiều: Hà Nội → Thái Bình và ngược lại là hai tuyến. Chỉ tuyến `active` mới tìm được.

### 3.2 Đặt vé, giữ ghế, duyệt
1. Khách tạo đơn (`POST /bookings`). BE trong **một giao dịch**: kiểm tra `tripOpenForSale`, kiểm tra **mọi ghế đều `free`**, đặt ghế sang `pending`, tạo đơn `pending`. Một ghế không `free` → `seat_conflict`, **không tạo gì**.
2. Ghế `pending` **không chọn được** với người khác (app hiện "Đã đặt · chờ duyệt").
3. Admin **duyệt** → đơn `confirmed`, ghế `sold`, ghi `confirmedAt`, cộng điểm (`total / 10000`), gửi thông báo "cần thanh toán tại quầy".
4. Admin **từ chối** (lý do bắt buộc) → đơn `rejected`, ghế về `free`, thông báo kèm lý do. `rejected` là trạng thái cuối; khách đặt lại đơn mới.
5. Khách **huỷ đơn `pending`** → `cancelled` ngay, nhả ghế, không hoàn gì.
6. Khách **huỷ đơn `confirmed`** (còn trước giờ chạy) → `cancelRequested`; admin **duyệt huỷ** → `cancelled`, nhả ghế, ghi nhận hoàn theo mốc (3.6).
7. Mã giảm giá: tăng `used` cùng giao dịch tạo đơn.
8. Giá **chốt tại lúc đặt** (`price`, `surcharge` mỗi ghế lưu vào đơn).

### 3.3 Form đặt vé của khách (1 form + 1 màn xác nhận)
Bước 1 (một form): **tuyến + ngày** → **giờ chạy** (chọn 1 chuyến) → **ghế** → **văn phòng lên / xuống** (chỉ hỏi khi tuyến có > 1 văn phòng ở phía đó; chỉ có 1 thì tự lấy; không chọn sẵn khi có nhiều) → **xe trung chuyển (tuỳ chọn)**.
Bước 2 (xác nhận): tóm tắt, mã giảm giá (tuỳ chọn), bảng giá, nút **Đặt vé**. Thành công → màn "Đã đặt ghế X" (mã đơn, chuyến, văn phòng, số tiền trả tại quầy).

Request tạo đơn:
```json
{ "tripId": "...", "seats": ["A1","B2"],
  "pickupOfficeId": "...", "dropOfficeId": "...",
  "pickupShuttle": { "zoneId": "...", "address": "..." },   // tuỳ chọn
  "dropShuttle":   { "zoneId": "...", "address": "..." },   // tuỳ chọn
  "promoCode": "CHAOBAN" }                                  // tuỳ chọn
```
Tên + SĐT của mọi ghế lấy từ tài khoản. Cần `Idempotency-Key`.

### 3.4 Xe trung chuyển (tuỳ chọn khi đặt)
- Hai chiều độc lập: **đón tại nhà → văn phòng lên xe** và **văn phòng xuống xe → nơi khách muốn dừng**. Mỗi chiều: chọn **khu vực** (`ShuttleZone`, có phí) + **địa chỉ chữ** (bắt buộc khi bật).
- Điều kiện: tuyến `shuttleEnabled`; khu vực thuộc đúng văn phòng đã chọn và bật chiều tương ứng (`pickup` / `drop`); còn trước giờ chạy ≥ `shuttleCutoffHours` (mặc định 3).
- Phí lưu vào đơn tại lúc đặt (`ShuttleReq.fee`) và cộng vào tổng. Phí trả tại quầy cùng tiền vé.
- Giờ đón dự kiến = giờ xe tới văn phòng − `leadMinutes` của khu vực; giờ trả = giờ tới văn phòng + `leadMinutes`.
- Không dùng GPS / bản đồ; địa chỉ chỉ là chữ, là dữ liệu cá nhân (chỉ khách + admin xem).
- Admin thấy danh sách trung chuyển theo chuyến (tab "Trung chuyển").

### 3.5 Xe, sơ đồ ghế, chuyến
- Xe có `type`: `limo` (có sơ đồ ghế, chạy tuyến) hoặc `shuttle` (chỉ có **sức chứa**, không bán ghế, **không gán vào chuyến**).
- Limo: sơ đồ chọn mẫu **9 / 11 / 16 chỗ** hoặc **tự dựng** (2–7 hàng × 2–4 cột; ô (0,0) là chỗ tài xế, không bán; nhãn đánh số theo hàng A1, A2, B1…; hạng ghế `standard` / `front` / `vip`; tối thiểu 2 ghế bán). `seatCount` = số ghế bán + 1.
- Phụ thu theo xe: `frontSurcharge`, `vipSurcharge` (mặc định 30.000 / 60.000).
- **Tạo chuyến sao chép** sơ đồ và phụ thu của xe tại thời điểm tạo. **Sửa xe sau đó không đổi chuyến đã tạo.**
- Đổi xe của chuyến: chỉ sang xe **cùng sơ đồ** (so từng ghế: nhãn, hàng, cột, hạng). Tài xế: gợi ý / rảnh / trùng lịch / nghỉ.
- Tạo chuyến: tuyến, xe (chỉ limo `active`), tài xế (tuỳ chọn), ngày giờ, giá ghế thường; có thể **lặp theo thứ trong tuần, sinh 4 tuần** (bỏ qua ngày trùng xe).
- **Kiểm tra trùng lịch** xe / tài xế: `startA < endB && startB < endA`, giờ kết thúc = khởi hành + thời gian chạy + 60 phút nghỉ; có thể ghi đè có xác nhận.
- Trạng thái chuyến: `onSale`, `full`, `closed` (đóng bán), `running`, `done`, `cancelled`.
- Sửa chuyến (giờ / xe cùng sơ đồ / tài xế / giá): chỉ khi `onSale` hoặc `closed`; đổi giờ thì **thông báo tất cả khách đã đặt**. Không đổi được tuyến.
- Đổi giá chuyến không ảnh hưởng đơn cũ.
- Huỷ chuyến: chuyển các đơn đang hoạt động sang `cancelRequested` + thông báo + lý do.
- Ghế `locked` do admin khoá (không bán).

### 3.6 Huỷ và hoàn
- Mốc huỷ mặc định (`cancelTiers`, giờ trước khởi hành → % hoàn): `≥24h: 100%`, `≥6h: 70%`, `≥2h: 50%`, `<2h: 0%`. Phí huỷ cố định `cancelFee` (mặc định 10.000).
- Chỉ đơn `confirmed` mới có hoàn: `refund = max(0, total × % − cancelFee)`. Đơn `pending` huỷ không phí, không hoàn.
- Hoàn tiền **chỉ ghi nhận** (`refunded`), BE/app không chuyển tiền.
- Admin có thể đổi ghế / chuyển chuyến cho đơn đã duyệt (không còn luồng "mất ghế").

### 3.7 Thanh toán
- **Không có thanh toán online.** Khách trả tiền mặt / chuyển trực tiếp **tại quầy** sau khi đơn được duyệt.
- Đặt hộ tại quầy (admin): đơn tạo ra là `confirmed` ngay, `source = counter`, `payMethod ∈ {cash, directTransfer, free}`; `free` bắt buộc `compReason` và **không tính doanh thu**. Không có "chưa thu" / ghi nợ.

### 3.7b Gửi đồ
- Khách tạo yêu cầu (tuyến, văn phòng gửi / nhận, ngày, người gửi / nhận, loại hàng, mô tả, số kiện, cân nặng, cỡ, giá trị khai báo). Báo giá:
  `cước = cơ bản theo cỡ (nhỏ 30k / vừa 50k / lớn 80k) + phụ 5.000đ mỗi kg vượt ngưỡng (5 / 15 / 30 kg) + 1% giá trị khai báo`.
- Trạng thái: `pending` → `accepted` (admin chấp nhận, gán chuyến, chỉnh cước, kiểm tra tải chuyến `parcelMaxKg`) → **`received`** (khách mang hàng tới quầy, trả cước, nhà xe nhận) → `onboard` → `arrived` → `delivered` (nhập **mã nhận hàng** 6 số). Nhánh phụ: `cancelled`, `rejected`, `issue`. (Giá trị `paid` còn trong enum nhưng app **không dùng**; doanh thu tính từ `received` trở đi.)
- Khách chỉ huỷ được trước `received`, không phí.
- Admin cũng nhận gửi đồ hộ tại quầy (vào thẳng `received`).
- Không thu hộ (COD), không ghi nợ.

---

## 4. Máy trạng thái

### 4.1 Đơn đặt vé (`BookingStatus`)
```
            tạo đơn
               │
            pending ──approve──▶ confirmed ──(chuyến xong)──▶ completed
               │  │                  │
               │  └─reject──▶ rejected│ (khách huỷ)
               │                      ▼
       (khách huỷ)             cancelRequested ──approve──▶ cancelled
               ▼
           cancelled
```
- Đặt hộ tại quầy: vào thẳng `confirmed`.
- `isActive` = `pending`, `confirmed`, `rejected`, `cancelRequested` (dùng để chặn xoá tài khoản / chuyến).

### 4.2 Ghế trên chuyến (`SeatState`)
`free` → (tạo đơn) `pending` → (duyệt) `sold`; `rejected` / `cancelled` → `free`; admin `locked` ↔ `free`.

### 4.3 Chuyến (`TripStatus`) — mục 3.5. Khi ghi `depart` → `running`; `arrive` → `done` và đơn `confirmed` → `completed`.

### 4.4 Gửi đồ (`ParcelStatus`) — mục 3.7b.

---

## 5. Chức năng phía khách hàng

**Onboarding** (chỉ lần đầu cài; cờ ở máy) → Splash → Đăng nhập / Đăng ký.

**Tab Trang chủ:** chào + nút tìm chuyến; thẻ "Chuyến sắp tới" (đếm ngược, văn phòng, giờ, ghế, trạng thái); "Cần làm ngay" (đơn chờ duyệt / bị từ chối); đơn gửi đồ đang đi; lưới Dịch vụ (Gửi đồ, Vé của tôi, Nhà xe); gợi ý chuyến hay đi; "Đặt nhanh" theo tuyến gần đây; chờ đánh giá; khuyến mãi; tin nhà xe; văn phòng nhà xe.

**Tab Thông báo:** theo nhóm (đơn, chuyến, gửi đồ, khuyến mãi, hệ thống), đánh dấu đã đọc, bấm mở đơn / chuyến liên quan. Không có push; app tự làm mới khi mở.

**Tab Đặt chuyến:** chuyển giữa "Đặt ghế" và "Gửi đồ". Đặt ghế theo 3.3. Có danh sách chờ khi chuyến hết chỗ (`Waitlist`).

**Vé của tôi:** tab Chờ duyệt / Sắp đi / Đã đi / Đã huỷ (gồm từ chối); tìm theo mã / tên / tuyến. Chi tiết vé: trạng thái, hành trình, ghế, trung chuyển (sửa địa chỉ / bỏ trước hạn), tin nhắn với nhà xe (chỉ chữ), lịch sử xử lý, huỷ, chia sẻ, đặt lại, đánh giá, khiếu nại.

**Gửi đồ:** tạo yêu cầu, theo dõi mốc, mã nhận hàng, huỷ, báo sự cố, danh sách đang xử lý / đã giao / đã huỷ.

**Hồ sơ:** sửa thông tin (tên, SĐT, ngày sinh, giới tính, màu avatar); lịch sử & thống kê; huỷ / đổi / hoàn; danh sách chờ; điểm & hạng; ví mã; giới thiệu bạn bè; đánh giá của tôi; khiếu nại của tôi; liên hệ nhà xe; Trợ giúp & FAQ; cài đặt (ngôn ngữ, giao diện sáng / tối, cỡ chữ, nhận tin khuyến mãi / tin nhà xe); đổi mật khẩu; thiết bị; quyền riêng tư & dữ liệu; giới thiệu app; điều khoản; xoá tài khoản.

**Điểm & hạng:** `+ total/10000` điểm mỗi đơn được duyệt; hạng Thành viên → Bạc (≥80) → Vàng (≥200) → Kim cương (≥500). Không quy đổi tiền.

---

## 6. Chức năng phía quản trị

Tab: **Tổng quan · Cần xác nhận · Chuyến · Quản lý · Tài khoản**.

| Khu vực | Chức năng |
|---|---|
| Tổng quan | Doanh thu (hôm nay / 7 / 30 ngày, so kỳ trước), biểu đồ xu hướng + cột chồng theo nguồn, doanh thu theo nguồn (app / quầy / gửi đồ), chuyến hôm nay, tải, cảnh báo (giấy tờ xe, bằng lái, chuyến thiếu tài xế…), nút đặt hộ |
| Cần xác nhận | Hàng đợi: **Đơn chờ duyệt** (cũ nhất trước, đánh dấu quá hạn theo `reviewDeadlineMinutes`, duyệt hàng loạt), Huỷ & đổi, Gửi đồ, Khiếu nại / báo cáo / hộp thư. Lọc theo ngày chạy |
| Chi tiết đơn | Khách, chuyến, ghế, nguồn, số tiền thanh toán tại quầy; Duyệt & xếp chỗ / Từ chối; đổi ghế; duyệt huỷ + ghi nhận hoàn; ghi chú nội bộ; lịch sử; tin nhắn |
| Chuyến | Danh sách + lọc; chi tiết chuyến (ghế có tên người đặt, khách, trung chuyển, hàng, vận hành); khoá ghế; **đặt hộ ngay trên ghế**; đóng / mở bán; gửi danh sách cho tài xế; thông báo cả chuyến; đổi giá; xuất bến / đến bến / báo trễ; điểm danh; checklist; **sửa / xoá chuyến**; huỷ chuyến |
| Đặt hộ (quầy) | Chọn chuyến (hoặc từ trang chuyến), ghế, văn phòng, khách (gợi ý theo SĐT), thu tiền (tiền mặt / chuyển trực tiếp / miễn phí + lý do) |
| Đơn hàng | Toàn bộ đơn, tìm (mã / tên / SĐT / tuyến), lọc Chờ duyệt / Đã duyệt / Đã đi / Huỷ-từ chối |
| Doanh thu | 5 biểu đồ (mục 9) |
| Quản lý | Xe, nhân viên & tài xế, tuyến & trung chuyển, văn phòng, gửi đồ (cước, hàng cấm), chính sách, khách hàng, khuyến mãi, đánh giá, thông báo chung, đối soát & báo cáo |
| Tài khoản | Tìm kiếm chung (đơn, tài khoản, gửi đồ), cấu hình, quản trị viên, xuất CSV đơn |

### 6.1 CRUD

| Đối tượng | Tạo / Sửa | Xoá |
|---|---|---|
| Xe | Loại, biển số (duy nhất, viết hoa), tên xe, năm, màu, sơ đồ, phụ thu, tiện ích, hạn đăng kiểm / bảo hiểm, tài xế mặc định, trạng thái (`active` / `maintenance` / `retired`), ghi chú | Có (6.2) |
| Chuyến | 3.5 | Có (6.2) |
| Tuyến | Điểm đi / đến (không đổi sau khi tạo; không trùng), thời gian chạy (30–1440 phút), văn phòng lên / xuống + **độ lệch phút**, bật trung chuyển / gửi đồ / mở bán, ghi chú; nhân bản chiều ngược | Có (6.2) |
| Văn phòng | Tỉnh (không đổi), tên, địa chỉ, SĐT, giờ mở cửa, chỉ đường, hoạt động | Có (6.2) |
| Khu vực trung chuyển | Tên, phí, phút đón trước, bật đón / trả | Có (6.2) |
| Nhân viên / tài xế | Vai trò (không đổi), tên, SĐT, chức vụ, văn phòng, hạng bằng, hạn bằng, tiền công / chuyến, đang làm việc, nghỉ hôm nay | Có (6.2) |
| Khuyến mãi | Mã (**không đổi**, duy nhất, ≥4 ký tự chữ-số), tên, loại % / số tiền, giá trị, giảm tối đa, đơn tối thiểu, số lượt, hạn | Có (6.2) |
| Khách hàng (tài khoản) | Tên, SĐT, email, đặt lại mật khẩu, khoá + lý do | Có (6.2) |
| Khách tại quầy | Tên, SĐT (duy nhất trong danh bạ), ghi chú | Có, tự do |
| Thông báo chung | Soạn → gửi tới mọi khách + hiện ở Trang chủ | Không (chỉ gửi) |
| Đánh giá | Trả lời, ẩn | Có (admin xoá đánh giá vi phạm) |

### 6.2 Quy tắc chặn xoá (BE phải kiểm tra)

| Đối tượng | Không xoá được khi… | Thay bằng |
|---|---|---|
| Chuyến | Đang `running`, hoặc có đơn **không** ở trạng thái `cancelled` / `rejected` | Huỷ chuyến |
| Xe | Đã được gán vào bất kỳ chuyến nào | `retired` |
| Tuyến | Có bất kỳ chuyến nào (kể cả cũ) | Tắt mở bán |
| Văn phòng | Nằm trong lộ trình tuyến, hoặc có đơn dùng làm điểm lên / xuống, hoặc có nhân viên được gán | Tắt hoạt động. Xoá được thì **xoá luôn các khu vực trung chuyển của nó** |
| Khu vực trung chuyển | Có đơn dùng | Tắt đón + trả |
| Nhân viên / tài xế | Đã được xếp vào chuyến | Cho nghỉ việc. Xoá được thì gỡ khỏi "tài xế mặc định" của các xe |
| Khuyến mãi | `used > 0` hoặc có đơn dùng mã | Kết thúc ngay (`endAt = now`). Xoá được thì gỡ khỏi mọi ví mã |
| Khách hàng | Có bất kỳ đơn nào | Khoá. Xoá được thì xoá luôn ví mã, điểm, mã giới thiệu, thông báo, thiết bị |

Mã định danh tạo mới phải **không tái dùng** sau khi xoá (dùng UUID).

---

## 7. Mô hình dữ liệu đề xuất

Tiền: số nguyên đồng. Thời điểm lưu kèm múi giờ. Khoá chính UUID. Mọi bảng có `createdAt`, `updatedAt`. **Một nhà xe**, không có `businessId`.

```
Account(id, email?, phone UNIQUE, passwordHash, name, role[customer|admin], avatarHue, birthday?, gender?,
        referralCode, locked, lockReason?)
Device(id, accountId, name, lastSeenAt)

OperatorProfile(name, description, phone, address, openText, licenseNo)        // 1 dòng
Setting(reviewDeadlineMinutes=30, shuttleCutoffHours=3, parcelUnclaimedHours=24,
        bookingLeadHours=4, cancelFee=10000)
CancelTier(hoursBefore, percent)
OperatorRule(text vi/en), ParcelCategory(name), ProhibitedItem(text), FaqItem(question vi/en, answer vi/en)

Province(id, name, nameNoAccent)
Office(id, provinceId, name, address, phone, openText, directionNote, active)
ShuttleZone(id, officeId, name, fee, leadMinutes, pickup, drop)

Vehicle(id, type[limo|shuttle], plate UNIQUE, name?, kind, seatCount, year, color, status, amenities[],
        inspectionDue, insuranceDue, defaultDriverId?, note, frontSurcharge, vipSurcharge)
VehicleSeat(vehicleId, label, row, col, seatClass[standard|front|vip])          // chỉ limo; ô (0,0) là tài xế, không lưu

Staff(id, kind[limoDriver|shuttleDriver|office], name, phone, position, officeId?, licenseClass?,
      licenseExpires?, active, offToday, wagePerTrip)

Route(id, fromProvinceId, toProvinceId, durationMinutes, active, parcelEnabled, shuttleEnabled, info)
RouteOffice(routeId, officeId, side[board|alight], offsetMinutes)               // UNIQUE(routeId, officeId, side)

Trip(id, routeId, vehicleId, driverId?, departAt, basePrice, frontSurcharge, vipSurcharge, status,
     parcelMaxKg, parcelMaxPieces, actualDepart?, actualArrive?)
TripSeat(tripId, label, row, col, seatClass, state[free|pending|sold|locked])   // UNIQUE(tripId,label); sao chép từ VehicleSeat
TripLog(tripId, kind[depart|arrive|delay|notice], at, text)
TripBoarding(tripId, seatLabel, state[boarded|absent])
TripChecklist(tripId, item, done)

Booking(id, code UNIQUE, tripId, accountId?, guestName?, guestPhone?, status, source[app|counter],
        payMethod[transfer|cash|directTransfer|free], compReason?, pickupOfficeId, dropOfficeId,
        discount, promoCode?, note, createdAt, confirmedAt?, refunded, reviewed)
BookingSeat(bookingId, label, name, phone, price, surcharge)
BookingShuttle(bookingId, direction[pickup|drop], zoneId, address, note, fee)
BookingHistory(bookingId, at, text vi/en)
BookingMessage(bookingId, fromAdmin, text, at)
BookingNote(bookingId, text)                                                      // nội bộ, chỉ admin

Parcel(id, code, accountId?, sender*, receiver*, routeId, fromOfficeId, toOfficeId, category, description,
       pieces, weightKg, size, declaredValue, fee, date, handoverCodeHash, status, tripId?, note,
       rejectReason?, source)
ParcelEvent(parcelId, status, at, note)

Promotion(code UNIQUE, title, kind[percent|amount], value, minAmount, maxDiscount, usageLimit, used, endAt)
VoucherWallet(accountId, promotionCode)
LoyaltyEntry(accountId, points, reason, at)          // chỉ ghi thêm
Waitlist(tripId, accountId, seats, at)
FavoriteRoute(accountId, routeId)  ·  RecentRoute(accountId, routeId, at)         // dùng cho "Đặt nhanh"

Review(bookingId, accountId, stars, text, at, reply?, hidden)
Complaint(id, accountId, ref[mã đơn/gửi đồ], text, at, status[open|resolved], resolution?)
Report(id, reporterId, target, reason, at, status, resolution?)
ContactMessage(accountId, text, at, handled)
Notification(id, accountId, category[order|trip|parcel|promo|system], title vi/en, body vi/en, at,
             refType?, refId?, read)
Announcement(title vi/en, body vi/en, at)
GuestContact(name, phone, note)                    // khách tại quầy
```

**Không còn** các bảng: `PaymentProof`, `FileObject` (chứng từ), `BankInfo`, `BankCatalog`, `PaymentNote`, `SavedPassenger`, `SavedAddress`, `SavedReceiver`, `RefundAccount`, `EmergencyContact`, `UserPreference`.
**Trường chỉ dùng cho demo, đừng làm:** `Booking.seeded`, `dailyRevenueSeed`, `dailyCounterSeed`.
Nội dung song ngữ lưu kiểu `{vi, en}`.

---

## 8. API đề xuất

Quy ước: HTTPS, tiền tố `/v1`, JSON, `Authorization: Bearer`, `Accept-Language`; lỗi `{code, message}`; tạo đơn có `Idempotency-Key`; danh sách phân trang con trỏ. **Kiểm tra vai trò ở mọi endpoint** (`/manage`, `/admin` chỉ admin; khách chỉ đọc dữ liệu của mình; khách **không thấy** thông tin người đặt ở sơ đồ ghế).

### Công khai / tài khoản
| Chức năng | Endpoint |
|---|---|
| Đăng ký, đăng nhập (email hoặc SĐT), làm mới, đăng xuất | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| Quên / đặt lại / đổi mật khẩu | `POST /auth/forgot`, `/auth/reset`, `/auth/change-password` |
| Hồ sơ, xoá tài khoản | `GET/PATCH /me`, `DELETE /me` |
| Thiết bị | `GET /me/devices` |
| Thông tin nhà xe, FAQ, chính sách huỷ, quy định | `GET /operator`, `/faq`, `/cancel-policy` |
| Sức khoẻ | `GET /health` |

### Khách hàng
| Chức năng | Endpoint |
|---|---|
| Tỉnh có chuyến; văn phòng theo tỉnh / tuyến | `GET /provinces?hasTrips=true`, `/provinces/{id}/offices?routeId=` |
| Tìm chuyến (đã lọc cửa sổ 4h) | `GET /trips?fromProvinceId=&toProvinceId=&date=` |
| Chi tiết chuyến + sơ đồ ghế (chỉ trạng thái, không tên người) | `GET /trips/{id}`, `/trips/{id}/seats` |
| Khu vực trung chuyển của văn phòng | `GET /offices/{id}/shuttle-zones?side=pickup|drop` |
| Báo giá đơn (tính cả phụ thu, trung chuyển, mã giảm giá) | `POST /bookings/quote` |
| **Tạo đơn** (giữ ghế nguyên tử) | `POST /bookings` → `409 seat_conflict`, `422 booking_closed` |
| Danh sách / chi tiết / huỷ đơn | `GET /bookings`, `GET /bookings/{id}`, `POST /bookings/{id}/cancel` |
| Sửa / bỏ trung chuyển của đơn (trước hạn) | `PATCH /bookings/{id}/shuttle` |
| Tin nhắn trong đơn | `GET/POST /bookings/{id}/messages` |
| Đánh giá, khiếu nại, báo cáo | `POST /reviews`, `/complaints`, `/reports` |
| Danh sách chờ | `POST/DELETE /waitlist` |
| Gửi đồ: báo giá, tạo, xem, huỷ, sự cố | `POST /parcels/quote`, `POST /parcels`, `GET /parcels`, `POST /parcels/{id}/cancel`, `POST /parcels/{id}/issue` |
| Điểm, ví mã, giới thiệu, đặt nhanh | `GET /me/loyalty`, `/me/vouchers`, `/me/referral`, `/me/recent-routes`; `POST/DELETE /me/favorite-routes/{id}` |
| Thông báo | `GET /notifications`, `POST /notifications/read` |
| Liên hệ nhà xe | `POST /contact` |

### Quản trị
| Chức năng | Endpoint |
|---|---|
| Hàng đợi cần xác nhận + số đếm | `GET /manage/inbox`, `GET /manage/calendar?week=` |
| **Duyệt / từ chối đơn** | `POST /manage/bookings/{id}/approve`, `/reject {reason}` |
| Duyệt huỷ + ghi nhận hoàn | `POST /manage/bookings/{id}/approve-cancel`, `POST /manage/bookings/{id}/refund {amount}` |
| Đổi ghế / chuyển chuyến | `POST /manage/bookings/{id}/reseat`, `/move` |
| **Đặt hộ tại quầy** | `POST /manage/bookings` {tripId, seats[], guest{name,phone}, pickupOfficeId, dropOfficeId, payMethod, compReason?} (cũng bị chặn 4h) |
| Danh sách đơn (tìm, lọc) | `GET /manage/bookings?q=&status=` |
| Ghi chú nội bộ | `POST /manage/bookings/{id}/notes` |
| Xe | `GET/POST /manage/vehicles`, `GET/PATCH/DELETE /manage/vehicles/{id}` |
| Chuyến | `GET/POST /manage/trips` (hỗ trợ `repeatWeekdays`), `PATCH/DELETE /manage/trips/{id}`, `POST /manage/trips/{id}/cancel` |
| Vận hành chuyến | `PUT .../driver`, `PUT .../vehicle`, `POST .../seats/{label}/lock`, `POST .../status`, `POST .../logs`, `POST .../boarding`, `POST .../notice`, `GET .../manifest`, `GET .../shuttle` |
| Tuyến, văn phòng, khu vực | `/manage/routes`, `/manage/offices`, `/manage/zones` (CRUD) |
| Nhân viên / tài xế | `/manage/staff` (CRUD) |
| Khuyến mãi | `/manage/promotions` (CRUD), `POST /manage/promotions/{code}/grant {accountIds}` |
| Khách hàng | `/manage/customers` (CRUD, `POST .../lock`, `POST .../reset-password`), `/manage/guests` (CRUD) |
| Gửi đồ | `GET /manage/parcels`, `POST .../accept`, `.../reject`, `.../status`, `.../handover {code}`, `POST /manage/parcels` (nhận hộ) |
| Cước / hàng cấm / tải | `/admin/parcel-rates`, `/admin/parcel-categories`, `/admin/prohibited-items` |
| Đánh giá, báo cáo, khiếu nại, hộp thư | `/manage/reviews`, `/manage/reports`, `/manage/complaints`, `/manage/contact` |
| Thông báo chung | `POST /admin/announcements` (gửi cả vào thông báo từng khách) |
| Doanh thu, tổng quan, đối soát | `GET /manage/revenue?from=&days=` (mục 9), `GET /manage/dashboard`, `GET /manage/reports/...` |
| Tìm kiếm chung, xuất CSV | `GET /manage/search?q=`, `GET /manage/bookings/export.csv` |
| Cấu hình, chính sách huỷ, nhà xe, quản trị viên | `/admin/settings`, `/admin/cancel-policy`, `/admin/operator`, `/admin/admins` |

**Mã lỗi cần thống nhất:** `invalid_credentials`, `account_locked`, `phone_taken`, `email_taken`, `wrong_password`, `has_active_orders`, `last_admin`, `seat_conflict`, `booking_closed`, `promo_not_found`, `promo_expired`, `promo_min_amount`, `promo_used_up`, `trip_full_cargo`, `in_use` (chặn xoá, kèm lý do), `network`.

---

## 9. Công thức doanh thu và báo cáo

Doanh thu của một ngày `D` = **app + quầy + gửi đồ**:
- **app:** đơn `source = app`, `status ∈ {confirmed, completed}`, `payMethod ≠ free`, tính vào ngày `confirmedAt` (nếu thiếu thì `createdAt`), giá trị `total − refunded`.
- **quầy:** tương tự với `source = counter`, `payMethod ≠ free`, ngày bán.
- **gửi đồ:** `fee` của đơn gửi đồ từ trạng thái `received` trở đi (`received`, `onboard`, `arrived`, `delivered`), tính theo `date`.
- Ghế miễn phí (`free`) tính riêng (số ghế, lý do), **không vào doanh thu**.

`total = Σ(price + surcharge) + phí trung chuyển − discount` (≥ 0).

Trang Doanh thu gọi theo khoảng **7 / 30 / 60 ngày** và cần dữ liệu (tính ở BE, không kéo hết đơn về app):
1. Tổng kỳ này, tổng kỳ trước ngay trước đó (cùng độ dài), % thay đổi, trung bình / ngày, ngày cao nhất.
2. Doanh thu từng ngày (cả kỳ này và kỳ trước, để vẽ đường so sánh).
3. Từng ngày chia theo nguồn `{app, counter, parcel}`.
4. Tổng theo nguồn (vòng tròn tỷ trọng).
5. Doanh thu theo **tuyến**: tổng `total − refunded` của đơn `confirmed|completed` có chuyến chạy trong kỳ (theo **ngày chạy**, không phải ngày duyệt — nên tổng theo tuyến có thể lệch tổng theo ngày; app ghi chú điều này).
6. Trung bình theo **thứ trong tuần** (tổng / số ngày cùng thứ trong kỳ).

Tổng quan admin dùng cùng nguồn số liệu: hôm nay / 7 / 30 ngày, chuyến trong kỳ, ghế bán, % lấp đầy, top tuyến theo ghế bán, thẻ "cần xác nhận" lấy cùng nguồn với hàng đợi.

Đối soát: doanh thu app, quầy, đơn chờ duyệt (giá trị), đã hoàn, cước gửi đồ, phí trung chuyển, ghế tặng; chỉ số: lấp đầy TB, thời gian duyệt TB (`confirmedAt − createdAt`), tỷ lệ huỷ, tỷ lệ từ chối.

---

## 10. Thông báo (nội dung song ngữ, lưu cả vi / en)

| Sự kiện | Nhóm | Người nhận |
|---|---|---|
| Đơn được duyệt (kèm "thanh toán tại quầy") | order | khách |
| Đơn bị từ chối (kèm lý do) | order | khách |
| Huỷ đơn được duyệt, ghi nhận hoàn | order | khách |
| Đổi ghế / chuyển chuyến | order | khách |
| Đổi giờ chuyến, báo trễ, thông báo cả chuyến, huỷ chuyến | trip | mọi khách của chuyến |
| Gửi đồ: chấp nhận, từ chối, lên xe, tới nơi, đã giao, sự cố | parcel | người gửi |
| Tin nhà xe / khuyến mãi | system / promo | mọi khách |
| Chào mừng + mã CHAOBAN | system | khách mới |

Không có push; thông báo lấy qua `GET /notifications` khi mở app (nếu muốn push sau này thì thêm FCM, hiện chưa có).

---

## 11. Điểm BE cần lưu ý / câu hỏi mở

1. **Giữ ghế nguyên tử:** giao dịch + ràng buộc duy nhất `(tripId, seat)` cho trạng thái `pending|sold`; cần test đua tranh (nhiều yêu cầu cùng một ghế → đúng một thành công).
2. **Hằng số đang cứng trong app** cần chuyển thành cấu hình BE kiểm tra lại (không tin client): cửa sổ 4h, hạn trung chuyển 3h, tối đa 6 ghế, 7 ngày đặt trước, giá ghế trẻ em (đã bỏ), cước gửi đồ (30k/50k/80k, 5.000/kg, 1%).
3. **Đơn `pending` không hết hạn:** ghế giữ vô thời hạn tới khi admin duyệt / từ chối. Nếu cần tự nhả (ví dụ chưa duyệt sau X giờ) thì đây là quyết định nghiệp vụ mới — hiện app chỉ **đánh dấu "quá hạn"** ở hàng đợi theo `reviewDeadlineMinutes`.
4. **Chuyến tới gần giờ chạy:** đơn `pending` còn tồn khi chuyến vào khung 4h vẫn duyệt được; cần chốt có tự động xử lý hay không.
5. **Một người đặt cho nhiều ghế** dùng chung tên + SĐT tài khoản; BE không cần `passengerName` riêng từng ghế cho đơn app (vẫn lưu cho đơn quầy / dữ liệu cũ).
6. **Trạng thái `paid` của gửi đồ** app không dùng; đề nghị BE bỏ khỏi enum hoặc coi `received` là mốc đã thu cước.
7. **Hoàn tiền** vẫn chỉ ghi nhận; vì không còn "tài khoản nhận hoàn" nên admin liên hệ khách ngoài app.
8. **Quản trị viên mặc định:** tạo bằng kịch bản khởi tạo ở BE, không nằm trong app; thêm admin chỉ do admin hiện tại làm (`/admin/admins`).
9. **Bảo mật:** băm mật khẩu (Argon2/bcrypt), giới hạn thử đăng nhập, kiểm tra quyền mọi endpoint, địa chỉ trung chuyển và SĐT là dữ liệu cá nhân (xoá khi xoá tài khoản), không ghi dữ liệu cá nhân vào log.
10. **Đa ngôn ngữ:** BE trả mã lỗi ổn định, app tự dịch; nội dung thông báo / tin nhà xe lưu cả `vi` và `en`.
11. **Dữ liệu mẫu:** `Seed` trong app (5 xe, tuyến Hà Nội ↔ Thái Bình / Hải Phòng / Nam Định / Quảng Ninh…, 60 ngày doanh thu) chỉ để demo, không phải dữ liệu thật.
