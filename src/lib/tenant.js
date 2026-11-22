/**
 * Multi-tenant context. Every operator (nhà xe) owns its own vehicles, routes, trips, orders, settings...
 * The id of the operator is the id of the owner account (`account.operatorId`). The request's operator travels
 * in an AsyncLocalStorage, and the Mongoose plugin in `tenantPlugin.js` adds it to every query and every new
 * document of the operator-owned collections, so a service can never read or write another operator's data.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

/** Runs `fn` as operator `operatorId` (null = no filter at all, for cross-operator jobs). */
const run = (operatorId, fn) => als.run({ operatorId: operatorId || null }, fn);
const unscoped = (fn) => run(null, fn);
const current = () => als.getStore()?.operatorId || null;

module.exports = { run, unscoped, current };
