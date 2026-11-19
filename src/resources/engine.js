/**
 * Declarative catalog tables. One definition gives: the Mongoose model, input validation, the presenter,
 * and the REST CRUD router (list with filters, accent-free `q`, date range, cursor paging; get; create; patch;
 * delete with "restrict" dependents). Used for offices, vehicles, routes, staff, promotions, saved data...
 *
 * Field types: string, text, phone, email, enum, ref, date, time, datetime, int, money, number, bool,
 * strings (array of strings), objects (array of objects with `of`), object (nested `of`).
 */
const express = require('express');
const mongoose = require('mongoose');
const { Checker } = require('../lib/validate');
const { asyncHandler, notFound, conflict, invalid } = require('../lib/errors');
const { uuid, noAccent, iso, normalizePhone } = require('../lib/util');

const { Schema } = mongoose;

const mongooseType = (f) => {
  switch (f.type) {
    case 'int': case 'money': case 'number': return Number;
    case 'bool': return Boolean;
    case 'datetime': return Date;
    case 'strings': return [String];
    case 'objects': case 'object': return Schema.Types.Mixed;
    default: return String;
  }
};

function buildModel(def) {
  const shape = { _id: String };
  for (const [k, f] of Object.entries(def.fields)) {
    shape[k] = { type: mongooseType(f), default: f.def !== undefined ? f.def : f.type === 'strings' || f.type === 'objects' ? [] : null };
  }
  if (def.owner) shape[def.owner] = { type: String, required: true };
  if (def.parent) shape[def.parent.field] = { type: String, required: true };
  shape.search = { type: String, default: '' };
  shape.createdBy = { type: String, default: null };
  shape.createdAt = { type: Date, default: Date.now };
  shape.updatedAt = { type: Date, default: Date.now };
  const s = new Schema(shape, { collection: def.collection, versionKey: false, minimize: false });
  for (const u of def.unique || []) s.index(Object.fromEntries(u.map((k) => [k, 1])), { unique: true });
  for (const [spec, opts] of def.indexes || []) s.index(spec, opts || {});
  if (def.owner) s.index({ [def.owner]: 1, createdAt: -1 });
  if (def.parent) s.index({ [def.parent.field]: 1, createdAt: -1 });
  return mongoose.model(def.model, s);
}

/** Validates one value of field `f` from `obj[key]`; pushes ref checks into `refs`. */
function readField(c, obj, key, f, field, refs) {
  const o = { field, required: !!f.required };
  let v;
  switch (f.type) {
    case 'string': v = c.str(obj, key, { ...o, max: f.max || 200, pattern: f.pattern }); break;
    case 'text': v = c.str(obj, key, { ...o, max: f.max || 5000 }); break;
    case 'phone': {
      v = c.phone(obj, key, o);
      if (typeof v === 'string' && f.normalize !== false) v = normalizePhone(v) || c.fail(field, 'invalid_format');
      break;
    }
    case 'email': v = c.email(obj, key, o); break;
    case 'enum': v = c.oneOf(obj, key, f.values, o); break;
    case 'ref': v = c.id(obj, key, o); if (typeof v === 'string') refs.push({ model: f.ref, id: v, field }); break;
    case 'date': v = c.date(obj, key, o); break;
    case 'time': v = c.time(obj, key, o); break;
    case 'datetime': v = c.datetime(obj, key, o); break;
    case 'int': v = c.int(obj, key, { ...o, min: f.min ?? 0, max: f.max ?? 1e9 }); break;
    case 'money': v = c.money(obj, key, o); break;
    case 'number': v = c.num(obj, key, { ...o, min: f.min ?? 0, max: f.max ?? 1e9 }); break;
    case 'bool': v = c.bool(obj, key, o); break;
    case 'strings': {
      const arr = c.arr(obj, key, { ...o, max: f.maxItems || 50 });
      if (Array.isArray(arr)) {
        v = [];
        arr.forEach((item, i) => {
          const s = c.str({ v: item }, 'v', { field: `${field}[${i}]`, required: true, max: f.max || 60 });
          if (typeof s === 'string') v.push(s);
        });
      } else v = arr;
      break;
    }
    case 'objects': {
      const arr = c.arr(obj, key, { ...o, max: f.maxItems || 100 });
      if (Array.isArray(arr)) v = arr.map((item, i) => readObject(c, item, f.of, `${field}[${i}]`, refs));
      else v = arr;
      break;
    }
    case 'object': {
      const ob = c.obj(obj, key, o);
      v = ob ? readObject(c, ob, f.of, field, refs) : ob;
      break;
    }
    default: throw new Error(`unknown field type ${f.type}`);
  }
  if (v === undefined && f.def !== undefined && !f.required) return undefined;
  return v;
}

function readObject(c, obj, fields, prefix, refs) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    c.fail(prefix, 'invalid_type');
    return null;
  }
  const out = {};
  for (const [k, f] of Object.entries(fields)) {
    const v = readField(c, obj, k, f, `${prefix}.${k}`, refs);
    out[k] = v === undefined ? (f.def !== undefined ? f.def : null) : v;
  }
  return out;
}

async function checkRefs(refs) {
  const bad = [];
  await Promise.all(refs.map(async (r) => {
    if (!(await mongoose.model(r.model).exists({ _id: r.id }))) bad.push({ field: r.field, code: 'not_found' });
  }));
  if (bad.length) throw invalid(bad);
}

/**
 * Validates a create (all fields, defaults applied) or a patch (only fields present). Read-only fields are ignored.
 * Returns the cleaned data.
 */
async function clean(def, body, { partial }) {
  const c = new Checker();
  const refs = [];
  const data = {};
  for (const [k, f] of Object.entries(def.fields)) {
    if (f.readOnly) continue;
    const given = body != null && typeof body === 'object' && body[k] !== undefined;
    if (partial && !given) continue;
    if (partial && f.required && (body[k] === null || body[k] === '')) {
      c.fail(k, 'required');
      continue;
    }
    // A patch only checks the fields it sends; "required" matters on create.
    const v = readField(c, body, k, partial ? { ...f, required: false } : f, k, refs);
    const empty = f.def !== undefined ? f.def : f.type === 'strings' || f.type === 'objects' ? [] : null;
    data[k] = v === undefined || (v === null && (f.type === 'strings' || f.type === 'objects')) ? empty : v;
  }
  c.done();
  await checkRefs(refs);
  return data;
}

const outValue = (f, v) => {
  if (v === undefined) return f.type === 'strings' || f.type === 'objects' ? [] : null;
  if (f.type === 'datetime') return iso(v);
  return v;
};

function presenter(def) {
  return (doc) => {
    if (!doc) return null;
    const out = { id: doc._id };
    if (def.parent) out[def.parent.field] = doc[def.parent.field];
    for (const [k, f] of Object.entries(def.fields)) {
      if (f.hidden) continue;
      out[k] = outValue(f, doc[k]);
    }
    out.createdAt = iso(doc.createdAt);
    out.updatedAt = iso(doc.updatedAt);
    return out;
  };
}

const searchText = (def, doc) => noAccent((def.search || []).map((k) => doc[k] || '').join(' '));

/** Cursor = opaque offset (stable enough for app paging). */
const encodeCursor = (n) => Buffer.from(String(n)).toString('base64url');
const decodeCursor = (s) => {
  const n = parseInt(Buffer.from(String(s || ''), 'base64url').toString(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
function paging(query, def = 50) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || def, 1), 200);
  return { limit, skip: decodeCursor(query.cursor) };
}
const page = (rows, { limit, skip }, total) => ({
  items: rows.slice(0, limit),
  nextCursor: rows.length > limit ? encodeCursor(skip + limit) : null,
  total,
});

function coerce(f, raw) {
  if (f.type === 'bool') return raw === 'true' || raw === '1';
  if (['int', 'money', 'number'].includes(f.type)) return Number(raw);
  return String(raw);
}

/**
 * Express router for one resource. `scopeOf(req)` adds the owner / parent filter; `guard` is applied by the caller.
 */
function router(def, model, present) {
  const r = express.Router({ mergeParams: true });
  const h = asyncHandler;

  const scope = async (req) => {
    const f = {};
    if (def.owner) f[def.owner] = req.auth.accountId;
    if (def.parent) {
      const pid = req.params[def.parent.param];
      if (!(await mongoose.model(def.parent.model).exists({ _id: pid }))) throw notFound();
      f[def.parent.field] = pid;
    }
    return f;
  };

  const load = async (req) => {
    const doc = await model.findOne({ _id: req.params.id, ...(await scope(req)) }).lean();
    if (!doc) throw notFound();
    return doc;
  };

  r.get('/', h(async (req, res) => {
    const filter = await scope(req);
    for (const k of def.filters || []) {
      if (req.query[k] !== undefined && req.query[k] !== '') filter[k] = coerce(def.fields[k] || { type: 'string' }, req.query[k]);
    }
    if (req.query.q && def.search) {
      filter.search = { $regex: noAccent(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
    }
    if (def.dateField && (req.query.from || req.query.to)) {
      filter[def.dateField] = {};
      if (req.query.from) filter[def.dateField].$gte = req.query.from;
      if (req.query.to) filter[def.dateField].$lte = req.query.to;
    }
    if (def.listFilter) Object.assign(filter, await def.listFilter(req));
    const p = paging(req.query, def.pageSize || 100);
    const [rows, total] = await Promise.all([
      model.find(filter).sort(def.sort || { createdAt: -1 }).skip(p.skip).limit(p.limit + 1).lean(),
      model.countDocuments(filter),
    ]);
    const items = rows.map(present);
    if (def.decorate) await def.decorate(items, req);
    res.json(page(items, p, total));
  }));

  r.get('/:id', h(async (req, res) => {
    const item = present(await load(req));
    if (def.decorate) await def.decorate([item], req);
    res.json(item);
  }));

  r.post('/', h(async (req, res) => {
    const data = await clean(def, req.body, { partial: false });
    const ctx = { auth: req.auth, existing: null, params: req.params, body: req.body };
    if (def.validate) await def.validate(data, ctx);
    const now = new Date();
    const doc = { _id: uuid(), ...data, ...(await scope(req)), createdBy: req.auth?.accountId || null, createdAt: now, updatedAt: now };
    doc.search = searchText(def, doc);
    try {
      await model.create(doc);
    } catch (err) {
      if (err.code === 11000) throw conflict('duplicate', { fields: (def.unique?.[0] || []).map((field) => ({ field, code: 'duplicate' })) });
      throw err;
    }
    if (def.afterWrite) await def.afterWrite(doc, null, ctx);
    const item = present(doc);
    if (def.decorate) await def.decorate([item], req);
    res.status(201).json(item);
  }));

  r.patch('/:id', h(async (req, res) => {
    const existing = await load(req);
    const data = await clean(def, req.body, { partial: true });
    const ctx = { auth: req.auth, existing, params: req.params, body: req.body };
    if (def.validate) await def.validate(data, ctx);
    const merged = { ...existing, ...data, updatedAt: new Date() };
    data.search = searchText(def, merged);
    data.updatedAt = merged.updatedAt;
    try {
      await model.updateOne({ _id: existing._id }, { $set: data });
    } catch (err) {
      if (err.code === 11000) throw conflict('duplicate', { fields: (def.unique?.[0] || []).map((field) => ({ field, code: 'duplicate' })) });
      throw err;
    }
    if (def.afterWrite) await def.afterWrite(merged, existing, ctx);
    const item = present(merged);
    if (def.decorate) await def.decorate([item], req);
    res.json(item);
  }));

  r.delete('/:id', h(async (req, res) => {
    const existing = await load(req);
    const blockedBy = [];
    for (const d of def.dependents || []) {
      const n = await mongoose.model(d.model).countDocuments({ [d.field]: existing._id, ...(d.where || {}) });
      if (n) blockedBy.push({ resource: d.label, count: n });
    }
    if (blockedBy.length) throw conflict('has_dependents', { blockedBy });
    if (def.beforeDelete) await def.beforeDelete(existing, { auth: req.auth });
    await model.deleteOne({ _id: existing._id });
    res.status(204).end();
  }));

  return r;
}

/** Creates one record with the same checks as POST (used by the CSV import). `dryRun` only validates. */
async function insert(def, model, body, auth, { dryRun = false } = {}) {
  const data = await clean(def, body, { partial: false });
  if (def.validate) await def.validate(data, { auth, existing: null, params: {}, body });
  if (dryRun) return data;
  const now = new Date();
  const doc = { _id: uuid(), ...data, createdBy: auth?.accountId || null, createdAt: now, updatedAt: now };
  doc.search = searchText(def, doc);
  await model.create(doc);
  return doc;
}

function defineResource(def) {
  const model = buildModel(def);
  const present = presenter(def);
  return { def, model, present, router: () => router(def, model, present), insert: (body, auth, opts) => insert(def, model, body, auth, opts) };
}

module.exports = { defineResource, paging, page, encodeCursor, decodeCursor };
