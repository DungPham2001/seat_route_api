/**
 * Regenerates the "CRUD danh mục" section of docs/API-cho-FE.md from src/resources/defs.js
 * (between <!-- CRUD:START --> and <!-- CRUD:END -->). Run after changing a resource definition:
 *   npm run docs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const fs = require('fs');
const path = require('path');
const { resources } = require('../src/resources/defs');

const FILE = path.join(__dirname, '..', 'docs', 'API-cho-FE.md');

const TITLES = {
  provinces: 'Tỉnh / thành phố (219)', offices: 'Văn phòng (207)', shuttleZones: 'Khu vực xe trung chuyển (213)', seatLayouts: 'Sơ đồ ghế (186)',
  vehicles: 'Xe — limo và xe trung chuyển (185-192)', maintenance: 'Bảo dưỡng xe (191)', staff: 'Nhân viên & tài xế (194-196, 202)', staffSchedules: 'Lịch làm / ngày nghỉ / ca (197, 198)',
  routes: 'Tuyến (210-217)', promotions: 'Mã giảm giá (227)', seasonalPrices: 'Giá theo mùa / dịp lễ (228)', announcements: 'Thông báo chung / tin nhà xe (238)',
  faq: 'Câu hỏi thường gặp (237)', checklistItems: 'Mẫu việc trước giờ chạy (184)', parcelCategories: 'Loại hàng / hàng cấm (221)', parcelRates: 'Bảng cước gửi đồ (220)',
  prohibitedItems: 'Hàng cấm gửi (221)',
  guests: 'Khách tại quầy / không dùng app (135)', tripExpenses: 'Chi phí chuyến (241)',
};

function typeText(f) {
  switch (f.type) {
    case 'string': return `chuỗi ≤${f.max || 200}${f.pattern ? ` (\`${f.pattern.source}\`)` : ''}`;
    case 'text': return `văn bản ≤${f.max || 5000}`;
    case 'phone': return f.normalize === false ? 'SĐT' : 'SĐT (server chuẩn hóa 0xxxxxxxxx)';
    case 'email': return 'email';
    case 'enum': return f.values.map((v) => `\`${v}\``).join(' \\| ');
    case 'ref': return `id ${f.ref}`;
    case 'date': return '`yyyy-MM-dd`';
    case 'time': return '`HH:mm`';
    case 'datetime': return 'ISO 8601';
    case 'int': return `số nguyên${f.min !== undefined || f.max !== undefined ? ` ${f.min ?? 0}..${f.max ?? '∞'}` : ''}`;
    case 'money': return 'tiền (đồng, số nguyên ≥ 0)';
    case 'number': return `số${f.max ? ` ≤${f.max}` : ''}`;
    case 'bool': return 'true/false';
    case 'strings': return `mảng chuỗi (≤${f.maxItems || 50} phần tử)`;
    case 'objects': return `mảng object (≤${f.maxItems || 100}): ${Object.entries(f.of).map(([k, x]) => `\`${k}\`${x.required ? '*' : ''} ${typeText(x)}`).join('; ')}`;
    case 'object': return `object: ${Object.entries(f.of).map(([k, x]) => `\`${k}\` ${typeText(x)}`).join('; ')}`;
    default: return f.type;
  }
}

function section(key, r) {
  const d = r.def;
  const p = `/v1${r.path}`;
  const lines = [`### ${TITLES[key] || key}`, ''];
  lines.push(`\`GET ${p}\` · \`POST ${p}\` · \`GET|PATCH|DELETE ${p}/{id}\` — ${r.role === 'admin' ? '🔒 quản trị viên' : '🔒 khách hàng (chỉ dữ liệu của mình)'}`, '');
  const q = [];
  if (d.filters?.length) q.push(`lọc: ${d.filters.map((f) => `\`${f}\``).join(', ')}`);
  if (d.search?.length) q.push(`\`q\` tìm không dấu theo ${d.search.map((f) => `\`${f}\``).join(', ')}`);
  if (d.dateField) q.push(`\`from\`/\`to\` theo \`${d.dateField}\``);
  if (q.length) lines.push(`Danh sách: ${q.join('; ')}.`, '');
  lines.push('| Trường | Kiểu | Bắt buộc | Mặc định |', '|---|---|---|---|');
  for (const [k, f] of Object.entries(d.fields)) {
    const def = f.def === undefined ? '' : `\`${JSON.stringify(f.def)}\``;
    lines.push(`| \`${k}\` | ${typeText(f)}${f.readOnly ? ' — *chỉ đọc*' : ''} | ${f.required ? '✓' : ''} | ${def} |`);
  }
  const notes = [];
  if (d.unique?.length) notes.push(`Không trùng: ${d.unique.map((u) => u.map((x) => `\`${x}\``).join(' + ')).join('; ')} → \`409 duplicate\`.`);
  if (d.dependents?.length) notes.push(`Không xóa được khi còn: ${[...new Set(d.dependents.map((x) => x.label))].join(', ')} → \`409 has_dependents\` (\`blockedBy\`).`);
  if (notes.length) lines.push('', ...notes);
  lines.push('');
  return lines.join('\n');
}

const out = ['<!-- CRUD:START -->', '', ...Object.entries(resources).map(([k, r]) => section(k, r)), '<!-- CRUD:END -->'].join('\n');
const doc = fs.readFileSync(FILE, 'utf8');
const next = doc.replace(/<!-- CRUD:START -->[\s\S]*<!-- CRUD:END -->/, () => out); // function: no $` / $& expansion
fs.writeFileSync(FILE, next);
console.log(`docs/API-cho-FE.md: ${Object.keys(resources).length} resources written`);
