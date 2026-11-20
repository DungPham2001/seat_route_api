const { invalid } = require('./errors');
const { isDate, isTime } = require('./time');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+().\-\s]{6,20}$/;

/**
 * Collects field errors, then `done()` throws one 400 validation_failed with every field.
 * Field codes: required, invalid_type, too_short, too_long, out_of_range, invalid_format, invalid_enum, weak_password.
 */
class Checker {
  constructor() {
    this.fields = [];
  }

  fail(field, code) {
    this.fields.push({ field, code });
    return undefined;
  }

  str(obj, key, { field = key, required = false, min = 0, max = 200, pattern, trim = true } = {}) {
    let v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      return required ? this.fail(field, 'required') : v === null ? null : undefined;
    }
    if (typeof v !== 'string') return this.fail(field, 'invalid_type');
    if (trim) v = v.trim();
    if (v.length < min) return this.fail(field, 'too_short');
    if (v.length > max) return this.fail(field, 'too_long');
    if (pattern && !pattern.test(v)) return this.fail(field, 'invalid_format');
    return v;
  }

  int(obj, key, { field = key, required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null || v === '') return required ? this.fail(field, 'required') : v === null ? null : undefined;
    if (typeof v !== 'number' || !Number.isInteger(v)) return this.fail(field, 'invalid_type');
    if (v < min || v > max) return this.fail(field, 'out_of_range');
    return v;
  }

  num(obj, key, { field = key, required = false, min = 0, max = 1e9 } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null || v === '') return required ? this.fail(field, 'required') : v === null ? null : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) return this.fail(field, 'invalid_type');
    if (v < min || v > max) return this.fail(field, 'out_of_range');
    return v;
  }

  oneOf(obj, key, values, { field = key, required = false, def } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null || v === '') return required ? this.fail(field, 'required') : def;
    if (!values.includes(v)) return this.fail(field, 'invalid_enum');
    return v;
  }

  email(obj, key, opts = {}) {
    const v = this.str(obj, key, { max: 254, ...opts });
    if (typeof v !== 'string') return v;
    if (!EMAIL.test(v)) return this.fail(opts.field || key, 'invalid_format');
    return v.toLowerCase();
  }

  phone(obj, key, opts = {}) {
    return this.str(obj, key, { max: 20, pattern: PHONE, ...opts });
  }

  /** Server decides password strength: 8..72 bytes (bcrypt limit), with an upper-case letter, a lower-case letter and a digit. */
  password(obj, key, { field = key } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null || v === '') return this.fail(field, 'required');
    if (typeof v !== 'string') return this.fail(field, 'invalid_type');
    if (Buffer.byteLength(v, 'utf8') > 72) return this.fail(field, 'too_long');
    if (v.length < 8 || !/\p{Lu}/u.test(v) || !/\p{Ll}/u.test(v) || !/\d/.test(v)) return this.fail(field, 'weak_password');
    return v;
  }

  /** Password as typed for a check (login, confirm): just present and a string. */
  secret(obj, key, { field = key } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null || v === '') return this.fail(field, 'required');
    if (typeof v !== 'string' || v.length > 200) return this.fail(field, 'invalid_type');
    return v;
  }

  obj(obj, key, { field = key, required = false } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null) return required ? this.fail(field, 'required') : undefined;
    if (!isObj(v)) return this.fail(field, 'invalid_type');
    return v;
  }

  arr(obj, key, { field = key, required = false, max = 1000 } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null) return required ? this.fail(field, 'required') : undefined;
    if (!Array.isArray(v)) return this.fail(field, 'invalid_type');
    if (v.length > max) return this.fail(field, 'too_long');
    return v;
  }

  bool(obj, key, { field = key, required = false, def } = {}) {
    const v = isObj(obj) ? obj[key] : undefined;
    if (v === undefined || v === null) return required ? this.fail(field, 'required') : def;
    if (typeof v !== 'boolean') return this.fail(field, 'invalid_type');
    return v;
  }

  /** Local date "yyyy-MM-dd". */
  date(obj, key, { field = key, required = false } = {}) {
    const v = this.str(obj, key, { field, required, max: 10 });
    if (typeof v !== 'string') return v;
    return isDate(v) ? v : this.fail(field, 'invalid_format');
  }

  /** Local time "HH:mm". */
  time(obj, key, { field = key, required = false } = {}) {
    const v = this.str(obj, key, { field, required, max: 5 });
    if (typeof v !== 'string') return v;
    return isTime(v) ? v : this.fail(field, 'invalid_format');
  }

  /** ISO 8601 instant -> Date. */
  datetime(obj, key, { field = key, required = false } = {}) {
    const v = this.str(obj, key, { field, required, max: 40 });
    if (typeof v !== 'string') return v;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(v) ? this.fail(field, 'invalid_format') : d;
  }

  /** Id of another record (uuid or short string id). */
  id(obj, key, opts = {}) {
    return this.str(obj, key, { max: 64, ...opts });
  }

  /** Money in whole dong (integer >= 0). */
  money(obj, key, opts = {}) {
    return this.int(obj, key, { min: 0, max: 10_000_000_000, ...opts });
  }

  get ok() {
    return this.fields.length === 0;
  }

  done() {
    if (this.fields.length) throw invalid(this.fields);
  }
}

module.exports = { Checker, isObj };
