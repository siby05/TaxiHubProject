/**
 * Real-MongoDB backing for the same Model API lib/MemoryStore.js provides
 * (find/findOne/findById/findByIdAndUpdate/countDocuments/deleteMany, with
 * populate/sort/skip/limit/select chaining, a `.pre()` hook, and $push/$gte-
 * style filter operators) - selected instead of MemoryStore by
 * lib/createModel.js when DB_MODE=mongo. Route code is unaware which one
 * it's talking to.
 *
 * Every schema is `{ strict: false }` (free-form) except the specific
 * fields declared as refs below, which get real ObjectId+ref typing so
 * Mongoose's native .populate() can resolve them - this project has never
 * had per-field schemas (see each models/*.js file's field-list comment
 * instead), and there's no reason to start requiring them now just because
 * the storage engine changed.
 */
const mongoose = require('mongoose');

const { Schema } = mongoose;

// Recursively turns every ObjectId in a lean() result into a plain string,
// so a doc returned from here looks exactly like one from MemoryStore
// (which has always used plain hex-string ids) - callers throughout the
// app already do things like String(doc._id) or spread/mutate the object
// freely, assuming a plain value, not a class instance.
function stringifyIds(val) {
  if (val == null) return val;
  if (Array.isArray(val)) return val.map(stringifyIds);
  if (val instanceof mongoose.Types.ObjectId) return val.toString();
  if (val instanceof Date) return val;
  if (typeof val === 'object') {
    for (const k of Object.keys(val)) val[k] = stringifyIds(val[k]);
    return val;
  }
  return val;
}

// MongoDB rejects an update document that mixes $-operators with plain
// field names at the top level (e.g. { $push: {...}, driverId: null }, a
// shape this app's routes do produce in one spot) - split any plain keys
// into their own $set rather than requiring every call site to know that
// rule. A pure plain-field update (the common case) passes through
// untouched, since MongoDB already treats that as an implicit $set.
function normalizeUpdate(update) {
  const dollarKeys = {};
  const plainKeys = {};
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$')) dollarKeys[k] = v;
    else plainKeys[k] = v;
  }
  if (Object.keys(dollarKeys).length === 0) return update;
  if (Object.keys(plainKeys).length === 0) return dollarKeys;
  return { ...dollarKeys, $set: { ...dollarKeys.$set, ...plainKeys } };
}

// Strips a populated User sub-document's password hash, mirroring
// MemoryStore's resolveRef() (`delete cloned.password`) - a *direct*
// User.findOne()/find() (e.g. routes/auth.js's login lookup) still gets
// the real hash back, since only a *populated* User needs this; scrubbing
// it at the schema level instead would also hide it from that lookup.
function scrubPassword(val) {
  if (val == null) return;
  if (Array.isArray(val)) { val.forEach(scrubPassword); return; }
  delete val.password;
}

// Shared populate/sort/skip/limit/select chaining + terminal exec(), same
// as lib/MemoryStore.js's Query class - the only difference between the
// three ways of getting a mongoose query (find/findOne/an already-built
// update query) is how `buildQuery()` produces the initial query object.
// `refs` (this model's own ref map) tells exec() which populated paths
// resolved to a User, so it knows where to scrub the password back out.
class ChainableQuery {
  constructor(buildQuery, single, refs) {
    this.buildQuery = buildQuery;
    this.single = single;
    this.refs = refs;
    this._populate = [];
    this._sort = null;
    this._skip = 0;
    this._limit = null;
    this._select = null;
  }

  populate(path, select) {
    this._populate.push(select ? { path, select } : { path });
    return this;
  }

  sort(spec) { this._sort = spec; return this; }
  skip(n) { this._skip = Number(n) || 0; return this; }
  limit(n) { this._limit = n ? Number(n) : null; return this; }
  select(fields) { this._select = fields; return this; }

  scrubPopulatedPasswords(docs) {
    const userPaths = this._populate.filter((p) => this.refs[p.path] === 'User').map((p) => p.path);
    if (userPaths.length === 0) return;
    const list = Array.isArray(docs) ? docs : [docs];
    for (const doc of list) {
      if (!doc) continue;
      for (const path of userPaths) {
        if (path.includes('.')) {
          const [arrField, subField] = path.split('.');
          for (const item of doc[arrField] || []) scrubPassword(item?.[subField]);
        } else {
          scrubPassword(doc[path]);
        }
      }
    }
  }

  async exec() {
    let q = this.buildQuery();
    for (const p of this._populate) q = q.populate(p);
    if (this._sort) q = q.sort(this._sort);
    if (this._skip) q = q.skip(this._skip);
    if (this._limit != null) q = q.limit(this._limit);
    if (this._select) q = q.select(this._select);
    try {
      const result = await q.lean().exec();
      this.scrubPopulatedPasswords(result);
      return this.single ? (result ? stringifyIds(result) : null) : stringifyIds(result);
    } catch (err) {
      // A malformed id (e.g. a stray :id route param) makes Mongoose throw
      // rather than just finding nothing, unlike MemoryStore's plain
      // string comparison - treat it the same way MemoryStore would: no
      // match, not a 500.
      if (err.name === 'CastError') return this.single ? null : [];
      throw err;
    }
  }

  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}

// Builds a sub-schema for an array-of-objects field that needs one nested
// path (e.g. driverComments.commentedBy) populate-able - only that one
// path gets a real type, everything else in each array item stays
// free-form, and no _id is added per item since MemoryStore never had one
// there either.
function buildArrayRefSchema(subField, refModelName) {
  return [new Schema({ [subField]: { type: Schema.Types.ObjectId, ref: refModelName } }, { strict: false, _id: false })];
}

function buildSchema(name, refs) {
  const fields = {};
  const nested = new Map(); // arrField -> { subField: refModelName }

  for (const [path, refModelName] of Object.entries(refs)) {
    if (path.includes('.')) {
      const [arrField, subField] = path.split('.');
      if (!nested.has(arrField)) nested.set(arrField, {});
      nested.get(arrField)[subField] = refModelName;
    } else {
      fields[path] = { type: Schema.Types.ObjectId, ref: refModelName, default: null };
    }
  }
  for (const [arrField, subFields] of nested) {
    // subFields is { subField: refModelName } - this app only ever
    // declares one ref per array (driverComments.commentedBy,
    // adminNotes.noteBy), so take that single entry directly rather than
    // round-tripping it through an intermediate field-definition object.
    const [subField, refModelName] = Object.entries(subFields)[0];
    fields[arrField] = buildArrayRefSchema(subField, refModelName);
  }

  return new Schema(fields, { strict: false, timestamps: true, versionKey: false });
}

function createModel(name, refs = {}) {
  let compiled = null;
  const pendingPreHooks = [];

  function getModel() {
    if (!compiled) {
      const schema = buildSchema(name, refs);
      for (const fn of pendingPreHooks) {
        schema.pre('save', async function hook() {
          if (!this.isNew) return;
          const count = await compiled.countDocuments();
          // Every model's pre() callback (Booking's bookingId, Complaint's
          // complaintId/status/severity/... ) was written against
          // MemoryStore's plain JS objects, where `doc.field = value` (and
          // reading it straight back) just works. On a real Mongoose
          // document with `strict: false`, plain assignment to a path not
          // already declared on the schema is a silent no-op - Mongoose
          // never registers it as modified, so it's dropped on save
          // without error (caught by testing bookingId directly against a
          // real Atlas cluster: set inside the hook, then simply absent
          // from the saved document). `doc.set(path, value)` is the form
          // that actually persists an undeclared path, and `doc.get(path)`
          // the form that reads one back - this Proxy routes plain
          // property access through both automatically, so every model's
          // callback keeps working unchanged (including Complaint's, which
          // reads a field back in the same hook right after setting it -
          // e.g. isSerious feeding requiresTransportAgencyReport - so the
          // get trap isn't optional here, a set-only proxy still silently
          // dropped that value) and MemoryStore/MongooseStore stay
          // interchangeable as the comment above promises.
          const proxy = new Proxy(this, {
            get(target, prop, receiver) {
              const val = Reflect.get(target, prop, receiver);
              return (val === undefined && typeof prop === 'string') ? target.get(prop) : val;
            },
            set(target, prop, value) {
              target.set(prop, value);
              return true;
            },
          });
          await fn(proxy, { docs: { length: count } });
        });
      }
      compiled = mongoose.models[name] || mongoose.model(name, schema);
    }
    return compiled;
  }

  return {
    pre: (fn) => pendingPreHooks.push(fn),
    async create(data) {
      const doc = await getModel().create(data);
      return stringifyIds(doc.toObject());
    },
    find: (filter = {}) => new ChainableQuery(() => getModel().find(filter), false, refs),
    findOne: (filter = {}) => new ChainableQuery(() => getModel().findOne(filter), true, refs),
    findById: (id) => new ChainableQuery(() => getModel().findOne(id ? { _id: id } : { _id: null }), true, refs),
    findByIdAndUpdate: (id, update) => new ChainableQuery(
      () => getModel().findByIdAndUpdate(id, normalizeUpdate(update), { new: true }),
      true,
      refs,
    ),
    findOneAndUpdate: (filter, update) => new ChainableQuery(
      () => getModel().findOneAndUpdate(filter, normalizeUpdate(update), { new: true }),
      true,
      refs,
    ),
    countDocuments: (filter = {}) => getModel().countDocuments(filter),
    deleteMany: (filter = {}) => getModel().deleteMany(filter),
  };
}

module.exports = { createModel };
