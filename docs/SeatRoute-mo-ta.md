# SeatRoute: đặt chỗ limo liên tỉnh có ghế cố định (một nhà xe)

*Tagline: Book fixed-seat intercity limousine trips with one operator, upload your transfer receipt, and get your seat confirmed. Passengers register themselves; the operator manages everything inside the app.*

Tên **SeatRoute** là tên tạm, chưa kiểm tra trùng. Vì app chỉ phục vụ **một nhà xe**, bạn có thể đặt tên app theo thương hiệu của nhà xe đó (nếu bạn có quyền sử dụng). Bạn tự search Play Store (có dấu và không dấu) và tra nhãn hiệu trước khi chốt. Package name viết liền, không dấu, ví dụ `com.yourname.seatroute`.

**Đã áp dụng các yêu cầu của bạn:**
- **Chỉ một nhà xe.** Không có đăng ký nhà xe, không có duyệt nhà xe, không có chọn nhà xe. Thông tin nhà xe do quản trị viên nhập trong app.
- **Không có CRM hay trang quản trị riêng:** mọi thứ xử lý ngay trong app, chia theo vai trò.
- **Chỉ có 2 vai trò: quản trị viên và khách hàng.** Không có vai trò điều hành, không có vai trò tài xế. Quản trị viên làm mọi việc của nhà xe; tài xế chỉ là hồ sơ trong dữ liệu, không có tài khoản.
- **Quản trị viên đăng nhập bằng tài khoản mặc định** (tạo ở máy chủ, bắt buộc đổi mật khẩu lần đầu). **Khách hàng tự tạo tài khoản.**
- **Tính năng chia riêng theo từng vai trò:** Phần A cho khách hàng, Phần B cho quản trị viên.
- **Quản trị viên đặt hộ khách không dùng app** (ví dụ người nhà): đặt ghế hoặc nhận gửi đồ giúp, thu tiền mặt, chuyển khoản trực tiếp hoặc ghi ghế miễn phí có lý do; không cần tài khoản khách.
- **Dịch vụ gửi đồ cho khách hàng** (không đặt ghế): gửi hàng theo chuyến limo giữa các văn phòng, tính cước, theo dõi từng mốc, mã nhận hàng cho người nhận; không thu hộ tiền hàng.
- **Khách hàng và quản trị viên đều phải đăng nhập** mới dùng được app.
- **Limo chuyến liên tỉnh có ghế cố định.** Mỗi xe một tài xế trong mỗi chuyến, do quản trị viên phân.
- **Luồng thanh toán thủ công:** hành khách đặt ghế, chuyển khoản trực tiếp cho nhà xe, gửi **ảnh chứng từ** lên app, nhà xe xác nhận và xếp chỗ. App không giữ tiền và không xử lý thanh toán.
- Đăng ký, đăng nhập, token, đa ngôn ngữ (Tiếng Việt và English) giữ cùng cách làm như app RoomRoster.
- Không hóa đơn/thuế, không sổ nợ/công nợ, không quét mã vạch/QR, không khóa app bằng PIN hay sinh trắc học. Không có Monetization và lộ trình.

**Quy mô:** 263 tính năng, 24 nhóm (Phần A khách hàng, Phần B quản trị viên), trong đó 23 tính năng bổ sung đánh dấu **(mới)**.

---

## Mô tả tổng quan

SeatRoute là ứng dụng đặt chỗ của **một nhà xe limo liên tỉnh** (xe 9 đến 16 chỗ chạy tuyến cố định, ghế đánh số). **Quản trị viên (chủ nhà xe)** nhập hồ sơ nhà xe, văn phòng ở từng tỉnh, xe, sơ đồ ghế, tuyến, chuyến, giá và hồ sơ tài xế, rồi nhận đơn, kiểm tra chứng từ, xác nhận và xếp chỗ. **Hành khách** chọn lộ trình, chọn chuyến, chọn văn phòng lên xe và ghế, chuyển khoản theo hướng dẫn, gửi ảnh chứng từ và theo dõi trạng thái đơn. **Tài xế** chỉ là hồ sơ do quản trị viên quản lý; quản trị viên gửi danh sách khách cho tài xế dạng chữ qua Zalo hoặc ứng dụng khác.

**Dịch vụ gửi đồ:** ngoài đặt ghế, khách hàng có thể **gửi đồ theo chuyến limo** từ văn phòng này đến văn phòng kia. Quản trị viên đặt cước, giới hạn tải và hàng cấm, xác nhận từng yêu cầu và cập nhật mốc của hàng. Người nhận lấy hàng bằng **mã nhận hàng**. Dịch vụ này không định vị hàng, không chụp ảnh hàng và không thu hộ tiền hàng.

**Khác gì app gọi xe:**
- Không ghép tài xế theo thời gian thực, không định vị, không theo dõi hành trình. Chuyến có giờ và tuyến cố định, nên **không cần xin quyền vị trí**.
- Giá, chỗ ngồi và văn phòng lên xe do nhà xe định sẵn; hành khách chọn lộ trình, văn phòng và ghế cụ thể trên sơ đồ.
- Thanh toán là chuyển khoản thủ công kèm xác nhận của nhà xe.

**Vì chỉ có một nhà xe:** app đơn giản hơn nhiều so với nền tảng nhiều nhà xe (không có duyệt nhà xe, không có xung đột giữa các nhà xe, ít rủi ro nhà xe ảo thu tiền). Đổi lại, **dữ liệu không được thiết kế để nhiều nhà xe dùng chung**; sau này muốn mở rộng thành nền tảng thì phải thêm khái niệm nhà xe vào dữ liệu và phân quyền, tốn công sửa.

**Giới hạn cần nói rõ:**
- **App không giữ tiền, không thu hộ, không đảm bảo thanh toán.** Hành khách chuyển tiền thẳng cho nhà xe. Quản trị viên tự đối chiếu với sao kê ngân hàng.
- **Ảnh chứng từ có thể bị làm giả.** App có cảnh báo nghi trùng chứng từ nhưng **không thể tự xác minh** chứng từ thật hay giả.
- **Không có thông báo đẩy** (không dùng dịch vụ đẩy, không xin quyền thông báo). Hành khách chỉ thấy trạng thái mới khi mở app (xem mục "Quyền và kết nối mạng").
- **Không theo dõi xe trên bản đồ,** không báo vị trí tài xế.
- **Không xuất hóa đơn.** Vé điện tử chỉ là xác nhận đặt chỗ.
- **Không có ví, không điểm quy đổi thành tiền mặt.** Hoàn tiền do nhà xe tự chuyển và app chỉ ghi nhận.
- **Gửi đồ không có thu hộ (COD), không giữ tiền hàng, không bảo hiểm ngoài chính sách bồi thường của nhà xe.** Nhà xe tự kiểm tra hàng cấm tại văn phòng; app chỉ có danh mục và cam kết của người gửi.
- App **không tư vấn pháp lý** và không thay nhà xe về giấy phép kinh doanh vận tải (xem mục chính sách).

---

## Vai trò trong app

| Vai trò | Cách có tài khoản | Làm được gì |
|---|---|---|
| **Khách hàng** (gọi là hành khách trong app) | Tự đăng ký | Chọn lộ trình, xem chuyến, đặt ghế, gửi chứng từ, xem vé, hủy theo chính sách, đánh giá, báo cáo, khiếu nại (Phần A) |
| **Quản trị viên** (chủ nhà xe) | Tài khoản mặc định tạo sẵn ở máy chủ | Toàn quyền: hồ sơ nhà xe, văn phòng, xe, tài xế, tuyến, chuyến, giá, xử lý đơn và chứng từ, xếp chỗ, ngày chạy, báo cáo, cấu hình, xử lý báo cáo và khiếu nại (Phần B) |

Chỉ có hai vai trò này. Mỗi vai trò có màn hình và danh sách tính năng riêng (Phần A và Phần B bên dưới). Cùng một app, cùng màn hình đăng nhập, vai trò của tài khoản quyết định màn hình hiển thị.

Máy chủ **kiểm tra quyền theo vai trò ở mọi endpoint**, không chỉ ẩn nút ở app.

---

## Cấu trúc màn hình

**Khách hàng (4 tab ở thanh dưới):**

| Tab | Nội dung chính |
|---|---|
| **Home** | Chuyến sắp tới, việc cần làm ngay (gửi ảnh chuyển khoản), lối tắt đặt chuyến, khuyến mãi, tin nhà xe, văn phòng, mục Dịch vụ (gửi đồ) |
| **Thông báo** | Trung tâm thông báo theo nhóm: đơn và thanh toán, chuyến đi, khuyến mãi, hệ thống |
| **Đặt chuyến** | Công tắc **Đặt ghế / Gửi đồ**. Đặt ghế: chọn lộ trình, chuyến, ghế, văn phòng đón và dừng, xe trung chuyển, thanh toán và gửi ảnh chuyển khoản. Gửi đồ: tạo yêu cầu, tính cước, thanh toán, theo dõi |
| **Profile** | Thông tin người dùng, dữ liệu lưu sẵn (hành khách đi cùng, địa chỉ, tài khoản nhận hoàn), lịch sử và thống kê, điểm và hạng, ví mã, đánh giá, khiếu nại, cài đặt, trợ giúp, quyền riêng tư |

**Quản trị viên (5 tab ở thanh dưới, giống app quản lý doanh nghiệp):**

| Tab | Nội dung chính |
|---|---|
| **Tổng quan** | Doanh thu và biểu đồ, số xe, số nhân viên, lịch cần xác nhận, chuyến hôm nay, đơn gửi đồ, cảnh báo, nút "+" đặt hộ |
| **Cần xác nhận** | Hàng đợi chứng từ theo thời điểm gửi, lịch cần xác nhận, đơn mất ghế, yêu cầu gửi đồ, yêu cầu hủy và đổi, hoàn tiền |
| **Chuyến** | Lịch chuyến, tạo chuyến, sơ đồ ghế, xếp chỗ, danh sách khách, trung chuyển và hàng gửi, điểm danh, thông báo chuyến, nút "+" đặt hộ |
| **Quản lý** | Xe, nhân viên và tài xế, nhà xe và văn phòng, thanh toán và mã QR, tuyến và trung chuyển, cước gửi đồ, khách hàng và khuyến mãi, đánh giá và khiếu nại, đối soát và báo cáo |
| **Tài khoản** | Hồ sơ quản trị viên, cấu hình, quản lý quản trị viên, tìm kiếm, nhập CSV, ngôn ngữ, giao diện, xuất dữ liệu |

---

## Luồng vào app của khách hàng

**Bắt buộc có tài khoản:** khách hàng tự đăng ký rồi đăng nhập mới dùng được app (không có chế độ xem khi chưa đăng nhập).
1. **Chọn lộ trình** ở tab Đặt chuyến: điểm đi và điểm đến (ví dụ Hà Nội → Thái Bình), ngày, số người.
2. **Danh sách chuyến** của nhà xe chạy lộ trình đó, lọc được theo giá, giờ, loại xe và văn phòng lên xe.
3. **Chọn điểm đón và điểm dừng là văn phòng của nhà xe.** Mỗi tỉnh có một hoặc nhiều văn phòng; mỗi văn phòng hiện địa chỉ, giờ xe tới và số điện thoại.
4. **Xe trung chuyển (tùy chọn), giống cách các nhà xe limo đang làm:** nếu bật, xe **đón khách tại địa chỉ của khách và đưa đến văn phòng lên xe** (chiều đi), và/hoặc **từ văn phòng xuống xe đưa khách về địa chỉ** (chiều đến), trong khu vực phục vụ do nhà xe đặt, có phí theo khu vực.
5. **Chọn ghế** trên sơ đồ, nhập thông tin hành khách, xem tổng tiền.
6. **Tạo đơn, rồi chuyển khoản ngay:** màn hình thanh toán hiện **mã QR** và **số tài khoản** của nhà xe, kèm khuyến nghị **gửi ảnh chuyển khoản càng sớm càng tốt** vì ghế thuộc về người gửi ảnh trước.
7. **Gửi ảnh chứng từ** (chụp bằng Camera hoặc chọn từ thư viện), rồi theo dõi trạng thái trong Home và tab Thông báo.

**Gửi đồ (không đặt ghế):** khách chuyển công tắc sang "Gửi đồ" ở tab Đặt chuyến (hoặc bấm mục Dịch vụ ở Home), chọn tuyến, văn phòng gửi và nhận, nhập người nhận và thông tin hàng; app tính cước; nhà xe xác nhận và chọn chuyến; khách thanh toán (QR hoặc tiền mặt tại văn phòng); khách mang hàng đến văn phòng gửi; hàng đi cùng chuyến limo; người nhận lấy tại văn phòng nhận bằng mã nhận hàng. Dịch vụ này **không đặt ghế** và **không theo quy tắc chuyển khoản trước có chỗ trước**; hàng bị giới hạn bởi tải trọng của chuyến.

**Quản trị viên đặt hộ:** khách không dùng app (ví dụ người nhà) vẫn được đặt ghế hoặc gửi đồ qua quản trị viên, không cần tài khoản.

---

## Quy tắc "chuyển khoản trước có chỗ trước"

Theo yêu cầu của bạn, **chọn ghế không khóa ghế**. Nhiều người có thể cùng chọn một ghế; ghế thuộc về **đơn gửi được ảnh chứng từ thành công sớm nhất, tính theo giờ máy chủ**.

| Trạng thái ghế | Ý nghĩa | Khách thấy |
|---|---|---|
| Trống | Chưa ai gửi chứng từ cho ghế này | Chọn được; có nhãn "n người đang chọn" nếu có người khác cùng chọn |
| Đã có chứng từ (chờ xác nhận) | Một đơn đã gửi chứng từ trước và đang chờ quản trị viên | Không chọn được |
| Đã bán | Quản trị viên đã xác nhận chứng từ | Không chọn được |
| Khóa | Quản trị viên khóa thủ công | Không chọn được |

- **Thời điểm tính** là lúc máy chủ nhận xong ảnh hợp lệ, **không phải** giờ ghi trên giao dịch ngân hàng.
- **Quản trị viên từ chối chứng từ** thì ghế được nhả; các đơn khác đang chọn ghế đó gửi tiếp được.
- **Người đến sau** (đã chuyển tiền nhưng ghế bị lấy trước) vào trạng thái **"ghế bị người khác lấy trước"**: ảnh vẫn được lưu, khách chọn ghế khác cùng chuyến, chuyển chuyến khác hoặc nhận hoàn tiền; quản trị viên thấy trong mục "đơn mất ghế".
- **Đây là đánh đổi thật:** khách có thể chuyển tiền rồi mất ghế và phải chờ hoàn hoặc đổi. Để giảm khiếu nại, app (1) giải thích quy tắc ngay khi chọn ghế và ở màn hình thanh toán, (2) có màn hình khuyến nghị gửi ảnh trước, (3) hiện số người đang cùng chọn, (4) hiện rõ lựa chọn xử lý khi mất ghế. Nếu muốn an toàn hơn cho khách, có thể thêm giữ ghế tạm vài phút; hiện tại thiết kế theo đúng quy tắc bạn đặt.

---

## Quyền và kết nối mạng

- **Quyền khai báo:** `INTERNET` (và tùy chọn `ACCESS_NETWORK_STATE`) là quyền thông thường, không có hộp thoại xin quyền; thêm **`CAMERA`** là quyền runtime duy nhất, hiện hộp thoại xin quyền lần đầu khi khách bấm chụp ảnh chứng từ. Khai `<uses-feature android:name="android.hardware.camera" android:required="false"/>` để máy không có camera vẫn cài được.
- **Ảnh chứng từ có hai nguồn:** (1) **chụp bằng Camera trong app** (cần quyền `CAMERA`, dùng CameraX); (2) **chọn từ thư viện bằng Photo Picker** của hệ thống (ví dụ ảnh chụp màn hình chuyển khoản). **Không khai `READ_MEDIA_IMAGES`** vì Google Play chỉ cho dùng khi chức năng cốt lõi cần truy cập rộng vào thư viện ảnh; app này chỉ cần chọn vài ảnh nên phải dùng Photo Picker. Từ chối quyền Camera thì app vẫn cho chọn ảnh từ thư viện. Ảnh chụp chỉ lưu tạm để gửi, không ghi vào thư viện máy.
- **Không xin quyền vị trí, danh bạ, bộ nhớ ngoài, thông báo.** Số điện thoại nhập tay; nút "gọi" dùng `ACTION_DIAL`.
- **Không có thông báo đẩy:** đây là **đánh đổi lớn nhất** của app này. Hành khách đã chuyển khoản sẽ không được báo khi nhà xe xác nhận cho đến khi mở lại app. Bù lại bằng trung tâm thông báo trong app, màn hình "Chuyến của tôi" và việc nhà xe liên hệ hành khách bằng điện thoại hoặc Zalo ngoài app. Muốn thêm thông báo đẩy sau này thì cần thêm dịch vụ đẩy và quyền thông báo, và khai báo lại.
- **Chỉ HTTPS.** Cấu hình `network_security_config` cấm cleartext. Không ghi log nội dung yêu cầu và phản hồi, không để khóa bí mật trong mã.
- **Token chỉ giữ trong bộ nhớ khi app chạy, không lưu xuống máy.** Thoát hẳn app là phải đăng nhập lại. Chuyển sang app khác (ví dụ ngân hàng hay Zalo) rồi quay lại thì app vẫn giữ phiên; để ở nền hoặc không thao tác quá khoảng 1 giờ thì mất phiên. Các ngưỡng này là đề xuất, đặt giống RoomRoster, bạn đổi được. Với hành khách thông thường, việc phải đăng nhập lại mỗi lần mở app có thể gây khó chịu; hãy cân nhắc.
- **Không lưu mật khẩu** trên máy.

---

## Chuẩn bị để qua chính sách Google Play

Số lượng tính năng **không tự đảm bảo** được duyệt. Mình không thể biết chắc app của bạn có được duyệt hay không. Hãy kiểm tra các điểm sau trước khi gửi:

1. **Mỗi tính năng trong bản phát hành phải chạy trọn vẹn.** Không có nút "sắp có" hoặc màn hình trống. Chưa xong thì bỏ khỏi bản phát hành.
2. **Tài khoản thử cho người duyệt (bắt buộc):** toàn bộ app nằm sau màn hình đăng nhập, nên phải cung cấp **tài khoản thử đang hoạt động** cho hành khách và cho quản trị viên (nên dùng môi trường thử với dữ liệu thử do bạn tạo, không cấp tài khoản quản trị của hệ thống thật), kèm chuyến, văn phòng và đơn thử, và điền vào mục hướng dẫn truy cập app trong Play Console. Tài khoản thử không được hết hạn hay đòi xác minh thêm (mã qua email, số điện thoại), nếu không người duyệt không vào được app và có thể từ chối.
3. **Máy chủ chạy ổn định lúc duyệt.** Máy chủ lỗi mà app crash hoặc kẹt màn hình là lý do bị từ chối. Mọi lỗi mạng phải có thông báo rõ.
4. **Xóa tài khoản:** vì app cho tạo tài khoản, phải có xóa tài khoản và dữ liệu **ngay trong app** (tính năng 112) và một **đường dẫn web** nhận yêu cầu xóa, khai trong Play Console. Máy chủ phải xóa thật, kể cả ảnh chứng từ, trừ những gì bạn buộc phải giữ theo pháp luật (nêu rõ trong chính sách quyền riêng tư).
5. **Nội dung do người dùng tạo:** app có đánh giá và tin nhắn trong đơn. Google yêu cầu có **cách báo cáo và chặn nội dung vi phạm** (tính năng 100) **và có người thực sự xử lý báo cáo**: quản trị viên xử lý trong app (tính năng 233, 234); bạn cần nêu thời gian phản hồi trong chính sách.
6. **Quyền của bạn với thương hiệu và hoạt động vận tải:** app đại diện cho một nhà xe cụ thể. Tài khoản nhà phát triển nên là của nhà xe đó hoặc bạn phải có **thỏa thuận bằng văn bản** cho phép bạn phát hành app dưới tên và thương hiệu của họ. Nhà xe phải có giấy phép kinh doanh vận tải hành khách phù hợp.
7. **Khai Data safety theo thực tế:** thu thập email, tên, SĐT, **ảnh (chứng từ chuyển khoản)**, thông tin đặt chỗ, **địa chỉ đón và trả của xe trung chuyển** (do khách nhập); **tên và SĐT người nhận hàng và người được đặt hộ**; dữ liệu truyền đi và lưu trên máy chủ; có cơ chế yêu cầu xóa. Thông tin tài khoản ngân hàng của nhà xe hiển thị cho khách cũng nên được cân nhắc khi khai báo. Chỉ khai "mã hóa khi truyền" nếu mọi kết nối đều qua HTTPS.
8. **Chính sách quyền riêng tư:** nêu rõ ảnh chứng từ chứa thông tin gì, ai xem được (hành khách đó và quản trị viên của nhà xe), lưu bao lâu, cách xóa (tính năng 111).
9. **Thanh toán:** app chỉ hướng dẫn chuyển khoản thủ công cho dịch vụ vận tải ngoài đời thật. Hãy **đọc kỹ chính sách thanh toán của Google Play** (đặc biệt phần hàng hóa và dịch vụ vật lý) và đảm bảo app không bán nội dung số hay tính năng số bằng thanh toán ngoài Play.
10. **Pháp lý vận tải:** kinh doanh vận tải hành khách có điều kiện riêng. **Mình không phải luật sư.** Bạn và nhà xe nên hỏi luật sư hoặc cơ quan quản lý địa phương về điều kiện kinh doanh, hình thức bán vé điện tử và quyền lợi hành khách.
11. **Màn hình quản trị nằm trong app công khai:** chỉ hiện và dùng được với tài khoản quản trị viên; máy chủ chặn ở mọi endpoint. Không có tài khoản hay mật khẩu mặc định nằm trong mã app.
12. **Không viết** "thanh toán trực tuyến trong app", "theo dõi xe trực tiếp", "đảm bảo hoàn tiền", "xuất hóa đơn", "an toàn tuyệt đối" vì app không làm các việc này. Không dùng tên thương hiệu thật của hãng xe và ngân hàng trong ví dụ và ảnh chụp màn hình; dùng ví dụ chung như "Ngân hàng X".
13. **Yêu cầu thử nghiệm với tài khoản nhà phát triển mới** (ví dụ thử nghiệm kín trước khi lên bản chính thức) có thể áp dụng cho bạn; hãy xem điều kiện hiện hành trong Play Console.
14. **Không nhồi tính năng giả để tăng số lượng.** App ít tính năng nhưng chạy tốt vẫn an toàn hơn app nhiều tính năng nhưng lỗi.
15. **Quyền Camera và ảnh:** (a) trong Play Console, mục Data safety khai thu thập **ảnh** (chứng từ chuyển khoản, từ Camera hoặc thư viện), mục đích chức năng của app; (b) giải thích lý do xin Camera trước khi hiện hộp thoại của hệ thống, và chỉ xin khi khách bấm chụp; (c) **không khai `READ_MEDIA_IMAGES` hay `READ_MEDIA_VIDEO`**, vì theo chính sách ảnh và video của Google Play chỉ app có chức năng cốt lõi cần truy cập rộng vào thư viện (như ứng dụng thư viện ảnh) mới được dùng, còn app khác phải dùng trình chọn của hệ thống; vi phạm có thể bị gỡ app; (d) nếu sau này bạn nhất định cần quyền đọc ảnh thì phải nộp khai báo trong Play Console giải thích vì sao trình chọn ảnh không đủ, và nhiều khả năng bị từ chối với app đặt vé.
16. **Mã QR và thông tin chuyển khoản:** QR chỉ để **hiển thị** (app không quét mã), tạo theo chuẩn QR chuyển khoản liên ngân hàng từ thông tin tài khoản của nhà xe; **tự thử bằng giao dịch thật nhỏ** với vài app ngân hàng trước khi phát hành, và luôn hiện kèm số tài khoản. Không dùng logo hay tên thương hiệu ngân hàng nếu chưa được phép.
17. **Quy tắc ai chuyển khoản trước được ghế** phải hiện **rõ ràng trước khi khách chuyển tiền** (tính năng 35, 47); giấu hoặc mơ hồ quy tắc này dễ bị coi là gây hiểu lầm và sinh khiếu nại.
18. **Dịch vụ gửi đồ:** chở hàng của khách trên xe chở khách có thể có điều kiện pháp lý riêng (vận tải hàng hóa, bưu chính, hàng cấm hoặc hạn chế). **Mình không phải luật sư:** nhà xe nên hỏi luật sư hoặc cơ quan quản lý địa phương trước khi bật dịch vụ. App có danh mục hàng cấm và cam kết của người gửi nhưng **không kiểm tra hàng thực tế**. Không mô tả dịch vụ như bưu chính hay bảo hiểm hàng hóa nếu nhà xe không có.
19. **Dữ liệu của người không dùng app:** quản trị viên nhập tên và SĐT của khách đặt hộ, người nhận hàng nên chính sách quyền riêng tư phải nêu rõ nhóm dữ liệu này, mục đích, thời gian lưu và cách yêu cầu xóa.

---

# PHẦN A: KHÁCH HÀNG (hành khách)

*Mọi tính năng trong phần này dành cho tài khoản khách hàng. Khách hàng không thấy và không gọi được các màn hình hay endpoint của quản trị viên. Thanh điều hướng dưới có 4 tab: **Home, Thông báo, Đặt chuyến, Profile** (xem mục "Cấu trúc màn hình").*

## Nhóm 1 Khách hàng: Khởi đầu và tài khoản
1. **Màn hình chào và đăng nhập bắt buộc:** mở app thấy lựa chọn đăng nhập hoặc đăng ký, giới thiệu ngắn về nhà xe, liên kết điều khoản và chính sách quyền riêng tư
2. **Điều khoản sử dụng và chính sách quyền riêng tư,** đồng ý khi đăng ký, xem lại được trong Profile
3. **Hướng dẫn nhanh** khi mở lần đầu, gồm 4 bước: chọn lộ trình, chọn văn phòng và ghế, **chuyển khoản và gửi ảnh sớm**, theo dõi vé
4. **Đăng ký tài khoản:** email, mật khẩu, tên, SĐT, đồng ý điều khoản; kiểm tra định dạng và độ mạnh mật khẩu
5. **Đăng nhập** bằng email và mật khẩu; hiện lỗi rõ khi sai thông tin hoặc mất mạng
6. **Đăng xuất,** thu hồi phiên
7. **Quên mật khẩu và đặt lại** qua email do máy chủ gửi
8. **Phiên đăng nhập bằng token:** access token sống lâu (đề xuất 2 giờ), tự làm mới khi đang dùng app, giữ phiên khi chuyển sang app khác rồi quay lại, mất phiên khi quá khoảng 1 giờ ở nền hoặc thoát hẳn app; thông báo lỗi mạng rõ ràng khi không đăng nhập được

## Nhóm 2 Khách hàng: Tab Home
9. **Lời chào theo tên** và tên nhà xe; nút gọi nhanh nhà xe (mở trình quay số, không xin quyền)
10. **Thẻ "Chuyến sắp tới":** chuyến gần nhất có đếm ngược, văn phòng lên xe, giờ xe tới, giờ xe trung chuyển (nếu có), ghế, trạng thái đơn
11. **Thẻ "Cần làm ngay":** đơn chờ chuyển khoản hoặc chờ gửi chứng từ (nổi bật nút **Gửi ảnh chuyển khoản**), đơn cần gửi lại chứng từ, đơn bị lấy ghế trước cần chọn lại, yêu cầu của nhà xe cần trả lời
12. **Lối tắt đặt chuyến:** lộ trình gần nhất và lộ trình yêu thích, bấm một chạm sang tab Đặt chuyến với lộ trình đã điền; đặt lại nhanh từ đơn cũ
13. **Mục Dịch vụ:** lưới dịch vụ trên Home (hiện có **Gửi đồ**), thẻ "Đơn gửi đồ đang đi" với mốc hiện tại; thêm dịch vụ khác sau này không đổi cấu trúc app
14. **Khuyến mãi đang có:** thẻ mã giảm giá còn hiệu lực, sao chép hoặc áp thẳng vào đơn kế tiếp
15. **Tin của nhà xe:** thông báo chung, tin đổi giờ hoặc nghỉ lễ, thông tin hữu ích trên tuyến
16. **Danh sách văn phòng của nhà xe** theo tỉnh: địa chỉ, giờ làm việc, gọi điện hoặc sao chép địa chỉ
17. **Chuyến vừa hoàn thành chờ đánh giá:** nhắc viết đánh giá một chạm
18. **(mới)** **Gợi ý chuyến theo thói quen:** từ các lộ trình khách hay đi, gợi ý chuyến sắp chạy còn nhiều ghế
19. **Kéo để làm mới,** hiện trạng thái mất mạng và thời điểm cập nhật cuối

## Nhóm 3 Khách hàng: Tab Thông báo
20. **Trung tâm thông báo trong app,** chia nhóm: đơn và thanh toán, chuyến đi, gửi đồ, khuyến mãi, hệ thống
21. **Thông báo đơn:** đơn được xác nhận, bị từ chối, yêu cầu bổ sung chứng từ, đổi ghế, ghế bị người khác lấy trước, hoàn tiền đã ghi nhận
22. **Thông báo chuyến:** đổi giờ, đổi điểm đón, trễ giờ, hủy chuyến, nhắc chuyến sắp chạy (hiện khi mở app, không đẩy)
23. **Thông báo gửi đồ:** nhà xe đã xác nhận hoặc từ chối, hàng đã lên xe, hàng đã tới văn phòng nhận, đã giao, có sự cố
24. **Chấm số thông báo chưa đọc** trên tab; tải lại khi mở app và khi quay lại từ nền
25. **Bấm vào thông báo mở thẳng** đơn hoặc chuyến liên quan
26. **Đánh dấu đã đọc tất cả,** xóa từng thông báo, lọc chưa đọc

## Nhóm 4 Khách hàng: Tab Đặt chuyến (chọn chuyến và ghế)
27. **Công tắc đầu tab: "Đặt ghế | Gửi đồ".** Chọn **Đặt ghế** để đặt chỗ như dưới đây, chọn **Gửi đồ** để chuyển sang dịch vụ gửi đồ (nhóm tính năng riêng bên dưới)
28. **Màn hình đầu tiên: chọn lộ trình.** Chọn **điểm đi** và **điểm đến** (tỉnh hoặc thành phố, ví dụ Hà Nội và Thái Bình), ngày, số người; nút đảo chiều một chạm; ghi nhớ lộ trình gần nhất và gợi ý các lộ trình đang có chuyến; chỉ hiện tỉnh có chuyến. Sau đó hiện **danh sách chuyến** của nhà xe chạy lộ trình đó
29. **Bộ lọc và sắp xếp** theo giá, giờ đi, **văn phòng lên xe**, loại xe, tiện ích, chỉ hiện chuyến còn ghế
30. **Trang chi tiết chuyến:** tên nhà xe, SĐT, điểm đánh giá, xe, tiện ích, danh sách văn phòng lên và xuống xe kèm giờ xe tới từng nơi, chính sách hủy, quy định, giờ dự kiến; nút chọn ghế để đặt
31. **Thông tin nhà xe:** hồ sơ, giờ làm việc, SĐT, danh sách văn phòng ở từng tỉnh, quy định chung (hành lý, đồ ăn uống, thú cưng, trẻ em), bảng chính sách hủy và hoàn
32. **(mới)** **Điểm đánh giá và số chuyến hoàn thành** của nhà xe, tự tính từ dữ liệu thật
33. **(mới)** **Thông tin hữu ích trên tuyến** (văn phòng, quy định, lưu ý) hiển thị trước chuyến
34. **Chọn ghế trên sơ đồ:** ghế trống, ghế **đã có người gửi chứng từ (chờ xác nhận)**, ghế đã bán; ghế trống có nhãn "n người đang chọn" nếu có người khác cùng chọn; không hiện thông tin người khác
35. **Quy tắc "chuyển khoản trước có chỗ trước":** chọn ghế **chưa giữ chỗ độc quyền**; ghế thuộc về đơn **gửi ảnh chứng từ thành công sớm nhất** (theo giờ máy chủ). Màn hình giải thích quy tắc này ngay khi chọn ghế và ở bước thanh toán
36. **Chọn điểm đón và điểm dừng là văn phòng của nhà xe** (bắt buộc cả hai): **văn phòng lên xe** ở tỉnh đi và **văn phòng xuống xe** ở tỉnh đến (có thể có nhiều văn phòng mỗi tỉnh); mỗi văn phòng hiện địa chỉ, giờ xe tới và số điện thoại
37. **Xe trung chuyển (tùy chọn):** công tắc "Tôi dùng xe trung chuyển" cho từng chiều. **Chiều đi:** xe trung chuyển **đón khách tại địa chỉ của khách** (trong khu vực phục vụ của văn phòng lên xe đã chọn) rồi **đưa đến văn phòng lên xe**, khách lên xe limo chính ở đó. **Chiều đến:** từ **văn phòng xuống xe**, xe trung chuyển **đưa khách về địa chỉ** trong khu vực phục vụ của văn phòng đó. Khách chọn khu vực, nhập địa chỉ bằng chữ (hoặc chọn địa chỉ đã lưu trong Profile) và ghi chú, xem phí; không dùng bản đồ hay vị trí
38. **Giờ trung chuyển dự kiến:** tự tính từ giờ xe tới văn phòng trừ số phút nhà xe đặt cho khu vực đó (chiều đi) hoặc cộng thời gian đưa khách (chiều đến), hiện trước khi đặt và trong vé; địa chỉ ngoài khu vực phục vụ thì báo rõ và gợi ý chọn văn phòng khác hoặc không dùng trung chuyển
39. **Thông tin hành khách theo từng ghế:** tên, SĐT, ghi chú; chọn nhanh từ danh sách hành khách đi cùng đã lưu
40. **Tóm tắt đơn và tổng tiền** = giá ghế + phụ thu ghế + phí xe trung chuyển (nếu chọn) − giảm giá; hiện rõ giá trẻ em theo quy tắc nhà xe
41. **Nhập hoặc chọn mã giảm giá** từ ví mã trong Profile
42. **Đặt nhiều ghế và đặt hộ người khác** trong một đơn
43. **Ghi chú cho nhà xe** (hành lý nhiều, trẻ nhỏ, yêu cầu đặc biệt)
44. **(mới)** **Gợi ý chuyến thay thế** khi chuyến hết chỗ hoặc ghế vừa bị người khác lấy: cùng tuyến ở ngày hoặc giờ gần nhất
45. **(mới)** **Đăng ký danh sách chờ** khi chuyến hết chỗ; có ghế trống thì nhà xe liên hệ theo thứ tự
46. **Máy tính giá nhanh:** chọn tuyến, ghế, số người, mã giảm giá, ra tổng tiền; dùng cùng bộ tính giá với đặt chỗ, không lưu dữ liệu

## Nhóm 5 Khách hàng: Thanh toán và gửi ảnh chuyển khoản
47. **Màn hình khuyến nghị gửi ảnh chuyển khoản trước:** hiện ngay sau khi tạo đơn, nói rõ "ai gửi ảnh chuyển khoản trước sẽ được giữ ghế", có đồng hồ đếm ngược hạn gửi chứng từ, các bước 1-2-3 (chuyển khoản, chụp hoặc chọn ảnh, gửi), nút **Gửi ảnh ngay**, và cảnh báo "chưa gửi ảnh thì ghế chưa được giữ"
48. **Thông tin chuyển khoản của nhà xe:** hiện **mã QR chuyển khoản** (QR hiển thị để khách dùng app ngân hàng quét, app **không quét mã**) kèm **số tài khoản, tên chủ tài khoản, ngân hàng, số tiền chính xác và nội dung chuyển khoản là mã đơn**, sao chép từng mục bằng một chạm; chỉ hiện **sau khi tạo đơn**, kèm cảnh báo "chỉ chuyển theo thông tin trong đơn"
49. **Mã QR tạo sẵn trong app theo chuẩn VietQR** từ mã ngân hàng, số tài khoản, số tiền và nội dung của đơn; khách sửa được số tiền trong app ngân hàng; không cần tải ảnh QR lên
50. **Chọn ảnh chứng từ từ thư viện bằng trình chọn ảnh của hệ thống** (Photo Picker): truy cập ảnh mà không cần khai quyền đọc ảnh
51. **Chụp ảnh chứng từ bằng Camera trong app** (ví dụ biên lai nộp tiền tại quầy hoặc ATM): hiện màn hình giải thích rồi mới xin quyền Camera ở lần dùng đầu; từ chối quyền vẫn gửi được bằng cách chọn ảnh từ thư viện; chỉ chụp ảnh, không quay video, không lưu ảnh vào thư viện máy
52. **Kiểm tra ảnh trước khi gửi:** định dạng, dung lượng tối đa, nén bớt, xem lại, thay ảnh khác trước khi gửi; xóa thông tin vị trí và siêu dữ liệu trong ảnh
53. **Gửi thêm ảnh hoặc ghi chú** khi nhà xe yêu cầu bổ sung
54. **Trạng thái thanh toán của đơn:** chờ chuyển khoản, đã gửi chứng từ (đã giữ ghế), chờ xác nhận, đã xác nhận, bị từ chối cần gửi lại, **ghế bị người khác lấy trước**, hết hạn
55. **Khi ghế bị người khác lấy trước:** app báo rõ ngay khi gửi chứng từ, giữ nguyên ảnh đã gửi, và cho chọn **đổi sang ghế khác còn trống cùng chuyến**, **chuyển sang chuyến khác**, hoặc **yêu cầu hoàn tiền**; tiền đã chuyển không bị mất vì nhà xe ghi nhận và hoàn theo quy trình
56. **Thông báo rõ khi quá hạn gửi chứng từ** kèm cách đặt lại hoặc liên hệ nhà xe

## Nhóm 6 Khách hàng: Dịch vụ gửi đồ (không đặt ghế)
57. **Tạo yêu cầu gửi đồ:** chọn tuyến và ngày, chọn **văn phòng gửi hàng** và **văn phòng nhận hàng** của nhà xe, nhập người gửi (mặc định là mình) và **người nhận** (tên, SĐT; chọn từ sổ người nhận trong Profile), loại hàng, mô tả bằng chữ, số kiện, cân nặng ước tính, cỡ kiện (nhỏ, vừa, lớn), giá trị khai báo (tùy chọn), ghi chú; không dùng ảnh hàng hóa
58. **Tính cước tự động** theo bảng cước của nhà xe (tuyến, cân nặng, cỡ kiện, phụ phí giá trị khai báo, phí lấy hoặc giao tận nơi nếu chọn), hiện từng khoản trước khi gửi yêu cầu; cước thực tế có thể chỉnh khi nhà xe cân hàng
59. **Danh mục hàng nhận và hàng cấm:** hiện giới hạn cân nặng, kích thước, chính sách bồi thường; bắt buộc tích cam kết hàng không thuộc danh mục cấm trước khi gửi yêu cầu
60. **Lấy hàng và giao hàng tận nơi bằng xe trung chuyển (tùy chọn):** dùng khu vực phục vụ và phí của xe trung chuyển; mặc định khách mang hàng đến văn phòng gửi và người nhận lấy tại văn phòng nhận
61. **Nhà xe xác nhận yêu cầu:** trạng thái chờ xác nhận → được chấp nhận kèm chuyến và cước chốt, hoặc bị từ chối kèm lý do (ví dụ chuyến đã đầy hàng)
62. **Thanh toán cước:** sau khi được chấp nhận, hiện mã QR và số tài khoản như đơn đặt ghế rồi gửi ảnh chứng từ bằng Camera hoặc thư viện; hoặc trả **tiền mặt tại văn phòng khi giao hàng**, nhà xe ghi nhận; **không ghi nợ và không thu hộ tiền hàng (COD)**
63. **Mã nhận hàng:** app tạo mã nhận hàng cho từng đơn; người gửi chia sẻ mã cho người nhận qua Zalo hoặc tin nhắn; nhân viên văn phòng nhập mã khi giao hàng, không quét mã
64. **Theo dõi đơn gửi đồ theo mốc:** đã tạo, nhà xe đã xác nhận, đã thanh toán, nhà xe đã nhận hàng, đã lên xe chuyến (kèm giờ chạy), đã tới văn phòng nhận, đã giao; không định vị xe
65. **Danh sách đơn gửi đồ của tôi:** tab đang xử lý, đã giao, đã hủy; tìm theo mã đơn, tên người nhận
66. **Hủy yêu cầu gửi đồ** theo chính sách của nhà xe (trước khi nhà xe nhận hàng thì hoàn đủ, sau đó theo bảng nhà xe); hiện số tiền hoàn trước khi xác nhận
67. **Chia sẻ thông tin đơn gửi đồ** dạng chữ cho người nhận: mã đơn, mã nhận hàng, văn phòng nhận, giờ dự kiến
68. **Báo sự cố hàng hóa** (chậm, hư hỏng, thất lạc) bằng chữ, tự gắn vào khiếu nại của đơn
69. **(mới)** **Nhắc người gửi khi hàng đã tới nơi** nhưng chưa có người nhận sau số giờ nhà xe đặt, hiện trên Home và trong thông báo

## Nhóm 7 Khách hàng: Vé và đơn của tôi (từ Home và Profile)
70. **Danh sách đơn theo tab:** cần thanh toán, sắp đi, đã đi, đã hủy; tìm theo mã đặt chỗ, tên, tuyến, không dấu
71. **Vé điện tử trong app:** mã đặt chỗ, ghế, giờ, văn phòng lên xe và xuống xe, giờ và địa chỉ xe trung chuyển, tên nhà xe; mã đặt chỗ dạng chữ, không quét mã
72. **Yêu cầu hủy** theo chính sách nhà xe; app tự tính số tiền hoàn theo mốc thời gian
73. **Hiển thị phí hủy** và số tiền hoàn dự kiến trước khi xác nhận hủy
74. **Yêu cầu đổi chuyến hoặc đổi ngày** theo quy tắc nhà xe, hiện chênh lệch giá
75. **Yêu cầu đổi ghế** gửi quản trị viên duyệt
76. **Sửa hoặc bỏ xe trung chuyển** trước hạn đăng ký của nhà xe; quá hạn thì chỉ liên hệ nhà xe
77. **Lịch sử thay đổi của đơn** (đổi ghế, đổi chuyến, hủy, hoàn) với thời điểm
78. **Xem báo trễ hoặc sự cố chuyến** nhà xe ghi, hiện ngay trong đơn
79. **Chia sẻ thông tin chuyến** dạng chữ sang Zalo hoặc ứng dụng khác (giờ, văn phòng lên xe, mã đặt chỗ, không chứa chứng từ)
80. **(mới)** **Trao đổi trong đơn:** khung chat văn bản với quản trị viên gắn với từng đơn, có báo cáo, không gửi ảnh qua khung này

## Nhóm 8 Khách hàng: Tab Profile, thông tin và dữ liệu lưu sẵn
81. **Thẻ thông tin người dùng đầu Profile:** tên, email, SĐT, hạng thành viên, số điểm; ảnh đại diện là chữ cái đầu và màu tự chọn, không dùng ảnh
82. **Sửa thông tin cá nhân:** tên, SĐT, ngày sinh và giới tính (tùy chọn); đổi email cần xác nhận mật khẩu
83. **Hành khách đi cùng đã lưu:** danh sách người thân hoặc bạn bè (tên, SĐT, ghi chú) để đặt nhanh cho nhiều người, thêm, sửa, xóa
84. **Địa chỉ đã lưu cho xe trung chuyển** (Nhà, Công ty, tên tự đặt): khu vực, địa chỉ chữ, ghi chú; chọn nhanh khi đặt xe trung chuyển
85. **Sở thích khi đặt chuyến:** văn phòng lên xe và xuống xe thường dùng, loại ghế ưa thích, mặc định bật hoặc tắt trung chuyển; tự điền sẵn khi đặt
86. **Sổ người nhận hàng đã lưu:** tên, SĐT, địa chỉ nhận (chữ), ghi chú; chọn nhanh khi gửi đồ
87. **Tuyến và văn phòng yêu thích**
88. **Tài khoản nhận hoàn tiền:** tên chủ tài khoản, số tài khoản, ngân hàng (chữ) lưu sẵn để nhà xe chuyển hoàn nhanh; chỉ quản trị viên xem khi xử lý hoàn
89. **(mới)** **Liên hệ khẩn cấp:** tên và SĐT người thân, chỉ quản trị viên xem được khi chuyến gặp sự cố

## Nhóm 9 Khách hàng: Tab Profile, hoạt động và quyền lợi
90. **Lịch sử chuyến đã đi** theo tháng, bấm xem chi tiết và đặt lại nhanh
91. **(mới)** **Thống kê cá nhân:** số chuyến đã đi, tổng chi, tuyến hay đi nhất, số điểm tích lũy trong năm
92. **(mới)** **Điểm thân thiết và hạng thành viên:** xem số điểm, lịch sử cộng và trừ điểm, quyền lợi từng hạng, dùng điểm để giảm giá theo quy tắc nhà xe; sổ điểm nội bộ, không phải ví và không quy đổi thành tiền mặt
93. **Ví mã giảm giá:** mã còn hiệu lực, đã dùng, hết hạn; điều kiện áp dụng từng mã
94. **(mới)** **Mã giới thiệu bạn bè:** chia sẻ mã của mình; khi bạn mới hoàn thành chuyến đầu thì cả hai nhận mã giảm giá theo quy tắc nhà xe
95. **Yêu cầu hủy, đổi và hoàn tiền của tôi:** trạng thái từng yêu cầu, ngày nhà xe ghi nhận hoàn, số tiền
96. **Danh sách chờ của tôi:** chuyến đang chờ ghế, hủy chờ
97. **Đánh giá của tôi:** đã viết, chờ viết, sửa hoặc xóa đánh giá; xem phản hồi của nhà xe
98. **Đánh giá chuyến** (sao và chữ) sau khi chuyến hoàn thành; chỉ khách có đơn đã xác nhận mới đánh giá được
99. **Đơn gửi đồ của tôi:** lối tắt đến danh sách đơn gửi đồ
100. **Báo cáo đánh giá hoặc tin nhắn vi phạm,** chọn lý do, gửi đến quản trị viên
101. **Khiếu nại của tôi:** gửi khiếu nại về đơn, theo dõi trạng thái xử lý và phản hồi

## Nhóm 10 Khách hàng: Tab Profile, cài đặt, bảo mật và trợ giúp
102. **Đa ngôn ngữ:** Tiếng Việt và English, mặc định theo hệ thống, đổi có hiệu lực ngay; ngày, giờ, số, tiền theo ngôn ngữ; thông báo lỗi máy chủ dịch theo mã lỗi; ngôn ngữ ưa thích lưu theo tài khoản
103. **Light/Dark theme** và **cỡ chữ** (nhỏ, vừa, lớn)
104. **Cài đặt thông báo trong app:** chọn nhóm thông báo muốn hiện (khuyến mãi, tin nhà xe); thông báo về đơn và chuyến luôn bật
105. **Đổi mật khẩu,** đăng xuất các thiết bị khác sau khi đổi
106. **Thiết bị đã đăng nhập:** danh sách, lần hoạt động cuối, đăng xuất từ xa
107. **Trung tâm trợ giúp và câu hỏi thường gặp,** gồm hướng dẫn chuyển khoản và gửi ảnh chứng từ
108. **Liên hệ nhà xe:** gọi, sao chép SĐT hoặc gửi biểu mẫu đến quản trị viên
109. **Giới thiệu app:** phiên bản, điều khoản, chính sách quyền riêng tư, giấy phép thư viện
110. **Xuất lịch sử đặt chỗ của tôi** qua trình chọn tệp của hệ thống
111. **Quyền riêng tư:** xem dữ liệu của mình trong app, xem chính sách lưu ảnh chứng từ và địa chỉ trung chuyển, ảnh tự xóa sau số ngày quy định kể từ khi chuyến hoàn thành
112. **Xóa tài khoản và dữ liệu** ngay trong app, có xác nhận mật khẩu; chặn xóa khi còn chuyến chưa hoàn thành hoặc đơn đang chờ hoàn; kèm đường dẫn web yêu cầu xóa
113. **Đăng xuất** ở cuối Profile

---

# PHẦN B: QUẢN TRỊ VIÊN (app doanh nghiệp)

*Mọi tính năng trong phần này chỉ hiện và dùng được khi đăng nhập bằng tài khoản quản trị viên; máy chủ kiểm tra vai trò ở mọi endpoint quản trị. Không có trang web quản trị riêng. Giao diện giống một app quản lý doanh nghiệp, thanh điều hướng dưới có 5 tab: **Tổng quan, Cần xác nhận, Chuyến, Quản lý, Tài khoản.** Nút **"+"** ở tab Tổng quan và tab Chuyến mở nhanh **Đặt ghế hộ** và **Nhận gửi đồ hộ**. Quản trị viên làm mọi việc: nhập dữ liệu, xác nhận chứng từ, xếp chỗ, ghi nhận ngày chạy, xử lý báo cáo. "Nhân viên" và tài xế chỉ là hồ sơ do quản trị viên quản lý, không có tài khoản và không đăng nhập.*

## Nhóm 11 Quản trị viên: Khởi đầu và tài khoản
114. **Tài khoản quản trị mặc định:** được tạo sẵn **ở máy chủ khi khởi tạo hệ thống** (không nằm trong mã app); đăng nhập bằng cùng màn hình đăng nhập; **bắt buộc đổi mật khẩu ở lần đăng nhập đầu**; không có đăng ký quản trị viên trong app
115. **Màn hình sau đăng nhập tự theo vai trò:** quản trị viên vào thẳng tab Tổng quan, không thấy luồng đặt chỗ của khách
116. **Danh sách việc khởi động:** đổi mật khẩu mặc định, nhập hồ sơ nhà xe, thông tin nhận chuyển khoản, văn phòng, xe, tài xế, tuyến, chuyến đầu tiên; có đánh dấu hoàn thành
117. **Phiên đăng nhập, đăng xuất, quên và đổi mật khẩu** như khách hàng (tính năng 8); giới hạn số lần thử đăng nhập

## Nhóm 12 Quản trị viên: Tab Tổng quan (số liệu doanh nghiệp)
118. **Thẻ doanh thu:** hôm nay, 7 ngày, tháng này, so với kỳ trước (tăng hoặc giảm bao nhiêu phần trăm); doanh thu tính theo chứng từ **đã xác nhận** trừ đơn đã hoàn
119. **Biểu đồ doanh thu** 7 ngày và 30 ngày, chạm vào cột để xem số tiền và số đơn trong ngày
120. **Thẻ số xe:** tổng số xe, đang hoạt động, đang bảo dưỡng, ngừng khai thác, số xe sắp hết hạn giấy tờ
121. **Thẻ nhân viên:** tổng số hồ sơ nhân viên theo loại (tài xế limo, tài xế trung chuyển, nhân viên văn phòng), số người nghỉ hôm nay
122. **Thẻ lịch cần xác nhận:** số chứng từ chờ xác nhận, yêu cầu hủy, yêu cầu đổi, đơn mất ghế, báo cáo và khiếu nại chờ; bấm vào mở tab Cần xác nhận đúng mục
123. **Thẻ dịch vụ gửi đồ:** số đơn gửi đồ hôm nay, đơn chờ xác nhận, hàng đang chờ giao tại văn phòng, doanh thu gửi đồ
124. **Thẻ chuyến hôm nay:** số chuyến, số khách, tỷ lệ lấp đầy, chuyến chưa xếp xe hoặc tài xế
125. **Đơn mới gần đây** và đơn chờ lâu nhất kèm số phút đã chờ
126. **Tuyến bán chạy** và khung giờ bán chạy trong kỳ đã chọn
127. **Chọn khoảng thời gian** (hôm nay, 7 ngày, tháng, tùy chọn) áp cho toàn bộ thẻ
128. **(mới)** **Cảnh báo cần chú ý:** xe sắp đến hạn đăng kiểm, bảo hiểm hoặc bảo dưỡng; bằng lái tài xế sắp hết hạn; chuyến ít khách sắp chạy
129. **Kéo để làm mới,** hiện thời điểm cập nhật cuối và báo lỗi mạng rõ ràng

## Nhóm 13 Quản trị viên: Đặt hộ khách và bán tại quầy (khách không dùng app)
130. **Nút "+" nhanh** ở tab Tổng quan và Chuyến: **Đặt ghế hộ** và **Nhận gửi đồ hộ**
131. **Đặt ghế hộ khách không dùng app** (người nhà, khách gọi điện, khách tại quầy): chọn chuyến, chọn ghế trên sơ đồ, văn phòng lên và xuống xe, xe trung chuyển nếu cần, nhập tên và SĐT từng hành khách; **không cần tài khoản khách hàng**
132. **Cách thu tiền khi đặt hộ:** tiền mặt tại quầy, chuyển khoản trực tiếp (đối chiếu sao kê rồi ghi nhận), hoặc **miễn phí (ghế tặng, người nhà)** kèm lý do bắt buộc; **không có "chưa thu" hay ghi nợ**; ghế được giữ ngay khi quản trị viên xác nhận đã thu
133. **Ghế miễn phí hoặc giá đặc biệt:** nhập giá riêng hoặc 0 đồng, lý do bắt buộc, ghi vào lịch sử đơn; báo cáo riêng số ghế tặng và giá trị
134. **Báo trùng ghế:** khi ghế đã có đơn khác gửi chứng từ chờ xác nhận thì báo và gợi ý ghế còn trống; không lấy ghế của đơn đã gửi chứng từ trước
135. **Hồ sơ khách không dùng app:** tên, SĐT, ghi chú, lịch sử đơn; tự gợi ý khi nhập SĐT đã có
136. **Gắn đơn vào tài khoản khi khách đăng ký sau:** ghép theo SĐT sau khi quản trị viên xác nhận, khách thấy vé trong app; ghi lịch sử
137. **Gửi vé dạng chữ cho khách** qua Zalo, tin nhắn hoặc ứng dụng khác: mã đặt chỗ, ghế, giờ, văn phòng, giờ xe trung chuyển
138. **Sửa, đổi ghế, hủy và hoàn** đơn đặt hộ giống đơn của khách; đơn ghi nguồn "đặt hộ", lọc và thống kê theo nguồn
139. **Nhận gửi đồ hộ khách tại quầy:** nhập thông tin như yêu cầu của khách, cân thực tế, tính cước, thu tiền mặt hoặc chuyển khoản, chia sẻ mã đơn và mã nhận hàng dạng chữ cho người gửi

## Nhóm 14 Quản trị viên: Tab Cần xác nhận (lịch và hàng đợi xử lý)
140. **Hàng đợi chứng từ chờ xác nhận,** xếp theo **thời điểm gửi chứng từ** (ai gửi trước ở trên), hiện số phút đã chờ và hạn xử lý; lọc theo chuyến, trạng thái
141. **Lịch cần xác nhận:** xem theo ngày và tuần, mỗi ngày hiện số việc cần xác nhận gắn với chuyến chạy ngày đó
142. **Xem ảnh chứng từ phóng to** cạnh thông tin đơn (số tiền, mã đơn, giờ gửi, ghế) để đối chiếu với sao kê ngân hàng
143. **Xác nhận hoặc từ chối chứng từ** kèm lý do; chỉ quản trị viên làm được; từ chối thì ghế được nhả cho đơn gửi chứng từ kế tiếp
144. **Xác nhận nhiều đơn một lúc** sau khi tick từng đơn đã đối chiếu, có màn hình xác nhận lại
145. **Yêu cầu bổ sung chứng từ** (ảnh mờ, thiếu thông tin) kèm ghi chú gửi lại cho khách
146. **(mới)** **Cảnh báo nghi trùng chứng từ:** máy chủ tính dấu vân tay nội dung ảnh (băm) và báo khi cùng một ảnh được dùng cho nhiều đơn; chỉ là cảnh báo, không tự kết luận gian lận
147. **Đơn mất ghế cần xử lý:** khách đã gửi chứng từ nhưng ghế bị người khác gửi trước; gợi ý ghế còn trống cùng chuyến, chuyển chuyến khác hoặc hoàn tiền; theo dõi đến khi xong
148. **Yêu cầu hủy:** duyệt theo chính sách đã lưu trong đơn, số tiền hoàn tự tính
149. **Ghi nhận hoàn tiền:** ngày, số tiền, ghi chú, tài khoản nhận hoàn của khách; app không chuyển tiền
150. **Duyệt yêu cầu đổi ghế** của khách
151. **Duyệt yêu cầu đổi chuyến hoặc đổi ngày,** tính chênh lệch giá
152. **Hàng đợi yêu cầu gửi đồ chờ xác nhận:** xem thông tin, **chấp nhận** (chọn chuyến, chốt cước, chỉnh được) hoặc **từ chối** kèm lý do; chứng từ cước gửi đồ nằm chung hàng đợi chứng từ, dùng cùng cách xác nhận và cảnh báo trùng
153. **Hộp xử lý báo cáo vi phạm và khiếu nại** chờ xử lý (chi tiết ở nhóm Đánh giá, báo cáo)
154. **Ghi chú nội bộ** trên từng đơn, chỉ quản trị viên thấy
155. **Lịch sử xử lý đơn** với người thực hiện và thời điểm
156. **Tự đóng đơn quá hạn gửi chứng từ** (chưa có ảnh thì đơn không giữ ghế, chỉ đóng để dọn danh sách); hạn gửi và hạn xử lý đặt được trong cấu hình

## Nhóm 15 Quản trị viên: Tab Chuyến (lịch chuyến và ngày chạy)
157. **Lịch chuyến theo ngày và tuần** theo xe và tài xế; trạng thái từng chuyến bằng màu
158. **Tạo chuyến:** tuyến, ngày giờ khởi hành, xe, tài xế, giá
159. **Chuyến lặp theo lịch** (hằng ngày, theo thứ) có ngoại lệ nghỉ hoặc đổi giờ một lần; chuyến sinh theo cửa sổ thời gian, không sinh vô hạn
160. **Giá theo chuyến, theo loại ghế, theo khung giờ**
161. **Đổi giá chuyến chưa bán;** đơn đã đặt giữ nguyên giá tại thời điểm đặt
162. **Giờ mở bán và đóng bán** (ví dụ đóng bán trước giờ chạy 2 giờ)
163. **Trạng thái chuyến:** mở bán, hết chỗ, đã đóng bán, đang chạy, hoàn thành, đã hủy
164. **Hủy chuyến** và xử lý các đơn hiện có (hoàn tiền hoặc chuyển chuyến), thông báo khách trong app
165. **Chuyển khách sang chuyến khác** cùng tuyến, giữ lịch sử
166. **Đổi xe hoặc tài xế sát giờ,** cập nhật khách và danh sách ghế
167. **(mới)** **Gợi ý ghép chuyến:** hai chuyến ít khách cùng tuyến và gần giờ nhau để cân nhắc gộp; chỉ là gợi ý
168. **Xem sơ đồ ghế của chuyến:** ghế trống, ghế có người gửi chứng từ, ghế đã bán, ghế khóa; chạm vào ghế xem đơn và số người đang chọn
169. **Xếp chỗ:** giữ ghế khách chọn hoặc đổi sang ghế khác kèm lý do, khách thấy thay đổi trong đơn
170. **Xếp theo nhóm** (đi cùng nhau ngồi gần nhau)
171. **Khóa ghế thủ công** (ghế nhà xe giữ lại, ghế hỏng, ghế giữ cho khách đặc biệt)
172. **(mới)** **Danh sách chờ:** xem khách đăng ký chờ khi chuyến hết chỗ; khi có ghế trống do hủy, hiện gợi ý liên hệ khách chờ theo thứ tự
173. **Danh sách hành khách của chuyến:** tên, SĐT, ghế, văn phòng lên xe, ghi chú, liên hệ khẩn cấp; không hiện email hay chứng từ
174. **Danh sách xe trung chuyển của chuyến,** chia chiều đón và chiều trả, nhóm theo văn phòng và khu vực: tên, SĐT, địa chỉ, ghi chú, giờ dự kiến, số ghế; ghi người phụ trách xe trung chuyển (tên, biển số, SĐT, nhập chữ); đánh dấu đã đón hoặc đã trả, hoặc khách không có mặt
175. **Điểm danh lên xe thủ công** theo tên và ghế (không quét mã)
176. **Đánh dấu vắng mặt hoặc không đến** và xử lý theo chính sách nhà xe
177. **Ghi giờ xuất bến và giờ đến bến thực tế** do quản trị viên nhập theo thông tin tài xế báo
178. **Ghi báo trễ hoặc sự cố chuyến** bằng chữ; khách thấy trong đơn
179. **(mới)** **Thông báo cho cả chuyến:** nhập nội dung tự do (trễ giờ, đổi điểm đón, nhắc có mặt) và gửi cho tất cả khách của chuyến; hiện trong trung tâm thông báo của app
180. **(mới)** **Gửi danh sách khách, danh sách trung chuyển và danh sách hàng gửi cho tài xế dạng chữ** sang Zalo hoặc ứng dụng khác để tài xế dùng ngoài app
181. **Danh sách hàng gửi trên chuyến:** mã đơn, người gửi, người nhận, loại hàng, số kiện, cân nặng, văn phòng gửi và nhận, trạng thái; tổng cân và số kiện so với giới hạn tải của chuyến
182. **Cập nhật mốc cho hàng:** đã nhận hàng tại văn phòng, đã lên xe, đã tới văn phòng nhận, **đã giao (nhập mã nhận hàng của người nhận)**, không có người nhận; ghi người thực hiện và giờ
183. **Xử lý sự cố hàng:** ghi nhận hư hỏng, thất lạc, bồi thường theo chính sách (nhà xe chuyển tiền ngoài app); liên kết với khiếu nại của khách
184. **Danh sách việc trước giờ chạy** do quản trị viên tự soạn (kiểm tra xe, đối chiếu danh sách khách, liên hệ tài xế), đánh dấu hoàn thành theo chuyến

## Nhóm 16 Quản trị viên: Tab Quản lý, xe và sơ đồ ghế
185. **Danh sách xe:** biển số, loại xe, số chỗ, năm sản xuất, màu, ghi chú
186. **Sơ đồ ghế:** mẫu theo loại xe (9, 11, 16 chỗ) hoặc tự dựng bằng lưới, đánh số ghế và vị trí; ghế tài xế không bán
187. **Loại ghế và phụ thu** (hàng đầu, ghế cạnh cửa, ghế giường nằm)
188. **Tiện ích trên xe** (sạc, nước, wifi, chăn) dạng nhãn
189. **Trạng thái xe:** hoạt động, đang bảo dưỡng, ngừng khai thác; xe không hoạt động không thể gán vào chuyến
190. **Hạn giấy tờ xe** (đăng kiểm, bảo hiểm) nhập ngày, danh sách sắp hết hạn; **không lưu ảnh giấy tờ**
191. **Lịch bảo dưỡng và chi phí** từng lần
192. **Tài xế mặc định của xe** (gợi ý khi tạo chuyến, sửa được từng chuyến)
193. **(mới)** **Cảnh báo xe sắp đến hạn đăng kiểm, bảo hiểm hoặc bảo dưỡng** trong tuần tới, hiện ở tab Tổng quan

## Nhóm 17 Quản trị viên: Tab Quản lý, nhân viên và tài xế (hồ sơ, không có tài khoản)
194. **Danh sách nhân viên theo loại:** tài xế limo, tài xế trung chuyển, nhân viên văn phòng; trạng thái đang làm hoặc nghỉ việc
195. **Hồ sơ nhân viên:** tên, SĐT, chức vụ, văn phòng làm việc (với nhân viên văn phòng), ngày vào làm, ghi chú; không lưu ảnh giấy tờ, không có tài khoản đăng nhập
196. **Hồ sơ tài xế:** hạng bằng (chữ), ngày hết hạn bằng nhập tay; cảnh báo sắp hết hạn
197. **Lịch làm việc và ngày nghỉ** của nhân viên và tài xế
198. **Phân ca nhân viên văn phòng** theo ngày (ca sáng, ca chiều) để biết văn phòng nào có người trực
199. **Kiểm tra trùng lịch tài xế:** một tài xế không được xếp hai chuyến chồng giờ, và phải đủ thời gian nghỉ tối thiểu giữa hai chuyến do nhà xe đặt
200. **Phân tài xế cho từng chuyến:** mỗi chuyến một xe và đúng một tài xế; chuyến chưa có tài xế bị đánh dấu "chưa xếp"
201. **(mới)** **Gợi ý tài xế phù hợp** theo lịch trống, số giờ lái trong tuần và tuyến quen
202. **Tiền công tài xế theo chuyến** nhập tay, tính vào chi phí chuyến

## Nhóm 18 Quản trị viên: Tab Quản lý, nhà xe, văn phòng và thanh toán
203. **Hồ sơ nhà xe:** tên nhà xe, mô tả, SĐT, địa chỉ trụ sở, giờ làm việc, người đại diện, số giấy phép kinh doanh vận tải (nhập chữ); hiện cho khách hàng
204. **Thông tin nhận chuyển khoản:** chọn ngân hàng từ danh mục, số tài khoản, tên chủ tài khoản; app tự tạo mã QR chuyển khoản cho từng đơn; có màn hình **xem trước QR** và nút kiểm tra bằng đơn thử trước khi dùng thật
205. **Chính sách hủy và hoàn** dạng bảng mốc (hủy trước bao nhiêu giờ thì hoàn bao nhiêu phần trăm) và phí hủy
206. **Quy định chung** (hành lý, đồ ăn uống, thú cưng, trẻ em) soạn một lần, hiện trên trang chuyến
207. **Văn phòng theo tỉnh:** mỗi tỉnh có một hoặc nhiều văn phòng; mỗi văn phòng có tên, địa chỉ, SĐT, giờ làm việc, ghi chú chỉ đường (chữ), trạng thái mở hoặc đóng; văn phòng là điểm lên xe và xuống xe mà khách chọn khi đặt vé
208. **Tên nhà xe hiển thị trên vé và báo cáo** lấy từ hồ sơ nhà xe (tính năng 203)
209. **(mới)** **Soạn thông tin hữu ích trên tuyến** (văn phòng, quy định, lưu ý) để hiện cho khách trước chuyến

## Nhóm 19 Quản trị viên: Tab Quản lý, tuyến và xe trung chuyển
210. **Danh sách tuyến:** tuyến có chiều (ví dụ Hà Nội → Thái Bình), điểm đi và điểm đến là **tỉnh hoặc thành phố** lấy từ danh mục chuẩn, thời gian chạy dự kiến
211. **Điểm dừng trung gian** và giờ dự kiến
212. **Văn phòng đón và trả theo tuyến:** chọn các văn phòng ở tỉnh đi làm điểm lên xe và các văn phòng ở tỉnh đến làm điểm xuống xe; mỗi văn phòng có **giờ xe tới** (độ lệch phút so với giờ xuất bến) và thứ tự dừng
213. **Khu vực xe trung chuyển theo văn phòng:** mỗi văn phòng có danh sách khu vực phục vụ (phường, quận, huyện, nhập chữ); mỗi khu vực bật hoặc tắt riêng chiều đón và chiều trả, đặt **phí** (hoặc miễn phí) và **số phút đón trước giờ xe tới văn phòng**
214. **Quy tắc xe trung chuyển:** hạn đăng ký (ví dụ trước giờ chạy 3 giờ), có hay không hoàn phí khi hủy, bật hoặc tắt trung chuyển theo tuyến
215. **Sửa hoặc hủy xe trung chuyển của đơn** (đổi khu vực, địa chỉ, giờ) khi khách liên hệ, ghi lịch sử
216. **Nhân bản tuyến** và tuyến chiều ngược lại
217. **Trạng thái tuyến:** đang mở bán hoặc tạm ngừng
218. **(mới)** **Thời gian chạy thực tế so với dự kiến** của từng tuyến, tự tính từ giờ xuất bến và giờ đến bến đã ghi
219. **Danh mục tỉnh, thành phố chuẩn** (tên, tên không dấu, thứ tự hiển thị): thêm, sửa, ẩn; khách chỉ thấy tỉnh đang có chuyến

## Nhóm 20 Quản trị viên: Tab Quản lý, dịch vụ gửi đồ
220. **Bảng cước gửi đồ theo tuyến:** bậc cân nặng, cỡ kiện, giá từng bậc, giá mỗi kg vượt, phụ phí giá trị khai báo (phần trăm), phí lấy và giao tận nơi theo khu vực
221. **Danh mục loại hàng, hàng nhận và hàng cấm** (nhập chữ), ghi chú đóng gói
222. **Giới hạn tải hàng mỗi chuyến** (kg, số kiện) và theo xe; chuyến đầy thì chặn nhận thêm
223. **Chính sách hủy, hoàn và bồi thường gửi đồ:** mốc hoàn, mức bồi thường tối đa (ví dụ theo giá trị khai báo hoặc bội số cước), thời hạn khiếu nại; hiện cho khách
224. **Bật hoặc tắt dịch vụ gửi đồ** theo tuyến; hạn nhận hàng trước giờ chạy (ví dụ 2 giờ); số giờ nhắc người gửi khi hàng chưa có người nhận

## Nhóm 21 Quản trị viên: Tab Quản lý, khách hàng và khuyến mãi
225. **Danh sách khách hàng:** lần đầu, quay lại, lịch sử đặt chỗ, tổng chi, ghi chú riêng của nhà xe
226. **Khóa và mở khóa tài khoản khách vi phạm,** kèm lý do
227. **Mã giảm giá** (phần trăm hoặc số tiền, điều kiện, hạn dùng, số lượt); phát mã cho từng khách vào ví mã của họ
228. **Giá theo mùa và dịp lễ**
229. **Quy tắc trẻ em:** trẻ nhỏ không chiếm ghế hoặc giá ưu đãi theo độ tuổi do nhà xe đặt
230. **Quy tắc điểm thân thiết và hạng thành viên:** số điểm theo chuyến, mốc hạng, mức quy đổi giảm giá; sổ điểm chỉ ghi thêm, đơn bị hủy tạo bút toán trừ điểm
231. **Quy tắc mã giới thiệu:** phần thưởng cho người giới thiệu và người được giới thiệu, giới hạn số lần

## Nhóm 22 Quản trị viên: Tab Quản lý, đánh giá, báo cáo và nội dung
232. **Phản hồi đánh giá** của khách
233. **Xử lý báo cáo vi phạm:** xem báo cáo về đánh giá và tin nhắn; ẩn nội dung, cảnh cáo hoặc khóa tài khoản người dùng, ghi kết quả
234. **Xử lý khiếu nại đơn hàng:** xem đơn, chứng từ và trao đổi liên quan, ghi kết quả và liên hệ khách
235. **Trao đổi trong đơn:** đọc và trả lời tin nhắn của khách trong từng đơn
236. **Hộp thư liên hệ** từ biểu mẫu "Liên hệ nhà xe"
237. **Soạn câu hỏi thường gặp, điều khoản và chính sách** hiển thị trong app
238. **Thông báo chung** tới khách hàng, hiện trong trung tâm thông báo và thẻ tin trên Home
239. **Lịch sử xử lý** từng báo cáo, khiếu nại và tài khoản bị khóa (không phải nhật ký hệ thống)

## Nhóm 23 Quản trị viên: Tab Quản lý, đối soát và báo cáo
240. **Sổ đối soát theo chuyến:** tổng thu theo chứng từ đã xác nhận, đơn đã hoàn, đơn chờ; để đối chiếu sao kê ngân hàng
241. **Chi phí từng chuyến** (nhiên liệu, phí cầu đường, ăn uống, tiền công tài xế)
242. **Lãi gộp theo chuyến, tuyến và xe**
243. **Tỷ lệ lấp đầy ghế** theo chuyến, tuyến, khung giờ
244. **Doanh thu theo ngày, tuần, tháng** và theo nguồn (đặt qua app hoặc đặt hộ)
245. **Tuyến và khung giờ bán chạy**
246. **Tỷ lệ hủy, tỷ lệ chứng từ bị từ chối và tỷ lệ đơn mất ghế**
247. **Thời gian xác nhận chứng từ trung bình,** từ lúc khách gửi đến lúc quản trị viên xử lý
248. **Doanh thu và số đơn gửi đồ** theo tuyến, theo tháng; tải hàng trung bình mỗi chuyến
249. **Báo cáo ghế tặng và giá trị miễn giảm** theo tháng và theo lý do
250. **Doanh thu và số chuyến của xe trung chuyển** theo khu vực
251. **Xuất báo cáo Excel/PDF** nội bộ
252. **(mới)** **Dự báo nhu cầu** theo ngày trong tuần và dịp lễ để gợi ý thêm chuyến; chỉ là ước tính, không dự báo khi dữ liệu còn ít
253. **(mới)** **Số ghế hòa vốn từng chuyến** = chi phí chuyến ÷ giá vé bình quân; ghi rõ là ước tính

## Nhóm 24 Quản trị viên: Tab Tài khoản và cài đặt
254. **Hồ sơ quản trị viên:** tên, email, SĐT, ngôn ngữ; thanh đầu app hiện tên và vai trò
255. **Cấu hình hệ thống:** hạn gửi chứng từ, hạn xử lý chứng từ, dung lượng ảnh tối đa, thời gian lưu ảnh chứng từ
256. **Quản lý quản trị viên:** thêm hoặc thu hồi quản trị viên (chỉ quản trị viên hiện tại làm được), đặt lại mật khẩu
257. **Tìm kiếm toàn cục** đơn, khách hàng, chuyến, mã đặt chỗ, không dấu
258. **Nhập tuyến, xe, nhân viên hàng loạt từ CSV,** có xem trước và báo lỗi
259. **Thiết bị đã đăng nhập:** danh sách, đăng xuất từ xa
260. **Xóa tài khoản quản trị** ngay trong app, có xác nhận mật khẩu; quản trị viên cuối cùng không xóa được
261. **Đa ngôn ngữ** Tiếng Việt và English như khách hàng (tính năng 102)
262. **Light/Dark theme**
263. **Xuất dữ liệu** chuyến, đơn và đối soát qua trình chọn tệp của hệ thống

---

## Data schema (máy chủ)

Máy chủ là nơi lưu dữ liệu chính (cơ sở dữ liệu quan hệ). App giữ bản sao nhỏ trong Room chỉ để hiển thị vé và danh sách vừa xem; **không có dữ liệu nào được tạo ở app mà không qua máy chủ**. Khóa chính dùng UUID. Tiền lưu **số nguyên đồng**. Thời điểm chuyến lưu cả **ngày giờ địa phương và độ lệch múi giờ**. Mọi bảng có `createdAt`, `updatedAt`. **Chỉ có một nhà xe nên không có `businessId` trong các bảng.**

```
Account(id, email, passwordHash, displayName, phone, role, language, status, mustChangePassword)
                                          // role: customer / admin
RefreshSession(id, accountId, deviceName, tokenHash, expiresAt, revokedAt)
OperatorProfile(id, name, description, phone, address, openText, representativeName, licenseNoText)   // đúng một dòng
BankCatalog(code, bin, name)                                  // danh mục ngân hàng để tạo QR
BankInfo(id, bankCode, accountNo, holderName)              // đúng một dòng; đơn lưu bản sao trong bankSnapshotJson
CancelPolicyTier(id, hoursBefore, refundPercent)
OperatorRule(id, kind, text)                                // quy định chung
Province(id, name, nameNoAccent, sortOrder, isActive)
Office(id, provinceId, name, address, phone, openText, directionNote, isActive)
Vehicle(id, plateNo, kindLabel, seatCount, year, colorText, status, defaultDriverId, note)
SeatLayout(id, name, rows, cols)
SeatDef(id, layoutId, label, row, col, seatClass, isSellable)
VehicleAmenity(id, vehicleId, label)
VehicleDocDate(id, vehicleId, kind, expiresOn)              // chỉ ngày, không ảnh
MaintenanceLog(id, vehicleId, date, description, cost)
StaffMember(id, kind, name, phone, positionText, officeId, joinedOn, licenseClassText, licenseExpiresOn, status)   // kind: limo_driver / shuttle_driver / office_staff; hồ sơ, không có tài khoản
StaffSchedule(id, staffId, date, kind, note)              // làm việc / nghỉ
Route(id, name, fromProvinceId, toProvinceId, durationMinutes, status)
RouteStop(id, routeId, name, sortOrder, offsetMinutes)
RouteOffice(id, routeId, officeId, side, offsetMinutes, sortOrder)   // side: lên xe / xuống xe
ShuttleZone(id, officeId, name, pickupEnabled, dropEnabled, extraFee, leadMinutes, isActive)   // khu vực xe trung chuyển của từng văn phòng
ShuttleRequest(id, bookingId, direction, officeId, zoneId, addressText, noteText, fee, plannedAt, status)   // direction: đón / trả; status: chờ / đã đón-trả / khách vắng / hủy
TripShuttleDuty(id, tripId, officeId, direction, dutyText)   // người phụ trách xe trung chuyển, nhập chữ
TripSeries(id, routeId, vehicleId, driverId, daysMask, departMinute, startDate, endDate)
TripException(id, seriesId, date, type, newDepartMinute, note)
Trip(id, routeId, vehicleId, driverId, departAt, status, salesOpenAt, salesCloseAt, seriesId)
TripPrice(id, tripId, seatClass, price)
TripSeat(id, tripId, seatDefId, state, claimedBookingSeatId, claimedAt)   // state: trống / đã có chứng từ / đã bán / khóa; duy nhất (tripId, seatDefId) cho trạng thái đã có chứng từ hoặc đã bán
                                          // số người đang chọn = đếm đơn chưa gửi chứng từ còn hạn có ghế này, không có bảng riêng
Booking(id, code, tripId, customerAccountId, status, totalAmount, discountAmount, pickupOfficeId,
        dropOfficeId, note, payDeadline, createdBySide, guestContactId, compReason, bankSnapshotJson,
        cancelPolicySnapshotJson, idempotencyKey)
BookingSeat(id, bookingId, tripSeatId, passengerName, passengerPhone, seatPrice, surcharge, isChild, claimState)   // claimState: đang chọn / đã giữ / mất ghế
BookingChange(id, bookingId, at, byAccountId, kind, oldValue, newValue, note)
PaymentProof(id, orderType, orderId, fileId, contentHash, status, uploadedAt, reviewedBy, reviewedAt, rejectReason)
PaymentNote(id, orderType, orderId, byAccountId, text, at)           // yêu cầu bổ sung chứng từ
Refund(id, orderType, orderId, amount, status, recordedBy, recordedAt, note)   // chỉ ghi nhận
FileObject(id, ownerAccountId, kind, mime, sizeBytes, storageKey, deleteAfter)
Promotion(id, code, kind, value, minAmount, startAt, endAt, usageLimit, usedCount)
SeasonalPrice(id, routeId, fromDate, toDate, adjustKind, adjustValue)
LoyaltyEntry(id, accountId, points, reason, refId, at)      // chỉ ghi thêm
Waitlist(id, tripId, accountId, seatCount, status, createdAt)
Review(id, bookingId, accountId, stars, text, reply, status, createdAt)
Report(id, reporterAccountId, targetType, targetId, reason, text, status, resolution)
Complaint(id, bookingId, accountId, text, status, resolution)
OrderMessage(id, bookingId, senderAccountId, text, at, status)
Notification(id, accountId, category, kind, refType, refId, text, readAt, createdAt)
TripLog(id, tripId, kind, atTime, text, byAccountId)        // xuất bến, đến bến, sự cố, báo trễ
BoardingMark(id, tripId, bookingSeatId, state, markedBy, markedAt)   // lên xe / vắng
TripExpense(id, tripId, category, amount, note)
Announcement(id, title, body, startAt, endAt, createdBy)
AdminAction(id, adminAccountId, targetType, targetId, action, note, at)   // lịch sử xử lý báo cáo, khiếu nại, khóa tài khoản
FaqItem(id, language, question, answer, sortOrder)
ChecklistItem(id, title, sortOrder)
ChecklistRun(id, tripId, itemId, isDone, doneBy)
GuestContact(id, name, phone, note, linkedAccountId)       // khách không dùng app, do quản trị viên nhập
PaymentRecord(id, orderType, orderId, method, amount, recordedBy, recordedAt, note)   // method: tiền mặt / chuyển khoản trực tiếp / miễn phí; do quản trị viên ghi nhận
Parcel(id, code, senderAccountId, guestContactId, createdBySide, senderName, senderPhone, receiverName, receiverPhone,
       routeId, tripId, fromOfficeId, toOfficeId, categoryId, descriptionText, pieceCount, weightKg, sizeClass,
       declaredValue, fee, feeBreakdownJson, pickupShuttleJson, dropShuttleJson, status, handoverCodeHash,
       cancelPolicySnapshotJson, bankSnapshotJson, idempotencyKey)
       // status: chờ xác nhận / được chấp nhận / chờ thanh toán / đã thanh toán / đã nhận hàng / đã lên xe / đã tới nơi / đã giao / đã hủy / từ chối / sự cố
ParcelEvent(id, parcelId, at, kind, byAccountId, note)
ParcelCategory(id, name, isProhibited, note)
ParcelRate(id, routeId, maxWeightKg, sizeClass, price, extraPerKg, declaredValuePercent)
TripParcelCapacity(id, tripId, maxKg, maxPieces)
SavedReceiver(id, accountId, name, phone, addressText, note)
SavedPassenger(id, accountId, name, phone, note)
SavedAddress(id, accountId, label, zoneId, addressText, noteText)
RefundAccount(id, accountId, holderName, accountNo, bankName)
EmergencyContact(id, accountId, name, phone)
UserPreference(id, accountId, defaultPickupOfficeId, defaultDropOfficeId, seatPref, shuttleDefault, fontScale, notifyPromo)
VoucherWallet(id, accountId, promotionId, status, receivedAt)
MemberTier(id, name, minPoints, benefitText)
Referral(id, referrerAccountId, referredAccountId, status, rewardedAt)
Setting(id, key, value)
```

---

## Thiết kế API (đề xuất)

Mình không biết backend của bạn. Đây là **hợp đồng đề xuất** để backend làm theo. Nếu bạn đã có API sẵn, hãy gửi tài liệu để mình đối chiếu lại.

**Quy ước chung:** chỉ HTTPS; tiền tố `/v1`; JSON; header `Authorization: Bearer <access token>` và `Accept-Language`; lỗi trả `{ "code": "...", "message": "..." }` kèm mã HTTP đúng nghĩa; yêu cầu tạo đơn và tải ảnh có `Idempotency-Key`; danh sách phân trang theo con trỏ. **Mọi endpoint (trừ đăng ký, đăng nhập, quên mật khẩu, kiểm tra sức khỏe) yêu cầu đăng nhập.**

| Chức năng | Endpoint đề xuất | Vai trò |
|---|---|---|
| Đăng ký hành khách | `POST /v1/auth/register` {email, password, displayName, phone} | công khai |
| Đăng nhập, làm mới, đăng xuất | `POST /v1/auth/login`, `/auth/refresh`, `/auth/logout` (login trả `mustChangePassword` cho tài khoản mặc định) | công khai / đã đăng nhập |
| Quên, đặt lại, đổi mật khẩu | `POST /v1/auth/forgot`, `/auth/reset`, `/auth/change-password` | |
| Hồ sơ, xóa tài khoản | `GET/PATCH /v1/me`, `DELETE /v1/me` | khách hàng, quản trị |
| Thông tin nhà xe | `GET /v1/operator` | đã đăng nhập |
| Danh mục tỉnh có chuyến | `GET /v1/provinces?hasTrips=true` | đã đăng nhập |
| Văn phòng theo tỉnh | `GET /v1/provinces/{id}/offices?routeId=` | đã đăng nhập |
| Tìm chuyến | `GET /v1/trips?fromProvinceId=&toProvinceId=&date=&seats=&pickupOfficeId=&sort=` | đã đăng nhập |
| Chi tiết chuyến và sơ đồ ghế | `GET /v1/trips/{id}`, `GET /v1/trips/{id}/seats` | đã đăng nhập |
| Khu vực xe trung chuyển của văn phòng | `GET /v1/offices/{id}/shuttle-zones` | đã đăng nhập |
| Tạo đơn (chưa giữ ghế) | `POST /v1/bookings` {tripId, seats[], pickupOfficeId, dropOfficeId, pickupShuttle?{zoneId, address, note}, dropShuttle?{zoneId, address, note}, promoCode} | khách hàng |
| Xem, hủy đơn | `GET /v1/bookings`, `GET /v1/bookings/{id}`, `POST /v1/bookings/{id}/cancel` | chủ đơn, quản trị |
| Tải chứng từ (đơn gửi sớm nhất được ghế) | `POST /v1/bookings/{id}/proofs` (nhiều phần, ảnh); `GET /v1/proofs/{id}` (liên kết ký có hạn ngắn) | chủ đơn, quản trị |
| Xác nhận chứng từ | `POST /v1/proofs/{id}/approve`, `/reject` {reason} | quản trị |
| Xếp, đổi ghế | `POST /v1/bookings/{id}/assign-seats` | quản trị |
| Đặt ghế hộ khách | `POST /v1/manage/bookings` {tripId, seats[], guest{name, phone}, payMethod: cash/transfer/free, compReason?} | quản trị |
| Quản lý xe, văn phòng, tuyến, chuyến, chuỗi chuyến | `/v1/manage/vehicles`, `/offices`, `/routes`, `/trips`, `/series` (CRUD) | quản trị |
| Xe trung chuyển (khu vực, quy tắc, danh sách của chuyến) | `/v1/manage/shuttle-zones` (CRUD), `GET /v1/manage/trips/{id}/shuttle`, `PATCH /v1/manage/shuttle-requests/{id}` | quản trị |
| Hồ sơ nhà xe, chuyển khoản, chính sách hủy | `PUT /v1/admin/operator`, `/admin/bank-info`, `/admin/cancel-policy` | quản trị |
| Hồ sơ nhân viên và tài xế | `/v1/admin/staff` (CRUD, lịch, ca làm; không có tài khoản) | quản trị |
| Phân tài xế cho chuyến | `PUT /v1/manage/trips/{id}/driver` | quản trị |
| Danh sách hành khách của chuyến | `GET /v1/manage/trips/{id}/manifest` | quản trị |
| Điểm danh, giờ xuất bến, báo trễ | `POST /v1/manage/trips/{id}/boarding`, `POST /v1/manage/trips/{id}/logs` | quản trị |
| Hoàn tiền (ghi nhận) | `POST /v1/bookings/{id}/refund` | quản trị |
| Khuyến mãi | `/v1/admin/promotions` | quản trị |
| Đánh giá, báo cáo, khiếu nại | `POST /v1/reviews`, `POST /v1/reports`, `POST /v1/complaints` | khách hàng |
| Tin nhắn trong đơn | `GET/POST /v1/bookings/{id}/messages` | chủ đơn, quản trị |
| Thông báo trong app | `GET /v1/notifications`, `POST /v1/notifications/read` | khách hàng, quản trị |
| Số liệu | `GET /v1/manage/reports/...` | quản trị |
| Quản trị hệ thống | `/v1/admin/reports`, `/complaints`, `/accounts/{id}/suspend`, `/settings`, `/provinces`, `/announcements`, `/admins` | quản trị |
| Thông tin thanh toán và mã QR của đơn | `GET /v1/bookings/{id}/payment-info` → {bank, accountNo, holderName, amount, transferContent, qrPayload}; `GET /v1/banks` | chủ đơn |
| Dữ liệu lưu sẵn trong Profile | `/v1/me/passengers`, `/me/addresses`, `/me/refund-account`, `/me/emergency`, `/me/preferences` (CRUD) | khách hàng |
| Điểm, hạng, ví mã, giới thiệu | `GET /v1/me/loyalty`, `/me/vouchers`, `/me/referral` | khách hàng |
| Tổng quan doanh nghiệp | `GET /v1/manage/dashboard?from=&to=` | quản trị |
| Hàng đợi cần xác nhận | `GET /v1/manage/inbox?type=proof/cancel/change/lostseat/report`, `GET /v1/manage/calendar?week=` | quản trị |
| Báo giá và tạo yêu cầu gửi đồ | `POST /v1/parcels/quote`, `POST /v1/parcels` | khách hàng |
| Xem, hủy, theo dõi đơn gửi đồ | `GET /v1/parcels`, `GET /v1/parcels/{id}`, `POST /v1/parcels/{id}/cancel`, `POST /v1/parcels/{id}/proofs` | chủ đơn |
| Sổ người nhận | `/v1/me/receivers` (CRUD) | khách hàng |
| Xử lý gửi đồ | `GET /v1/manage/parcels?status=`, `POST /v1/manage/parcels/{id}/accept`, `/reject`, `/status`, `/handover` {code}, `GET /v1/manage/trips/{id}/parcels` | quản trị |
| Nhận gửi đồ hộ khách | `POST /v1/manage/parcels` {sender{name, phone}, receiver, items, payMethod} | quản trị |
| Cước, hàng cấm, giới hạn tải | `/v1/admin/parcel-rates`, `/parcel-categories`, `/parcel-capacity` | quản trị |
| Khách không dùng app | `/v1/admin/guests`, `POST /v1/admin/guests/{id}/link` {accountId} | quản trị |
| Sức khỏe máy chủ | `GET /v1/health` → {status, apiVersion, minAppVersion} | công khai |

**Quy tắc đặt chỗ phía máy chủ:** giữ ghế và tạo đơn trong **một giao dịch**; ràng buộc duy nhất trên (chuyến, ghế) cho trạng thái đang giữ hoặc đã bán nên hai yêu cầu cùng chọn một ghế chỉ một yêu cầu thành công. Lỗi trả mã riêng để app hiện "ghế vừa có người giữ".

**Điều backend phải làm đúng (không thuộc phần app):** băm mật khẩu bằng thuật toán chuyên dụng (Argon2 hoặc bcrypt); giới hạn số lần thử đăng nhập và số lần tải ảnh; kiểm tra vai trò ở mọi endpoint (khách hàng chỉ đọc đơn của mình, mọi endpoint `/manage` và `/admin` chỉ cho quản trị viên); lưu ảnh ở nơi **không công khai**, chỉ cấp liên kết ký có hạn ngắn; kiểm tra loại và kích thước tệp, tự xóa ảnh theo chính sách lưu giữ; xóa dữ liệu thật khi xóa tài khoản; sao lưu máy chủ định kỳ; không ghi dữ liệu cá nhân vào log.

---

## Điểm kỹ thuật cần cẩn thận

- **Tài khoản quản trị mặc định (114):** tạo bằng kịch bản khởi tạo ở máy chủ, **không nằm trong mã app, tệp cấu hình công khai hay tài liệu**. Mật khẩu ban đầu là chuỗi ngẫu nhiên sinh lúc triển khai (chỉ người triển khai biết), `mustChangePassword = true`; chừng nào chưa đổi thì mọi endpoint khác trả lỗi riêng và app chỉ cho vào màn hình đổi mật khẩu. Không có endpoint tạo quản trị viên công khai.
- **Quyền theo vai trò (hai vai trò, 173):** mọi endpoint kiểm tra `role` là `customer` hay `admin`; khách hàng chỉ đọc và sửa dữ liệu của chính mình. Danh sách hành khách của chuyến chỉ quản trị viên xem được và chỉ trả tên, SĐT, ghế, văn phòng lên xe, không trả email hay chứng từ. Khách hàng xem sơ đồ ghế chỉ thấy trạng thái ghế, **không thấy thông tin người đặt**. Tài xế không có tài khoản nên không có quyền nào cần kiểm tra. Ẩn nút ở app **không thay** việc kiểm tra ở máy chủ.
- **Chọn lộ trình, văn phòng và giờ đón (207, 212, 28, 36):** một chuyến khớp tìm kiếm khi tuyến của nó có tỉnh đi và tỉnh đến trùng lộ trình đã chọn. Mỗi văn phòng lên xe có `offsetMinutes` so với `departAt`; **giờ xe tới văn phòng = giờ khởi hành + độ lệch**, tính khi hiển thị. Hành khách chọn văn phòng nào thì `Booking` lưu `pickupOfficeId` (và `dropOfficeId`); đổi hoặc đóng văn phòng sau đó **không âm thầm đổi đơn cũ**, mà báo quản trị viên và hành khách để xử lý. Danh mục tỉnh chỉ hiện tỉnh đang có chuyến mở bán. Tuyến có chiều: Hà Nội → Thái Bình và Thái Bình → Hà Nội là hai tuyến, tính năng 216 giúp nhân bản chiều ngược.
- **Xe trung chuyển (37, 38, 213, 174):** giờ đón dự kiến = giờ xe tới văn phòng − `leadMinutes` của khu vực, tính khi hiển thị; phí lưu vào `ShuttleRequest.fee` **tại lúc đặt** và cộng vào tổng đơn (làm tròn một lần như giá ghế). Máy chủ từ chối khi quá hạn đăng ký (214) hoặc khu vực không thuộc văn phòng đã chọn. Địa chỉ chỉ là chữ khách nhập, **không dùng vị trí, không bản đồ, không theo dõi xe**; quản trị viên kiểm tra thủ công địa chỉ có nằm trong khu vực phục vụ. Địa chỉ nhà là dữ liệu cá nhân: chỉ khách và quản trị viên xem được, xóa theo chính sách lưu giữ và khi xóa tài khoản. Hủy đơn hoặc hủy chuyến thì hủy luôn yêu cầu trung chuyển; phí trung chuyển hoàn theo quy tắc nhà xe đặt. Chiều trả phụ thuộc xe limo đến đúng giờ, nên khi chuyến trễ quản trị viên cần cập nhật giờ trả dự kiến.
- **Chọn ghế và quy tắc chuyển khoản trước có chỗ trước (34, 35, 47, 55, 147):** tạo đơn **không** giữ ghế. Việc nhận ghế xảy ra khi máy chủ nhận xong ảnh chứng từ hợp lệ: trong **một giao dịch**, thử ghi `TripSeat.state = đã có chứng từ` cho từng ghế của đơn; ràng buộc duy nhất (chuyến, ghế) bảo đảm hai yêu cầu cùng lúc chỉ một yêu cầu thắng, so theo giờ máy chủ. Ghế nào thua thì `BookingSeat.claimState = mất ghế`, ảnh vẫn lưu và gắn vào đơn để quản trị viên hoàn hoặc đổi. Số 'n người đang chọn' tính từ các đơn chưa gửi chứng từ còn trong hạn; chỉ là gợi ý, không phải khóa. Quản trị viên từ chối chứng từ hoặc hủy đơn thì nhả ghế (`state = trống`) trong cùng giao dịch. Cần kiểm thử đua tranh thật (nhiều yêu cầu song song).
- **Giá chốt tại lúc đặt (161, 40):** `BookingSeat.seatPrice` và `surcharge` lưu giá tại thời điểm đặt; đổi giá chuyến sau đó không ảnh hưởng đơn cũ. Tổng tiền tính **một lần ở cuối**, phần dư làm tròn dồn vào dòng cuối để tổng khớp với tổng các ghế.
- **Mã giảm giá (41, 227):** tăng `usedCount` trong cùng giao dịch tạo đơn để không vượt số lượt; trả lại lượt khi đơn hết hạn giữ chỗ hoặc bị hủy theo quy tắc.
- **Trạng thái thanh toán (54) là máy trạng thái:** chờ chuyển khoản → đã gửi chứng từ (đã giữ ghế) → chờ xác nhận → đã xác nhận; nhánh phụ: bị từ chối (gửi lại được, ghế nhả), mất ghế (cần đổi ghế, đổi chuyến hoặc hoàn), hết hạn. Mỗi lần chuyển trạng thái ghi `BookingChange` và kiểm tra quyền. Đơn đã xác nhận không quay về chưa thanh toán; muốn sửa phải qua hủy và hoàn.
- **Mã QR chuyển khoản (48, 49, 204):** máy chủ ghép chuỗi QR theo chuẩn QR chuyển khoản liên ngân hàng (mã ngân hàng, số tài khoản, số tiền, nội dung là mã đơn, mã kiểm tra), app chỉ **vẽ** mã bằng thư viện mã hóa QR, không dùng Camera để quét. Không đảm bảo mọi app ngân hàng đọc được nên luôn hiện số tài khoản và cho sao chép. Thông tin ngân hàng được **lưu bản sao vào đơn** lúc tạo (`bankSnapshotJson`) để đổi tài khoản sau không làm sai đơn cũ. Cần thử thật với vài app ngân hàng và đối soát số tiền trước khi phát hành.
- **Tải ảnh chứng từ (50, 52, 146):** app nén và xóa siêu dữ liệu trước khi gửi; máy chủ **kiểm tra lại** loại tệp theo nội dung (không tin đuôi tệp), giới hạn kích thước, kiểm tra ảnh hợp lệ, tính băm (SHA-256) để phát hiện nghi trùng, lưu riêng tư. Tải lên có `Idempotency-Key` để thử lại khi mất mạng không tạo ảnh trùng. Hiển thị cho quản trị viên bằng liên kết ký ngắn hạn, **không dùng địa chỉ công khai**.
- **Cảnh báo nghi trùng (146):** chỉ so băm nội dung, nên ảnh chụp lại hoặc cắt khác đi sẽ không bị bắt; đây là hỗ trợ nhỏ, không phải phát hiện gian lận. Không tuyên bố app xác minh được chứng từ.
- **Lưu giữ ảnh (111):** ảnh có `deleteAfter` (tính từ ngày chuyến hoàn thành, cấu hình được); tác vụ định kỳ xóa thật, đồng thời xóa khi xóa tài khoản. Chính sách quyền riêng tư phải ghi đúng thời hạn này.
- **Chuyến lặp (159):** lưu `TripSeries` và ngoại lệ; máy chủ sinh `Trip` thật theo cửa sổ thời gian (ví dụ 30 đến 60 ngày tới), không sinh vô hạn. Chuyến đã có đơn không bị xóa hay đổi giờ âm thầm khi sửa chuỗi.
- **Kiểm tra trùng xe và tài xế (199, 200, 166):** hai chuyến trùng khi cùng xe hoặc cùng tài xế và `startA < endB && startB < endA`, trong đó giờ kết thúc = giờ khởi hành + thời gian chạy dự kiến + khoảng nghỉ tối thiểu. Kiểm tra trong một giao dịch ở máy chủ. Ghi đè bằng xác nhận có ghi lại lý do.
- **Hủy và hoàn (72, 149, 73):** số tiền hoàn = tổng đã xác nhận × phần trăm mốc áp dụng − phí hủy, tính một lần, làm tròn đồng và không âm. Mốc áp dụng lấy theo **giờ hủy so với giờ khởi hành** theo chính sách **tại thời điểm đặt** (lưu bản sao chính sách vào đơn bằng `cancelPolicySnapshotJson` để đổi chính sách sau không ảnh hưởng đơn cũ). `Refund` chỉ ghi nhận việc nhà xe đã chuyển hoàn, không chuyển tiền.
- **Hủy chuyến (164, 165):** chuyển trạng thái chuyến và các đơn trong cùng giao dịch; đơn nào chưa chuyển sang chuyến khác thì vào hàng đợi hoàn tiền và hiện thông báo cho hành khách.
- **Đặt hộ khách (130, 131, 132, 133, 135):** tạo đơn và nhận ghế trong **một giao dịch** ở máy chủ khi quản trị viên xác nhận đã thu; nếu ghế đã có chứng từ của đơn khác thì trả lỗi trùng, không cướp ghế. Khách không dùng app lưu bằng `GuestContact`, `Booking.customerAccountId` để trống; ghép vào tài khoản sau (theo SĐT) chỉ do quản trị viên làm và ghi `AdminAction`. Thu tiền ghi vào `PaymentRecord` (tiền mặt, chuyển khoản trực tiếp) hoặc `miễn phí` kèm `compReason` bắt buộc; **doanh thu = chứng từ đã xác nhận + bản ghi thu tiền, trừ hoàn; ghế miễn phí tính riêng, không vào doanh thu**. Không có trạng thái 'chưa thu' nên không phát sinh công nợ.
- **Dịch vụ gửi đồ (13, 57, 58, 61, 220, 222, 63):** yêu cầu gửi đồ **không giữ ghế và không theo quy tắc chuyển khoản trước**. Cước = giá bậc cân nặng và cỡ kiện theo tuyến + phần vượt theo kg + phụ phí giá trị khai báo + phí lấy hoặc giao tận nơi, tính một lần, lưu `feeBreakdownJson` tại lúc quản trị viên chấp nhận; cân thực tế khác ước tính thì quản trị viên chỉnh và khách thấy lý do. Kiểm tra tải chuyến (`TripParcelCapacity`) **khi chấp nhận** trong một giao dịch để không vượt tải. Mã nhận hàng sinh ngẫu nhiên, **chỉ lưu băm**, hiện cho người gửi một lần ở đơn, giới hạn số lần nhập sai khi giao (181). Trạng thái là máy trạng thái: chờ xác nhận → được chấp nhận → đã thanh toán → đã nhận hàng → đã lên xe → đã tới nơi → đã giao; hủy, từ chối và sự cố là nhánh phụ; mỗi lần đổi ghi `ParcelEvent`. Không thu hộ (COD), không ghi nợ; bồi thường chỉ ghi nhận, nhà xe chuyển tiền ngoài app. Không có ảnh hàng, mô tả bằng chữ. Chứng từ cước dùng chung `PaymentProof` và cùng hàng đợi xác nhận (152).
- **Tổng quan doanh nghiệp (118):** doanh thu chỉ tính chứng từ **đã xác nhận** trừ đơn đã hoàn; 'hôm nay' tính theo múi giờ cố định của nhà xe; tổng hợp ở máy chủ (không kéo hết đơn về app), trả kèm thời điểm cập nhật; thẻ lịch cần xác nhận lấy từ cùng nguồn với hàng đợi (140, 141) để hai nơi không lệch số.
- **Điểm thân thiết (92, 230):** `LoyaltyEntry` chỉ ghi thêm; số điểm hiện có là tổng các bản ghi; đơn bị hủy tạo bút toán trừ điểm. Không quy đổi thành tiền mặt.
- **Đối soát (240):** chỉ tính các `PaymentProof` đã xác nhận trừ đơn đã hoàn; hiển thị rõ là **số liệu theo ghi nhận trong app**, quản trị viên đối chiếu thêm với sao kê ngân hàng.
- **Máy tính giá nhanh (46):** dùng **cùng bộ tính giá** với đặt chỗ để hai nơi không ra hai số khác nhau; kết quả không lưu.
- **Đa ngôn ngữ (102):** mọi chuỗi giao diện nằm trong tệp tài nguyên (`values`, `values-vi`, `values-en`), không viết cứng chuỗi trong mã; dùng `plurals` và tham số có thứ tự. Nội dung người dùng nhập (tên nhà xe, mô tả, quy định, tin nhắn) không bị dịch. Máy chủ trả mã lỗi ổn định và app tự dịch. Email do máy chủ gửi theo `Accept-Language`.
- **Token và phiên (8):** làm mới token một luồng duy nhất; token chỉ ở bộ nhớ; hết phiên thì hiện màn hình đăng nhập và giữ bản nháp đang nhập (ví dụ thông tin hành khách đang điền) trong bộ nhớ để làm tiếp sau khi đăng nhập. Phân biệt lỗi mạng (không có mạng, quá thời gian chờ, 5xx) nhưng hiển thị thông báo gọn; đặt thời gian chờ hợp lý (ví dụ 15 giây) và không thử lại vô hạn.
- **Hạn gửi chứng từ (156):** đơn chưa gửi ảnh có `payDeadline` (cấu hình, ví dụ 60 phút) chỉ để dọn danh sách và tính số người đang chọn; hết hạn không làm khách mất quyền gửi nếu ghế còn trống, vì ghế không bị khóa. Nếu khách đang tải ảnh lúc hết hạn, máy chủ quyết định theo thời điểm **nhận được yêu cầu**; ghế đã có người khác gửi trước thì đơn sang trạng thái mất ghế, không từ chối thẳng, để khách không mất tiền đã chuyển.
- **Kiểm thử:** dùng máy chủ giả để thử mất mạng giữa chừng, 401, xung đột ghế, 5xx, phản hồi chậm; thử hai khách cùng gửi chứng từ cho một ghế (người gửi trước được ghế, người sau vào trạng thái mất ghế), thử quản trị viên từ chối chứng từ rồi nhả ghế; thử hủy chuyến có nhiều đơn; thử tải ảnh lớn hoặc sai định dạng; thử khách hàng gọi endpoint quản trị bằng token khách; thử đặt hộ vào ghế đang có chứng từ chờ; thử nhập sai mã nhận hàng nhiều lần; thử nhận hàng vượt tải chuyến.

## Quản trị trong app và tài khoản mặc định

Bạn không làm CRM hay trang quản trị riêng, nên **vai trò quản trị viên nằm ngay trong app** và dùng chung màn hình đăng nhập.
- **Không viết tên đăng nhập và mật khẩu mặc định vào mã app hay tài liệu công khai,** vì ai giải nén app cũng đọc được. Bắt buộc đổi mật khẩu ở lần đăng nhập đầu (tính năng 114).
- **Không có đăng ký quản trị trong app.** Thêm quản trị viên chỉ do quản trị viên hiện tại làm (tính năng 256).
- **Máy chủ kiểm tra vai trò ở mọi endpoint quản trị;** ẩn nút ở app không đủ.
- **Giới hạn số lần thử đăng nhập,** đặc biệt với tài khoản quản trị, và dùng mật khẩu mạnh.
- **Màn hình quản trị vẫn nằm trong app công khai,** nên cần cung cấp cho người duyệt Google Play một tài khoản quản trị thuộc môi trường thử, không phải tài khoản thật.
- **Lịch sử xử lý** (bảng `AdminAction`) chỉ ghi những gì quản trị viên đã làm với từng báo cáo, khiếu nại và tài khoản bị khóa.
- **Xử lý thủ công vẫn tốn thời gian:** trả lời báo cáo và khiếu nại phải có người thực hiện, đúng thời gian bạn đã cam kết trong chính sách.

## Cách dùng thực tế

- **Hành khách:** đặt chỗ xong nên **chuyển khoản và gửi ảnh ngay** vì ai gửi ảnh trước được ghế. Sau khi gửi, đơn ở trạng thái chờ cho đến khi quản trị viên xử lý; **mở lại app để xem kết quả** vì không có thông báo đẩy.
- **Quản trị viên (nhà xe):** là người duy nhất xử lý đơn, nên cần có người trực xử lý đơn; có thể chia sẻ một tài khoản quản trị cho nhiều người nhưng nên thêm quản trị viên riêng cho từng người (tính năng 256). Đơn chờ càng lâu thì hành khách càng lo; nên đặt thời hạn xử lý và xem "Hôm nay" mỗi ngày.
- **Tài xế:** không có tài khoản trong app. Quản trị viên gửi danh sách khách của chuyến cho tài xế dạng chữ qua Zalo hoặc ứng dụng khác, và tự ghi giờ xuất bến, giờ đến bến theo lời tài xế báo.
- **Gửi đồ cần người thực hiện tại văn phòng:** có người cân hàng, kiểm tra hàng cấm, nhận hàng, bốc lên xe và giao cho người nhận bằng mã; app chỉ ghi nhận các mốc do quản trị viên nhập, không có nhân viên đăng nhập riêng.
- **Rủi ro chứng từ giả vẫn có thật:** quản trị viên phải đối chiếu với sao kê ngân hàng trước khi xác nhận, app chỉ hỗ trợ cảnh báo trùng ảnh.
- **Máy chủ là chi phí và trách nhiệm vận hành của bạn:** thuê máy chủ, lưu trữ ảnh, sao lưu, vá bảo mật, trả lời yêu cầu xóa dữ liệu. Máy chủ ngừng thì app không đặt được chỗ.

## Hệ quả khi áp các quy tắc của bạn

- **Không thông báo đẩy:** hành khách không được báo khi đơn được xác nhận hoặc bị từ chối cho đến khi mở app. Đây là điểm yếu lớn nhất so với app đặt vé thông thường; nếu sau này muốn khắc phục thì phải thêm dịch vụ đẩy và quyền thông báo.
- **Ghế không được giữ trước khi gửi chứng từ:** khách có thể chuyển tiền rồi mất ghế nếu người khác gửi ảnh sớm hơn. Đây là hệ quả trực tiếp của quy tắc chuyển khoản trước có chỗ trước; quản trị viên phải xử lý các đơn mất ghế bằng đổi ghế, đổi chuyến hoặc hoàn tiền.
- **Gửi đồ không có ảnh hàng, không COD, không định vị hàng:** muốn thêm ảnh hàng thì phải xem lại quyền ảnh và chính sách dữ liệu; muốn thu hộ thì phát sinh công nợ và giữ tiền, trái quy tắc của bạn.
- **Không ảnh ngoài ảnh chứng từ:** ảnh duy nhất là ảnh chứng từ do hành khách chụp bằng Camera hoặc chọn bằng Photo Picker. Không có ảnh xe, ảnh nhà xe, ảnh đại diện.
- **Không sổ nợ:** hành khách phải thanh toán trước để được xác nhận ghế. Không có đặt chỗ trả sau.
- **Không hóa đơn/thuế:** vé điện tử chỉ là xác nhận đặt chỗ. Nhà xe tự xuất hóa đơn ngoài app nếu cần.
- **Không quét mã vạch/QR:** điểm danh và đối chiếu vé bằng tên, ghế và mã đặt chỗ.
- **Không còn "không xin quyền nào":** cần `INTERNET` và `CAMERA`; `CAMERA` là quyền runtime duy nhất, khách từ chối vẫn dùng được app.
- **Không còn "dữ liệu chỉ trên máy":** dữ liệu cá nhân và ảnh chứng từ nằm trên máy chủ của bạn.

## Lưu ý khi đăng Google Play

- Category **Maps & Navigation** hoặc **Travel & Local**. Mô tả xoay quanh "đặt chỗ limo liên tỉnh, sơ đồ ghế, gửi chứng từ chuyển khoản, nhà xe xác nhận và xếp chỗ". Viết rõ thanh toán là **chuyển khoản trực tiếp cho nhà xe**.
- **Không viết** "thanh toán trực tuyến trong app", "theo dõi xe trực tiếp", "đảm bảo hoàn tiền", "xuất hóa đơn", "an toàn tuyệt đối".
- Tên nhà xe và thương hiệu trong app, tiêu đề và ảnh chụp màn hình chỉ dùng khi bạn có quyền; ảnh chụp màn hình dùng dữ liệu thử.
- **Khai Data safety theo thực tế** (xem mục chuẩn bị chính sách, điểm 7) và có chính sách quyền riêng tư, đường dẫn xóa tài khoản, tài khoản thử cho người duyệt.
- Không ghi "mã hóa" hay "bảo mật" nếu chưa kiểm chứng; chỉ nêu những gì thực sự làm (ví dụ "kết nối qua HTTPS").
- Soạn trang cửa hàng bằng tiếng Việt và tiếng Anh (Play Console cho nhập mô tả riêng cho từng ngôn ngữ).

---

## Nội dung gợi ý cho trang cửa hàng Google Play

**Tên (tối đa 30 ký tự):** SeatRoute: Limo Seat Booking *(chỉnh theo tên nhà xe hoặc tên cuối cùng bạn chọn)*

**Mô tả ngắn (tối đa 80 ký tự):**
Đặt ghế limo liên tỉnh, gửi chứng từ chuyển khoản, nhà xe xác nhận và xếp chỗ.

**Mô tả đầy đủ (tiếng Việt):**

Ứng dụng đặt ghế limo liên tỉnh của [tên nhà xe]. Chọn điểm đi và điểm đến, chọn văn phòng lên xe và ghế ngồi, chuyển khoản trực tiếp cho nhà xe rồi gửi ảnh chứng từ trong ứng dụng. Nhà xe kiểm tra, xác nhận và xếp chỗ.

Dành cho hành khách
• Đăng ký tài khoản, chọn điểm đi và điểm đến (ví dụ từ tỉnh này đến tỉnh kia), xem các chuyến, giá và chính sách hủy
• Chọn văn phòng của nhà xe làm điểm đón và điểm dừng, xem địa chỉ, giờ xe tới và số điện thoại văn phòng
• Tùy chọn xe trung chuyển: đón tại địa chỉ của bạn đến văn phòng, hoặc đưa từ văn phòng về địa chỉ (trong khu vực nhà xe phục vụ, có phí)
• Chọn ghế trên sơ đồ, đặt nhiều ghế, đặt hộ người đi cùng
• Hướng dẫn chuyển khoản kèm mã QR và số tài khoản, gửi ảnh chứng từ bằng Camera hoặc trình chọn ảnh; ai gửi ảnh chuyển khoản sớm hơn được giữ ghế
• Theo dõi trạng thái đơn, vé điện tử, lịch sử đặt chỗ, đánh giá chuyến đi
• Gửi đồ theo chuyến limo: tính cước, theo dõi từng mốc, mã nhận hàng cho người nhận

Dành cho nhà xe (quản trị viên)
• Xem doanh thu, số xe, nhân viên và lịch cần xác nhận ngay trên màn hình tổng quan
• Quản lý văn phòng ở từng tỉnh, khu vực xe trung chuyển, xe, sơ đồ ghế, tuyến, chuyến và giá
• Quản lý hồ sơ tài xế, phân một tài xế cho mỗi chuyến, kiểm tra trùng lịch
• Xem ảnh chứng từ, xác nhận hoặc từ chối, xếp và đổi ghế, đặt hộ và nhận gửi đồ hộ khách tại quầy
• Danh sách hành khách theo chuyến, gửi danh sách cho tài xế, điểm danh lên xe, mã giảm giá, đối soát và thống kê

Lưu ý: ứng dụng không giữ tiền và không xử lý thanh toán; hành khách chuyển khoản trực tiếp cho nhà xe và nhà xe tự đối chiếu. Ứng dụng không theo dõi vị trí xe, không xuất hóa đơn và không gửi thông báo đẩy, vui lòng mở ứng dụng để xem trạng thái đơn.

Giao diện sáng và tối, hỗ trợ Tiếng Việt và English.

**Short description (EN, 80 chars):**
Book fixed-seat limo trips, upload your transfer receipt, get your seat confirmed.

**Full description (EN, tóm tắt):** viết tương ứng nội dung bản tiếng Việt, nhấn mạnh: "payment is a direct bank transfer to the operator, the app does not hold or process money", "no live vehicle tracking, no invoices, no push notifications", "passengers register their own account", "parcel delivery on trips (no cash on delivery)", "admins can book seats for guests who do not use the app", "take a receipt photo with the in-app camera (camera permission asked only when you tap Take photo) or pick one with the system photo picker, no photo library permission".
