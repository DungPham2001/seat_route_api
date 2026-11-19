/**
 * Bank catalog for the transfer QR (BankCatalog in the spec): code, NAPAS BIN, short name, full name.
 * Read-only in the app (`GET /v1/banks`); the admin picks one for the operator's receiving account.
 */
const BANKS = [
  ['VCB', '970436', 'Vietcombank', 'Ngân hàng TMCP Ngoại thương Việt Nam'],
  ['ICB', '970415', 'VietinBank', 'Ngân hàng TMCP Công thương Việt Nam'],
  ['BIDV', '970418', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'],
  ['VBA', '970405', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam'],
  ['TCB', '970407', 'Techcombank', 'Ngân hàng TMCP Kỹ thương Việt Nam'],
  ['MB', '970422', 'MBBank', 'Ngân hàng TMCP Quân đội'],
  ['ACB', '970416', 'ACB', 'Ngân hàng TMCP Á Châu'],
  ['VPB', '970432', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng'],
  ['TPB', '970423', 'TPBank', 'Ngân hàng TMCP Tiên Phong'],
  ['STB', '970403', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Thương Tín'],
  ['HDB', '970437', 'HDBank', 'Ngân hàng TMCP Phát triển TP.HCM'],
  ['VIB', '970441', 'VIB', 'Ngân hàng TMCP Quốc tế Việt Nam'],
  ['SHB', '970443', 'SHB', 'Ngân hàng TMCP Sài Gòn - Hà Nội'],
  ['EIB', '970431', 'Eximbank', 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam'],
  ['MSB', '970426', 'MSB', 'Ngân hàng TMCP Hàng Hải Việt Nam'],
  ['OCB', '970448', 'OCB', 'Ngân hàng TMCP Phương Đông'],
  ['SEAB', '970440', 'SeABank', 'Ngân hàng TMCP Đông Nam Á'],
  ['LPB', '970449', 'LPBank', 'Ngân hàng TMCP Lộc Phát Việt Nam'],
  ['NAB', '970428', 'Nam A Bank', 'Ngân hàng TMCP Nam Á'],
  ['BAB', '970409', 'Bac A Bank', 'Ngân hàng TMCP Bắc Á'],
  ['ABB', '970425', 'ABBANK', 'Ngân hàng TMCP An Bình'],
  ['VAB', '970427', 'VietABank', 'Ngân hàng TMCP Việt Á'],
  ['PVCB', '970412', 'PVcomBank', 'Ngân hàng TMCP Đại Chúng Việt Nam'],
  ['KLB', '970452', 'KienlongBank', 'Ngân hàng TMCP Kiên Long'],
  ['BVB', '970438', 'BaoViet Bank', 'Ngân hàng TMCP Bảo Việt'],
  ['NCB', '970419', 'NCB', 'Ngân hàng TMCP Quốc Dân'],
  ['SCB', '970429', 'SCB', 'Ngân hàng TMCP Sài Gòn'],
  ['VBB', '970433', 'VietBank', 'Ngân hàng TMCP Việt Nam Thương Tín'],
  ['PGB', '970430', 'PGBank', 'Ngân hàng TMCP Thịnh vượng và Phát triển'],
  ['SGICB', '970400', 'SaigonBank', 'Ngân hàng TMCP Sài Gòn Công Thương'],
  ['GPB', '970408', 'GPBank', 'Ngân hàng TM TNHH MTV Dầu Khí Toàn Cầu'],
  ['CBB', '970444', 'CBBank', 'Ngân hàng TM TNHH MTV Xây dựng Việt Nam'],
  ['DOB', '970406', 'DongA Bank', 'Ngân hàng TMCP Đông Á'],
  ['VCCB', '970454', 'BVBank', 'Ngân hàng TMCP Bản Việt'],
  ['SHBVN', '970424', 'Shinhan Bank', 'Ngân hàng TNHH MTV Shinhan Việt Nam'],
  ['WVN', '970457', 'Woori Bank', 'Ngân hàng TNHH MTV Woori Việt Nam'],
  ['UOB', '970458', 'UOB', 'Ngân hàng TNHH MTV United Overseas Bank (Việt Nam)'],
  ['PBVN', '970439', 'Public Bank', 'Ngân hàng TNHH MTV Public Việt Nam'],
  ['IVB', '970434', 'Indovina Bank', 'Ngân hàng TNHH Indovina'],
  ['VRB', '970421', 'VRB', 'Ngân hàng Liên doanh Việt - Nga'],
  ['COOPBANK', '970446', 'Co-opBank', 'Ngân hàng Hợp tác xã Việt Nam'],
  ['CAKE', '546034', 'CAKE', 'Ngân hàng số CAKE by VPBank'],
  ['UBANK', '546035', 'Ubank', 'Ngân hàng số Ubank by VPBank'],
].map(([code, bin, shortName, name]) => ({ code, bin, shortName, name }));

const byCode = new Map(BANKS.map((b) => [b.code, b]));

module.exports = { BANKS, bankByCode: (code) => byCode.get(code) || null };
