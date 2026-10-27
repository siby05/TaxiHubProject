/**
 * A tiny in-memory data layer that mimics the subset of the Mongoose API
 * this project's routes use (find/findOne/findById/findByIdAndUpdate/
 * countDocuments/deleteMany, with populate/sort/skip/limit/select chaining).
 *
 * Why: lets the app run instantly with `npm start` and no database install,
 * while keeping route code shaped exactly like it would against real
 * Mongoose models - swapping in real MongoDB (see lib/MongooseStore.js,
 * selected via DB_MODE=mongo in lib/createModel.js) means replacing this
 * file's model wiring, not rewriting every route.
 */
const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

// Every collection registers itself here by name so refs can be declared
// as plain model-name strings ({ userId: 'User' }) - the same format
// lib/MongooseStore.js's schemas use for their `ref:` option - instead of
// each model file importing every other model just to close over its
// collection. Looked up lazily (inside resolveRef, at query time), so
// require order between model files no longer matters.
const registry = new Map();

function clone(doc) {
  return doc ? JSON.parse(JSON.stringify(doc)) : doc;
}

function matches(doc, filter) {
  if (!filter) return true;
  if (filter.__none) return false;
  return Object.entries(filter).every(([key, cond]) => {
    const val = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, opVal]) => {
        switch (op) {
          case '$gte': return val >= opVal;
          case '$lte': return val <= opVal;
          case '$gt': return val > opVal;
          case '$lt': return val < opVal;
          case '$ne': return String(val) !== String(opVal);
          case '$in': return Array.isArray(opVal) && opVal.map(String).includes(String(val));
          default: throw new Error(`Unsupported MemoryStore query operator: ${op}`);
        }
      });
    }
    // MongoDB equality with null matches fields that are null or missing.
    if (cond === null) return val == null;
    return String(val) === String(cond);
  });
}

function applyUpdateOperators(doc, update) {
  for (const [key, val] of Object.entries(update)) {
    if (key === '$push') {
      for (const [field, item] of Object.entries(val)) {
        if (!Array.isArray(doc[field])) doc[field] = [];
        doc[field].push(item);
      }
    } else if (key === '$set') {
      Object.assign(doc, val);
    } else if (!key.startsWith('$')) {
      doc[key] = val;
    }
  }
}

function applySelectFields(doc, select) {
  const fields = select.trim().split(/\s+/).filter((f) => !f.startsWith('-'));
  if (fields.length === 0) return doc;
  const out = { _id: doc._id };
  for (const f of fields) out[f] = doc[f];
  return out;
}

class Query {
  constructor(collection, opts) {
    this.collection = collection;
    this.filter = opts.filter || {};
    this.single = !!opts.single;
    this.mode = opts.mode || 'find';
    this.updateId = opts.updateId;
    this.updatePayload = opts.updatePayload;
    this._populate = [];
    this._sort = null;
    this._skip = 0;
    this._limit = null;
    this._select = null;
  }

  populate(path, select) {
    this._populate.push({ path, select });
    return this;
  }

  sort(spec) {
    this._sort = spec;
    return this;
  }

  skip(n) {
    this._skip = Number(n) || 0;
    return this;
  }

  limit(n) {
    this._limit = n ? Number(n) : null;
    return this;
  }

  select(fields) {
    this._select = fields;
    return this;
  }

  async exec() {
    if (this.mode === 'update') {
      const idx = this.collection.docs.findIndex((d) => String(d._id) === String(this.updateId));
      if (idx === -1) return this.single ? null : [];
      applyUpdateOperators(this.collection.docs[idx], this.updatePayload);
      this.collection.docs[idx].updatedAt = new Date();
    }

    let docs = this.mode === 'update'
      ? [this.collection.docs.find((d) => String(d._id) === String(this.updateId))].filter(Boolean).map(clone)
      : this.collection.docs.filter((d) => matches(d, this.filter)).map(clone);

    for (const { path, select } of this._populate) {
      docs = docs.map((doc) => this.collection.applyPopulate(doc, path, select));
    }
    if (this._sort) {
      const [[field, dir]] = Object.entries(this._sort);
      docs = docs.sort((a, b) => ((a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir));
    }
    if (this._skip) docs = docs.slice(this._skip);
    if (this._limit != null) docs = docs.slice(0, this._limit);
    if (this._select) docs = docs.map((d) => applySelectFields(d, this._select));

    return this.single ? (docs[0] || null) : docs;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

class Collection {
  constructor(name, refs = {}) {
    this.name = name;
    this.docs = [];
    this.refs = refs;
    this.preSaveHooks = [];
  }

  pre(fn) {
    this.preSaveHooks.push(fn);
  }

  applyPopulate(doc, path, select) {
    const modelName = this.refs[path];
    if (!modelName) return doc;
    const parts = path.split('.');
    if (parts.length === 1) {
      const field = parts[0];
      const val = doc[field];
      if (val == null) return doc;
      doc[field] = Array.isArray(val)
        ? val.map((v) => this.resolveRef(modelName, v, select) || v)
        : (this.resolveRef(modelName, val, select) || val);
    } else {
      const [arrField, subField] = parts;
      const arr = doc[arrField];
      if (Array.isArray(arr)) {
        doc[arrField] = arr.map((item) => {
          const val = item[subField];
          if (val == null) return item;
          return { ...item, [subField]: this.resolveRef(modelName, val, select) || val };
        });
      }
    }
    return doc;
  }

  resolveRef(modelName, id, select) {
    const refCollection = registry.get(modelName);
    if (!refCollection) return null;
    const found = refCollection.docs.find((d) => String(d._id) === String(id));
    if (!found) return null;
    let cloned = clone(found);
    delete cloned.password;
    if (select) cloned = applySelectFields(cloned, select);
    return cloned;
  }

  find(filter = {}) {
    return new Query(this, { filter, single: false });
  }

  findOne(filter = {}) {
    return new Query(this, { filter, single: true });
  }

  findById(id) {
    return new Query(this, { filter: id ? { _id: String(id) } : { __none: true }, single: true });
  }

  findOneAndUpdate(filter, update) {
    const found = this.docs.find((doc) => matches(doc, filter));
    return new Query(this, { single: true, mode: 'update', updateId: found?._id || null, updatePayload: update });
  }

  findByIdAndUpdate(id, update, _opts = {}) {
    return new Query(this, { single: true, mode: 'update', updateId: id, updatePayload: update });
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  async create(data) {
    const doc = { _id: generateId(), createdAt: new Date(), updatedAt: new Date(), ...data };
    for (const hook of this.preSaveHooks) await hook(doc, this);
    this.docs.push(doc);
    return clone(doc);
  }
}

function createModel(name, refs = {}) {
  const collection = new Collection(name, refs);
  registry.set(name, collection);
  return {
    collection,
    pre: (fn) => collection.pre(fn),
    create: (data) => collection.create(data),
    find: (filter) => collection.find(filter),
    findOne: (filter) => collection.findOne(filter),
    findById: (id) => collection.findById(id),
    findByIdAndUpdate: (id, update, opts) => collection.findByIdAndUpdate(id, update, opts),
    findOneAndUpdate: (filter, update) => collection.findOneAndUpdate(filter, update),
    countDocuments: (filter) => collection.countDocuments(filter),
    deleteMany: (filter) => collection.deleteMany(filter),
  };
}

module.exports = { createModel, generateId };
