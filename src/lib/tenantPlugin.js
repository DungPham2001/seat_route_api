/** Mongoose plugin: scopes a collection to the current operator (see tenant.js). */
const tenant = require('./tenant');

const QUERY_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'countDocuments', 'distinct',
];

module.exports = function tenantPlugin(schema) {
  schema.add({ operatorId: { type: String, default: null } });
  schema.index({ operatorId: 1 });

  schema.pre(QUERY_OPS, function scope() {
    const op = tenant.current();
    if (op) this.where({ operatorId: op });
  });
  schema.pre('aggregate', function scopeAggregate() {
    const op = tenant.current();
    if (op) this.pipeline().unshift({ $match: { operatorId: op } });
  });
  schema.pre('validate', function stamp() {
    const op = tenant.current();
    if (op && this.isNew && !this.operatorId) this.operatorId = op;
  });
  schema.pre('insertMany', function stampMany(next, docs) {
    const op = tenant.current();
    if (op && Array.isArray(docs)) for (const d of docs) if (d && !d.operatorId) d.operatorId = op;
    next();
  });
};
