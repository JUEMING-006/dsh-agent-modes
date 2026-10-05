// src/index.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
var write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value2) => {
      current = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is("URL"), (a3, b3) => a3.href === b3.href) ?? check(is("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/config.ts
var roleModel = Schema.object({
  provider: Schema.string().required().description("\u63D0\u4F9B\u65B9\uFF1Adeepseek / openai / google / minimax / \u81EA\u5B9A\u4E49"),
  model: Schema.string().required().description("\u6A21\u578B ID\uFF0C\u5982 gpt-5-mini")
});
var workerSchema = Schema.object({
  role: Schema.string().required().description("\u6267\u884C\u89D2\u8272\u540D\uFF0C\u5982\u300C\u901A\u7528\u6267\u884C\u300D\u300C\u5EC9\u4EF7\u6279\u91CF\u300D"),
  provider: Schema.string().required(),
  model: Schema.string().required(),
  note: Schema.string().description("\u8BE5\u89D2\u8272\u64C5\u957F\u4EC0\u4E48\uFF0C\u4F1A\u5199\u8FDB\u6D3E\u53D1\u63D0\u793A")
});
var modeSchema = Schema.object({
  id: Schema.string().required().description("\u6A21\u5F0F ID\uFF08\u82F1\u6587\uFF0C\u7528\u4E8E\u5207\u6362\uFF09"),
  name: Schema.string().required().description("\u6A21\u5F0F\u663E\u793A\u540D"),
  description: Schema.string(),
  lead: roleModel,
  leadSource: Schema.union(["session", "mode"]).default("session").description("session=\u4E3B\u63A7\u7528\u4F1A\u8BDD\u5F53\u524D\u9009\u7684\u6A21\u578B\uFF1Bmode=\u4E3B\u63A7\u56FA\u5B9A\u7528\u4E0B\u9762 lead \u6307\u5B9A\u7684\u6A21\u578B"),
  workers: Schema.array(workerSchema).default([]),
  verifier: roleModel,
  memory: Schema.object({
    shared: Schema.boolean().default(true),
    digestMaxChars: Schema.number().default(6e3)
  }),
  budget: Schema.object({
    monthlyCapUsd: Schema.number().default(20),
    onExceed: Schema.union(["warn", "block"]).default("warn")
  }),
  enforceSubagents: Schema.boolean().default(true).description("\u4E00\u5207\u8DEF\u5F84\u6D3E\u53D1\u7684\u5B50\u4EE3\u7406\u662F\u5426\u5F3A\u5236\u5957\u7528\u672C\u6A21\u5F0F\u7684\u6A21\u578B\u6620\u5C04"),
  subagentWorker: Schema.string().description("\u539F\u751F\u5B50\u4EE3\u7406\u6620\u5C04\u5230\u54EA\u4E2A\u6267\u884C\u89D2\u8272\uFF08\u7F3A\u7701\u53D6\u7B2C\u4E00\u4E2A worker\uFF09")
});
var providerSchema = Schema.object({
  baseUrl: Schema.string().description("\u7559\u7A7A\u5219\u7528\u8BE5 provider \u7684\u5B98\u65B9 OpenAI \u517C\u5BB9\u7AEF\u70B9"),
  apiKey: Schema.string().description('API Key\uFF0C\u652F\u6301 "${ENV_NAME}" \u5F62\u5F0F\u5F15\u7528\u73AF\u5883\u53D8\u91CF')
});
var Config = Schema.intersect([
  Schema.object({
    activeMode: Schema.string().default("gpt-lead").description("\u542F\u52A8\u65F6\u4F7F\u7528\u7684\u7F16\u961F\u6A21\u5F0F ID"),
    modes: Schema.array(modeSchema).default([]).description("\u81EA\u5B9A\u4E49\u7F16\u961F\u6A21\u5F0F\uFF0C\u4F1A\u4E0E\u5185\u7F6E\u6A21\u5F0F\u5408\u5E76\uFF08\u540C id \u8986\u76D6\uFF09"),
    providers: Schema.dict(providerSchema).default({}).description("\u5404\u5BB6 API Key\uFF1B\u4E5F\u53EF\u5728 LiteLLM \u7F51\u5173\u6A21\u5F0F\u4E0B\u7559\u7A7A"),
    gateway: Schema.object({
      mode: Schema.union(["direct", "litellm"]).default("direct"),
      baseUrl: Schema.string().default("http://127.0.0.1:4141"),
      apiKey: Schema.string().default("")
    }).description("LiteLLM \u7F51\u5173\uFF08\u5B8C\u6574\u7248\u8BB0\u8D26/\u9884\u7B97\uFF09\uFF0C\u76F4\u8FDE\u6A21\u5F0F\u53EF\u5FFD\u7565"),
    pricing: Schema.dict(Schema.dict(Schema.object({
      in: Schema.number(),
      out: Schema.number()
    }))).default({}).description("\u4EF7\u683C\u8868\u8986\u76D6\uFF1AUSD/\u6BCF\u767E\u4E07 token"),
    ui: Schema.object({
      enabled: Schema.boolean().default(true),
      bottomBar: Schema.boolean().default(true).description("\u60AC\u6D6E\u6A2A\u72B6\u6761\uFF08\u70B9\u51FB\u5C55\u5F00\u9762\u677F\uFF09"),
      overlayPanel: Schema.boolean().default(true),
      dashboardPort: Schema.number().default(3117).description("\u672C\u5730\u770B\u677F\u7AEF\u53E3\uFF08\u6D4F\u89C8\u5668\u76F4\u63A5\u6253\u5F00\u7684\u515C\u5E95\u754C\u9762\uFF09"),
      slotNames: Schema.string().default("shell.overlay,shell.bottom").description("\u6A2A\u6761\u6CE8\u518C\u7684 slot \u5E2D\u4F4D\uFF0C\u9017\u53F7\u5206\u9694\u6309\u5E8F\u5C1D\u8BD5")
    }),
    memory: Schema.object({
      digestMaxChars: Schema.number().default(6e3),
      summarizeOverChars: Schema.number().default(24e3),
      injectRecentSessions: Schema.number().default(0).description("\u56E2\u961F\u8BB0\u5FC6\u5F00\u5934\u6CE8\u5165\u6700\u8FD1 N \u4E2A dsh \u4F1A\u8BDD\u7684\u6458\u8981\uFF08\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6\u6620\u5C04\uFF0C0=\u5173\u95ED\uFF09")
    }),
    budget: Schema.object({
      monthlyCapUsd: Schema.number().default(20),
      onExceed: Schema.union(["warn", "block"]).default("warn")
    }),
    verifySubagents: Schema.boolean().default(true).description("team_spawn \u7684\u771F\u5B9E\u5B50\u4EE3\u7406\u5B8C\u6210\u540E\u81EA\u52A8\u9A8C\u8BC1"),
    mock: Schema.object({
      enabled: Schema.boolean().default(false).description("\u6CE8\u518C\u5185\u7F6E\u6A21\u62DF\u9002\u914D\u5668\uFF08provider=mock\uFF09\uFF0C\u96F6 API Key \u81EA\u6D4B\u6D41\u6C34\u7EBF")
    })
  }),
  Schema.object({})
]);
function normalizeConfig(raw) {
  const d = raw ?? {};
  return {
    activeMode: d.activeMode ?? "gpt-lead",
    modes: d.modes ?? [],
    providers: d.providers ?? {},
    gateway: {
      mode: d.gateway?.mode ?? "direct",
      baseUrl: d.gateway?.baseUrl || "http://127.0.0.1:4141",
      apiKey: d.gateway?.apiKey ?? ""
    },
    pricing: d.pricing ?? {},
    ui: {
      enabled: d.ui?.enabled ?? true,
      bottomBar: d.ui?.bottomBar ?? true,
      overlayPanel: d.ui?.overlayPanel ?? true,
      dashboardPort: d.ui?.dashboardPort ?? 3117,
      slotNames: d.ui?.slotNames ?? "shell.overlay,shell.bottom"
    },
    memory: {
      digestMaxChars: d.memory?.digestMaxChars ?? 6e3,
      summarizeOverChars: d.memory?.summarizeOverChars ?? 24e3,
      injectRecentSessions: d.memory?.injectRecentSessions ?? 0
    },
    budget: {
      monthlyCapUsd: d.budget?.monthlyCapUsd ?? 20,
      onExceed: d.budget?.onExceed ?? "warn"
    },
    verifySubagents: d.verifySubagents ?? true,
    mock: { enabled: d.mock?.enabled ?? false }
  };
}

// src/dshllm.ts
var DshLlm = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  cache = null;
  runtime() {
    const reflect = this.ctx.reflect;
    try {
      return reflect?.get?.("llm", false);
    } catch {
      return void 0;
    }
  }
  available() {
    return !!this.runtime();
  }
  /** 该 provider 是否由 dsh 运行时接管（是则可用 dsh 凭据调用） */
  knows(provider) {
    if (!this.available()) return false;
    if (!this.cache) return false;
    return this.cache.some((p) => p.id === provider);
  }
  async listProviderModels(force = false) {
    if (this.cache && !force) return this.cache;
    const rt = this.runtime();
    if (!rt) return [];
    const out = [];
    for (const p of rt.listProviders()) {
      try {
        const models = await rt.listModels(p.id) ?? [];
        out.push({
          id: p.id,
          name: p.name || p.id,
          models: models.map((m) => ({ id: m.id, name: m.name || m.id }))
        });
      } catch {
        out.push({ id: p.id, name: p.name || p.id, models: [] });
      }
    }
    this.cache = out;
    return out;
  }
  /** 经 dsh 运行时一次性调用，usage 换算为 OpenAI 口径字段 */
  async call(opts) {
    const rt = this.runtime();
    if (!rt) throw new Error("dsh llm \u670D\u52A1\u4E0D\u53EF\u7528");
    const options = {
      provider: opts.provider,
      model: opts.model,
      messages: [{ role: "user", content: [{ type: "text", text: opts.prompt }] }],
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens ?? 4096
    };
    if (opts.system) options.system = opts.system;
    if (opts.signal) options.signal = opts.signal;
    let text = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    for await (const chunk of rt.stream(options)) {
      if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
      else if (chunk.type === "usage" && chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.inputTokens ?? 0,
          completion_tokens: chunk.usage.outputTokens ?? 0
        };
      }
    }
    return { text, usage };
  }
};

// src/enforce.ts
var SubagentEnforcer = class {
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.opts = opts;
  }
  /** 等服务就绪后包装（幂等） */
  attach(poll = 20) {
    const attempt = (left) => {
      try {
        const reflect = this.ctx.reflect;
        const rt = reflect?.get?.("subagents", false);
        if (!rt?.start) {
          if (left > 0) setTimeout(() => attempt(left - 1), 500);
          return;
        }
        if (rt.__amWrapped) return;
        this.wrap(rt);
      } catch (err) {
        this.ctx.logger?.warn?.(`[agent-modes] \u5B50\u4EE3\u7406\u6620\u5C04\u5668\u6302\u8F7D\u5931\u8D25\uFF1A${err.message}`);
      }
    };
    attempt(poll);
  }
  wrap(rt) {
    const self = this;
    const origStart = rt.start.bind(rt);
    rt.start = async function(provider, req) {
      const req2 = self.override(req, "start");
      const run = await origStart(provider, req2);
      try {
        void Promise.resolve(run.result)?.then?.(async (res) => {
          const text = (res?.output ?? []).map((b) => b?.text ?? "").join("\n").trim();
          if (!text) return;
          const verdict = await self.opts.verify(text);
          self.opts.log(`\u{1F50D} \u81EA\u52A8\u9A8C\u8BC1 \u2192 ${verdict.slice(0, 160)}`);
        }).catch(() => {
        });
      } catch {
      }
      return run;
    };
    if (rt.startContinuable) {
      const origCont = rt.startContinuable.bind(rt);
      rt.startContinuable = async function(spec) {
        return origCont(self.override(spec, "continuable"));
      };
    }
    rt.__amWrapped = true;
    self.ctx.logger?.info?.("[agent-modes] \u5B50\u4EE3\u7406\u5F3A\u5236\u6620\u5C04\u5DF2\u6302\u8F7D\uFF08\u4E00\u5207\u6D3E\u53D1\u8DEF\u5F84\u751F\u6548\uFF09");
  }
  /** 按当前模式覆盖子代理的 provider/model */
  override(req, via) {
    const mode = this.opts.getMode();
    if (mode.enforceSubagents === false) return req;
    const w = mode.workers.find((x) => x.role === mode.subagentWorker) ?? mode.workers[0] ?? null;
    if (!w) return req;
    const ao = { ...req.agentOptions ?? {}, provider: w.provider, model: w.model };
    this.opts.log(`\u{1F9E9} \u5B50\u4EE3\u7406\u5DF2\u6620\u5C04\uFF08${via}\uFF09\u2192 ${w.role} \xB7 ${w.provider}/${w.model}`);
    return { ...req, agentOptions: ao };
  }
};

// src/pricing.ts
var PRICE_TABLE = {
  deepseek: {
    "deepseek-flash": { in: 0.3, out: 1.2 },
    "deepseek-v4-pro": { in: 1.32, out: 3.96 }
  },
  openai: {
    "gpt-5.1": { in: 1.25, out: 10 },
    "gpt-5-mini": { in: 0.25, out: 2 },
    "gpt-5-nano": { in: 0.05, out: 0.4 },
    "gpt-4o-mini": { in: 0.15, out: 0.6 }
  },
  google: {
    "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
    "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 }
  },
  minimax: {
    "MiniMax-M3": { in: 0.3, out: 1.2 },
    "MiniMax-M2.7": { in: 0.3, out: 1.2 }
  },
  mock: {
    "mock-fast": { in: 0, out: 0 },
    "mock-smart": { in: 0, out: 0 }
  }
};
function lookupPrice(provider, model, overrides) {
  const hit = overrides?.[provider]?.[model] ?? PRICE_TABLE[provider]?.[model];
  return hit ?? { in: 0.5, out: 2 };
}
function calcCost(provider, model, promptTokens, completionTokens, overrides) {
  const p = lookupPrice(provider, model, overrides);
  return promptTokens / 1e6 * p.in + completionTokens / 1e6 * p.out;
}
var PROVIDER_BASE_URLS = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  minimax: "https://api.minimax.io/v1"
};
function resolveEndpoint(provider, providers) {
  const cfg = providers[provider];
  const baseUrl = cfg?.baseUrl || PROVIDER_BASE_URLS[provider];
  if (!baseUrl) throw new Error(`\u672A\u77E5\u7684 provider "${provider}"\uFF0C\u8BF7\u5728\u63D2\u4EF6\u914D\u7F6E\u7684 providers \u4E2D\u8865\u5145 baseUrl \u4E0E apiKey`);
  let apiKey = cfg?.apiKey || "";
  const envRef = apiKey.match(/^\$\{(\w+)\}$/);
  if (envRef) apiKey = process.env[envRef[1]] ?? "";
  if (!apiKey) throw new Error(`provider "${provider}" \u7F3A\u5C11 apiKey\uFF08\u53EF\u5728\u914D\u7F6E\u4E2D\u76F4\u63A5\u586B\uFF0C\u6216\u7528 "\${ENV_NAME}" \u5F15\u7528\u73AF\u5883\u53D8\u91CF\uFF09`);
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

// src/gateway.ts
var Gateway = class {
  constructor(config, onCall, dsh) {
    this.config = config;
    this.onCall = onCall;
    this.dsh = dsh;
  }
  async call(opts) {
    const { provider, model } = opts.target;
    if (this.dsh?.available()) {
      if (!this.dsh.knows(provider)) await this.dsh.listProviderModels().catch(() => []);
      if (this.dsh.knows(provider)) return this.callViaDsh(opts);
    }
    const g = this.config.gateway;
    if (g.mode === "litellm" && g.baseUrl) {
      return this.callHttp(opts, g.baseUrl.replace(/\/$/, ""), g.apiKey || "sk-dsh-agent-modes");
    }
    const ep = resolveEndpoint(provider, this.config.providers);
    return this.callHttp(opts, ep.baseUrl, ep.apiKey);
  }
  async callViaDsh(opts) {
    const { provider, model } = opts.target;
    const started = Date.now();
    const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const prompt = opts.messages.filter((m) => m.role !== "system").map((m) => m.role === "assistant" ? `[\u4E4B\u524D\u7684\u52A9\u624B\u56DE\u590D]
${m.content}` : m.content).join("\n\n");
    const r = await this.dsh.call({
      provider,
      model,
      system: system || void 0,
      prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal
    });
    const result = {
      text: r.text,
      usage: r.usage,
      costUsd: calcCost(provider, model, r.usage.prompt_tokens, r.usage.completion_tokens, this.config.pricing),
      provider,
      model,
      role: opts.role,
      durationMs: Date.now() - started
    };
    this.onCall(result);
    return result;
  }
  async callHttp(opts, baseUrl, apiKey) {
    const { provider, model } = opts.target;
    const body = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 4096
    };
    if (opts.json) body.response_format = { type: "json_object" };
    const started = Date.now();
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal
      });
    } catch (err) {
      throw new Error(`[${provider}/${model}] \u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${err.message}`);
    }
    if (!res.ok) {
      const text2 = await res.text().catch(() => "");
      throw new Error(`[${provider}/${model}] HTTP ${res.status}\uFF1A${text2.slice(0, 400)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    const result = {
      text,
      usage,
      costUsd: calcCost(provider, model, usage.prompt_tokens, usage.completion_tokens, this.config.pricing),
      provider,
      model,
      role: opts.role,
      durationMs: Date.now() - started
    };
    this.onCall(result);
    return result;
  }
  /** 解析模型返回中的 JSON（容忍 ```json 包裹与前后杂文） */
  static parseJson(text) {
    const stripped = text.replace(/```json\s*|```\s*/g, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`\u8FD4\u56DE\u5185\u5BB9\u4E0D\u662F JSON\uFF1A${text.slice(0, 200)}`);
    return JSON.parse(stripped.slice(start, end + 1));
  }
};

// src/mockllm.ts
var MOCK_PROVIDER = "mock";
function registerMockAdapter(ctx) {
  const attempt = (left) => {
    try {
      const reflect = ctx.reflect;
      const logger = ctx.logger;
      const llm = reflect?.get?.("llm", false);
      if (!llm?.registerAdapter || !llm.listProviders) {
        if (left > 0) setTimeout(() => attempt(left - 1), 500);
        else logger?.warn?.("[agent-modes] llm \u670D\u52A1\u672A\u5C31\u7EEA\uFF0Cmock \u9002\u914D\u5668\u672A\u6CE8\u518C");
        return;
      }
      if ((llm.listProviders() ?? []).some((p) => p.id === MOCK_PROVIDER)) return;
      llm.registerAdapter([MOCK_PROVIDER], new MockAdapter());
      logger?.info?.("[agent-modes] mock \u9002\u914D\u5668\u5DF2\u6CE8\u518C\uFF08provider=mock\uFF0C\u96F6 API Key \u81EA\u6D4B\u7528\uFF09");
    } catch (err) {
      ctx.logger?.warn?.(`[agent-modes] mock \u9002\u914D\u5668\u6CE8\u518C\u5931\u8D25\uFF1A${err.message}`);
    }
  };
  attempt(20);
}
var MockAdapter = class {
  providerInfo(provider) {
    return { id: provider, name: "\u6A21\u62DF\u6A21\u578B\uFF08\u65E0\u9700 API Key\uFF09" };
  }
  async listModels(provider) {
    return [
      { provider, id: "mock-fast", name: "Mock \u5FEB\u901F\uFF08\u6A21\u62DF\uFF09" },
      { provider, id: "mock-smart", name: "Mock \u667A\u80FD\uFF08\u6A21\u62DF\uFF09" }
    ];
  }
  async resolveModel(provider, model) {
    return { provider, model };
  }
  async *stream(options) {
    const all = (options.system ? options.system + "\n" : "") + (options.messages ?? []).map((m) => m.content).join("\n");
    const reply = mockReply(options.model ?? "mock-fast", all);
    yield { type: "block-start", index: 0, blockType: "text" };
    for (let i = 0; i < reply.length; i += 24) {
      yield { type: "text-delta", index: 0, text: reply.slice(i, i + 24) };
    }
    yield { type: "block-end", index: 0, block: { type: "text", text: reply } };
    const inputTokens = Math.max(1, Math.round(all.length / 3));
    const outputTokens = Math.max(1, Math.round(reply.length / 2));
    yield { type: "usage", usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } };
    yield { type: "finish", reason: "stop" };
  }
};
function mockReply(model, prompt) {
  if (prompt.includes('"subtasks"') && prompt.includes("\u4E3B\u63A7")) {
    const roles = [...prompt.matchAll(/- ([^\n（]+)（/g)].map((m) => m[1].trim());
    const task = prompt.split("# \u4EFB\u52A1\n")[1]?.trim() ?? "\uFF08\u672A\u8BC6\u522B\u4EFB\u52A1\uFF09";
    const picked = roles.length ? roles : ["\u901A\u7528\u6267\u884C"];
    const subtasks = picked.slice(0, 2).map((role2, i) => ({
      worker: role2,
      task: `\uFF08\u6A21\u62DF\uFF09${i === 0 ? "\u8981\u70B9\u6574\u7406" : "\u8865\u5145\u8BF4\u660E"}\uFF1A${task.slice(0, 60)}`
    }));
    return JSON.stringify({ subtasks, note: "mock planner" });
  }
  if (prompt.includes("\u72EC\u7ACB\u9A8C\u8BC1\u5458")) {
    return JSON.stringify({ pass: true, issues: [], revised: null });
  }
  if (prompt.includes("\u538B\u7F29\u6210\u8981\u70B9\u6458\u8981") || prompt.includes("\u8BB0\u5F55\u5458")) {
    return "\uFF08\u6A21\u62DF\u6458\u8981\uFF09\u56E2\u961F\u8BB0\u5F55\u5DF2\u538B\u7F29\u3002";
  }
  const taskLine = prompt.split("# \u4F60\u7684\u5B50\u4EFB\u52A1\n")[1]?.split("\n")[0] ?? "";
  return [
    `\uFF08Mock ${model} \u6A21\u62DF\u6267\u884C\uFF09`,
    taskLine ? `\u4EFB\u52A1\uFF1A${taskLine.slice(0, 80)}` : "",
    "\u8FD9\u662F\u5185\u7F6E\u6A21\u62DF\u9002\u914D\u5668\u7684\u786E\u5B9A\u6027\u56DE\u590D\uFF0C\u7528\u4E8E\u5728\u4E0D\u914D\u7F6E\u4EFB\u4F55 API Key \u7684\u60C5\u51B5\u4E0B\u9A8C\u8BC1\u7F16\u961F\u6D41\u6C34\u7EBF\u3001",
    "\u9762\u677F\u5C55\u793A\u4E0E\u8BB0\u8D26\u94FE\u8DEF\u3002\u63A5\u5165\u771F\u5B9E\u6A21\u578B\u524D\uFF0C\u8BF7\u52FF\u5C06\u672C\u6A21\u5F0F\u7684\u4EA7\u51FA\u7528\u4E8E\u751F\u4EA7\u3002"
  ].filter(Boolean).join("\n");
}

// src/definetool.ts
function params(fields) {
  const properties = {};
  const required = [];
  for (const [name2, f] of Object.entries(fields)) {
    properties[name2] = { type: f.type, description: f.description };
    if (f.required) required.push(name2);
  }
  return { type: "object", properties, ...required.length ? { required } : {} };
}
function defineTool(spec) {
  return spec;
}
var textOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: String(value) }]
};

// src/orchestrator.ts
function registerTools(ctx, deps) {
  const { modes, gateway, ledger, memory, store, config } = deps;
  const subagents = () => {
    try {
      const reflect = ctx.reflect;
      return reflect?.get?.("subagents", false);
    } catch {
      return void 0;
    }
  };
  const guard = () => {
    if (store.get().running) throw new Error("\u5DF2\u6709\u7F16\u961F\u4EFB\u52A1\u5728\u6267\u884C\u4E2D\uFF0C\u8BF7\u5148\u7528 team_status \u67E5\u770B\uFF0C\u5B8C\u6210\u540E\u518D\u6D3E\u65B0\u4EFB\u52A1");
    const budgetMsg = ledger.checkBudget();
    if (!budgetMsg) return null;
    if (budgetMsg.includes("warn \u6A21\u5F0F\u7EE7\u7EED\u6267\u884C")) return budgetMsg;
    throw new Error(budgetMsg);
  };
  async function runWorker(w, task, extraContext) {
    store.setActivity(`\u6267\u884C\u4E2D\uFF1A${w.role}\uFF08${w.provider}/${w.model}\uFF09`);
    const digest = await memory.digest();
    const recent = config.memory.injectRecentSessions > 0 ? `
# \u8FD1\u671F\u4F1A\u8BDD\u8BB0\u5FC6\uFF08\u6765\u81EA dsh \u4F1A\u8BDD\u8BB0\u5F55\uFF09
${deps.recentMemory(config.memory.injectRecentSessions)}
` : "";
    const messages = [
      {
        role: "system",
        content: [
          `\u4F60\u662F\u591A\u667A\u80FD\u4F53\u56E2\u961F\u4E2D\u7684\u6267\u884C\u6210\u5458\uFF0C\u89D2\u8272\uFF1A${w.role}\u3002`,
          w.note ? `\u4F60\u7684\u4E13\u957F\uFF1A${w.note}` : "",
          "\u53EA\u5B8C\u6210\u5206\u914D\u7ED9\u4F60\u7684\u5B50\u4EFB\u52A1\uFF0C\u8F93\u51FA\u7ED3\u679C\u672C\u4F53\uFF0C\u4E0D\u8981\u5BD2\u6684\uFF1B\u5982\u679C\u4FE1\u606F\u4E0D\u8DB3\uFF0C\u5728\u5F00\u5934\u7528\u300C\u9700\u8981\u8865\u5145\uFF1A\u300D\u5217\u51FA\u3002"
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: [
          `${recent}# \u56E2\u961F\u5171\u4EAB\u4E0A\u4E0B\u6587
${digest || "\uFF08\u65E0\uFF09"}`,
          extraContext ? `# \u8865\u5145\u80CC\u666F
${extraContext}` : "",
          `# \u4F60\u7684\u5B50\u4EFB\u52A1
${task}`
        ].filter(Boolean).join("\n\n")
      }
    ];
    const r = await gateway.call({ role: w.role, kind: "worker", target: w, messages, temperature: 0.5 });
    memory.add("worker", w.role, r.text);
    store.pushLog(`\u2705 ${w.role} \u5B8C\u6210\uFF08${r.usage.completion_tokens} tok\uFF0C$${r.costUsd.toFixed(4)}\uFF09`);
    return r.text;
  }
  async function runVerifier(content, criteria) {
    return verifyWithMode(deps, content, criteria);
  }
  async function planWithLead(task) {
    const mode = modes.active;
    store.setActivity(`\u4E3B\u63A7\u89C4\u5212\u4E2D\uFF1A${mode.lead.provider}/${mode.lead.model}`);
    const roster = mode.workers.map((w) => `- ${w.role}\uFF08${w.provider}/${w.model}${w.note ? "\uFF0C\u64C5\u957F\uFF1A" + w.note : ""}\uFF09`).join("\n");
    const messages = [
      {
        role: "system",
        content: '\u4F60\u662F\u591A\u667A\u80FD\u4F53\u56E2\u961F\u7684\u4E3B\u63A7\u3002\u628A\u7528\u6237\u4EFB\u52A1\u62C6\u89E3\u4E3A\u53EF\u5E76\u884C/\u4E32\u884C\u7684\u5B50\u4EFB\u52A1\uFF0C\u5206\u914D\u7ED9\u5408\u9002\u7684\u6267\u884C\u89D2\u8272\u3002\u8F93\u51FA JSON\uFF1A{"subtasks": [{"worker": string, "task": string}], "note": string?}\u3002worker \u5FC5\u987B\u4ECE\u89D2\u8272\u540D\u5355\u91CC\u9009\uFF1Btask \u8981\u81EA\u5305\u542B\uFF08\u6267\u884C\u8005\u770B\u4E0D\u5230\u539F\u59CB\u5BF9\u8BDD\uFF09\u3002'
      },
      { role: "user", content: `# \u53EF\u7528\u6267\u884C\u89D2\u8272
${roster}

# \u4EFB\u52A1
${task}` }
    ];
    const r = await gateway.call({ role: "lead", kind: "plan", target: mode.lead, messages, json: true, temperature: 0.3 });
    memory.add("plan", "lead", r.text);
    return Gateway.parseJson(r.text);
  }
  async function assembleWithLead(task, outputs) {
    const mode = modes.active;
    store.setActivity(`\u4E3B\u63A7\u6C47\u603B\u4E2D\uFF1A${mode.lead.provider}/${mode.lead.model}`);
    const messages = [
      { role: "system", content: "\u4F60\u662F\u591A\u667A\u80FD\u4F53\u56E2\u961F\u7684\u4E3B\u63A7\u3002\u57FA\u4E8E\u6267\u884C\u4E0E\u9A8C\u8BC1\u7ED3\u679C\u8F93\u51FA\u6700\u7EC8\u4EA4\u4ED8\u5185\u5BB9\uFF1B\u4FDD\u7559\u9A8C\u8BC1\u5458\u4FEE\u6B63\u8FC7\u7684\u95EE\u9898\uFF1B\u8BED\u8A00\u4E0E\u7528\u6237\u4EFB\u52A1\u4E00\u81F4\u3002" },
      { role: "user", content: `# \u539F\u59CB\u4EFB\u52A1
${task}

# \u56E2\u961F\u4EA7\u51FA
${outputs.slice(0, 4e4)}` }
    ];
    const r = await gateway.call({ role: "lead", kind: "assemble", target: mode.lead, messages, temperature: 0.4 });
    memory.add("assembly", "lead", r.text);
    return r.text;
  }
  const usageLine = () => {
    const t = ledger.today().total;
    return `\uFF08\u4ECA\u65E5 ${t.calls} \u6B21\u8C03\u7528\uFF0C$${t.costUsd}\uFF09`;
  };
  const tools = [
    defineTool({
      name: "team_mode_list",
      description: "\u5217\u51FA\u6240\u6709\u53EF\u7528\u7684\u667A\u80FD\u4F53\u7F16\u961F\u6A21\u5F0F\u53CA\u5F53\u524D\u6FC0\u6D3B\u6A21\u5F0F",
      parameters: params({}),
      output: textOutput,
      execute: async () => {
        return modes.list().map((m) => `${m.id === modes.active.id ? "\u2192" : " "} ${m.id}\uFF5C${m.name}\uFF5C\u4E3B\u63A7 ${m.lead.provider}/${m.lead.model}\uFF0C\u6267\u884C ${m.workers.map((w) => `${w.role}:${w.model}`).join("\u3001")}\uFF0C\u9A8C\u8BC1 ${m.verifier.model}`).join("\n");
      }
    }),
    defineTool({
      name: "team_mode_switch",
      description: "\u5207\u6362\u5F53\u524D\u7F16\u961F\u6A21\u5F0F\uFF08\u4E3B\u63A7/\u6267\u884C/\u9A8C\u8BC1\u7684\u6A21\u578B\u7EC4\u5408\u968F\u4E4B\u6539\u53D8\uFF09",
      parameters: params({ mode: { type: "string", required: true, description: "\u8981\u5207\u6362\u5230\u7684\u6A21\u5F0F ID\uFF0C\u89C1 team_mode_list" } }),
      output: textOutput,
      execute: async (args) => {
        const m = modes.switch(args.mode);
        store.setActiveMode(m.id);
        store.setRoles(modes.roles());
        memory.clear();
        return `\u5DF2\u5207\u6362\u5230\u300C${m.name}\u300D\u3002\u7F16\u961F\uFF1A\u4E3B\u63A7 ${m.lead.provider}/${m.lead.model}\uFF1B\u6267\u884C ${m.workers.map((w) => `${w.role}=${w.provider}/${w.model}`).join("\u3001")}\uFF1B\u9A8C\u8BC1 ${m.verifier.provider}/${m.verifier.model}`;
      }
    }),
    defineTool({
      name: "team_set_role",
      description: "\u5FAE\u8C03\u5F53\u524D\u6A21\u5F0F\u4E0B\u67D0\u4E2A\u89D2\u8272\u4F7F\u7528\u7684\u6A21\u578B\uFF08role \u53EF\u4E3A lead / verifier / \u67D0\u4E2A\u6267\u884C\u89D2\u8272\u540D\uFF09",
      parameters: params({
        role: { type: "string", required: true, description: "lead | verifier | \u6267\u884C\u89D2\u8272\u540D" },
        provider: { type: "string", required: true, description: "\u63D0\u4F9B\u65B9\uFF1Adeepseek / openai / google / minimax" },
        model: { type: "string", required: true, description: "\u6A21\u578B ID" }
      }),
      output: textOutput,
      execute: async (args) => {
        const m = modes.setRole(args.role, args.provider, args.model);
        store.setRoles(modes.roles());
        return `\u5DF2\u628A ${args.role} \u8C03\u6574\u4E3A ${args.provider}/${args.model}\uFF08\u6A21\u5F0F\uFF1A${m.name}\uFF09`;
      }
    }),
    defineTool({
      name: "team_dispatch",
      description: "\u628A\u4E00\u4E2A\u5B50\u4EFB\u52A1\u6D3E\u7ED9\u5F53\u524D\u6A21\u5F0F\u4E0B\u7684\u6307\u5B9A\u6267\u884C\u89D2\u8272\uFF08\u7528\u8BE5\u89D2\u8272\u914D\u7F6E\u7684\u6A21\u578B\u6267\u884C\uFF0C\u5171\u4EAB\u56E2\u961F\u8BB0\u5FC6\uFF09",
      parameters: params({
        worker: { type: "string", required: true, description: "\u6267\u884C\u89D2\u8272\u540D\uFF08\u89C1 team_status\uFF09" },
        task: { type: "string", required: true, description: "\u5B50\u4EFB\u52A1\u63CF\u8FF0\uFF0C\u9700\u81EA\u5305\u542B" },
        context: { type: "string", description: "\u53EF\u9009\u8865\u5145\u80CC\u666F" }
      }),
      output: textOutput,
      execute: async (args) => {
        const budgetWarn = guard();
        const w = modes.active.workers.find((x) => x.role === args.worker);
        if (!w) throw new Error(`\u6267\u884C\u89D2\u8272 "${args.worker}" \u4E0D\u5B58\u5728\u3002\u53EF\u7528\uFF1A${modes.active.workers.map((x) => x.role).join("\u3001")}`);
        store.setRunning(true, args.task);
        try {
          memory.add("task", "lead", args.task);
          const out = await runWorker(w, args.task, args.context);
          return `${budgetWarn ?? ""}[${w.role} \xB7 ${w.provider}/${w.model}] \u5B8C\u6210${usageLine()}

${out}`;
        } finally {
          store.setRunning(false);
        }
      }
    }),
    defineTool({
      name: "team_dispatch_many",
      description: '\u5E76\u884C\u6D3E\u53D1\u591A\u4E2A\u5B50\u4EFB\u52A1\u7ED9\u4E0D\u540C\u6267\u884C\u89D2\u8272\u3002tasksJson \u683C\u5F0F\uFF1A[{"worker":"\u89D2\u8272\u540D","task":"\u5B50\u4EFB\u52A1"}]',
      parameters: params({ tasksJson: { type: "string", required: true, description: "JSON \u6570\u7EC4\u5B57\u7B26\u4E32" } }),
      output: textOutput,
      execute: async (args) => {
        const budgetWarn = guard();
        const tasks = Gateway.parseJson(args.tasksJson);
        const ws = modes.active.workers;
        const jobs = tasks.map((t) => {
          const w = ws.find((x) => x.role === t.worker);
          if (!w) throw new Error(`\u6267\u884C\u89D2\u8272 "${t.worker}" \u4E0D\u5B58\u5728\u3002\u53EF\u7528\uFF1A${ws.map((x) => x.role).join("\u3001")}`);
          return { w, t };
        });
        store.setRunning(true, `${jobs.length} \u4E2A\u5E76\u884C\u5B50\u4EFB\u52A1`);
        try {
          memory.add("task", "lead", tasks.map((t) => `[${t.worker}] ${t.task}`).join("\n"));
          const outs = await Promise.all(jobs.map(({ w, t }) => runWorker(w, t.task, t.context).catch((e) => `\u274C ${w.role} \u5931\u8D25\uFF1A${e.message}`)));
          const body = jobs.map(({ w }, i) => `## [${w.role} \xB7 ${w.provider}/${w.model}]
${outs[i]}`).join("\n\n");
          return `${budgetWarn ?? ""}\u5168\u90E8\u5B8C\u6210${usageLine()}

${body}`;
        } finally {
          store.setRunning(false);
        }
      }
    }),
    defineTool({
      name: "team_spawn",
      description: "\u6D3E\u53D1\u4E00\u4E2A\u3010\u771F\u5B9E\u5B50\u4EE3\u7406\u3011(\u62E5\u6709 dsh \u5168\u90E8\u5DE5\u5177:\u7EC8\u7AEF/\u6587\u4EF6/\u8054\u7F51\u7B49),\u7528\u5F53\u524D\u6A21\u5F0F\u91CC\u8BE5\u89D2\u8272\u914D\u7F6E\u7684\u6A21\u578B\u6267\u884C\u3002\u4E0E team_dispatch \u7684\u533A\u522B:\u90A3\u4E2A\u662F\u7EAF\u6587\u672C\u5355\u6B21\u8C03\u7528,\u8FD9\u4E2A\u662F\u771F\u4EE3\u7406,\u80FD\u81EA\u4E3B\u4F7F\u7528\u5DE5\u5177\u5B8C\u6210\u591A\u6B65\u4EFB\u52A1;\u5B50\u4EE3\u7406\u7528\u91CF\u8BA1\u5165 dsh \u7528\u91CF\u7EDF\u8BA1",
      parameters: params({
        worker: { type: "string", description: "\u6267\u884C\u89D2\u8272\u540D(\u89C1 team_status);\u7701\u7565\u5219\u81EA\u52A8\u5339\u914D" },
        task: { type: "string", required: true, description: "\u5B50\u4EFB\u52A1\u63CF\u8FF0,\u9700\u81EA\u5305\u542B" },
        context: { type: "string", description: "\u53EF\u9009\u8865\u5145\u80CC\u666F" },
        verify: { type: "boolean", description: "\u5B8C\u6210\u540E\u662F\u5426\u7528\u9A8C\u8BC1\u6A21\u578B\u5BA1\u67E5,\u9ED8\u8BA4 true" }
      }),
      output: textOutput,
      execute: async (args, exec) => {
        const rt = subagents();
        if (!rt) throw new Error("\u5B50\u4EE3\u7406\u8FD0\u884C\u65F6(ctx.subagents)\u4E0D\u53EF\u7528");
        const names = rt.list?.() ?? [];
        const pick2 = ["spawn", "spawn-in-process"].find((n) => names.includes(n)) ?? names.find((n) => n.includes("spawn"));
        if (!pick2) throw new Error(`\u672A\u627E\u5230 spawn \u7C7B\u5B50\u4EE3\u7406\u63D0\u4F9B\u65B9\u3002\u53EF\u7528: ${names.join(", ")}`);
        const parent = exec?.agent;
        if (!parent) throw new Error("\u65E0\u6CD5\u786E\u5B9A\u8C03\u7528\u8005\u4EE3\u7406(exec.agent \u4E3A\u7A7A),\u8BF7\u6539\u7528 team_dispatch");
        let w;
        if (args.worker) {
          const hit = modes.active.workers.find((x) => x.role === args.worker);
          if (!hit) throw new Error(`\u6267\u884C\u89D2\u8272 "${args.worker}" \u4E0D\u5B58\u5728\u3002\u53EF\u7528: ${modes.active.workers.map((x) => x.role).join("\u3001")}`);
          w = hit;
        } else {
          w = modes.active.workers.find((x) => x.note?.includes("\u901A\u7528")) ?? modes.active.workers[0];
        }
        if (!w) throw new Error("\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u6267\u884C\u89D2\u8272");
        const budgetWarn = guard();
        store.setRunning(true, args.task);
        try {
          memory.add("task", "lead", `[spawn/${w.role}] ${args.task}`);
          store.setActivity(`\u771F\u5B9E\u5B50\u4EE3\u7406\u6267\u884C\u4E2D\uFF1A${w.role}\uFF08${w.provider}/${w.model}\uFF09`);
          const digest = await memory.digest();
          const prompt = [
            `\u4F60\u662F\u591A\u667A\u80FD\u4F53\u56E2\u961F\u4E2D\u7684\u6267\u884C\u6210\u5458\uFF0C\u89D2\u8272\uFF1A${w.role}\u3002`,
            w.note ? `\u4F60\u7684\u4E13\u957F\uFF1A${w.note}` : "",
            "\u8BF7\u4F7F\u7528\u4F60\u62E5\u6709\u7684\u5DE5\u5177\uFF08\u7EC8\u7AEF/\u6587\u4EF6/\u8054\u7F51\u7B49\uFF09\u5B8C\u6210\u5B50\u4EFB\u52A1\uFF1B\u53EA\u8F93\u51FA\u7ED3\u679C\u672C\u4F53\uFF0C\u4E0D\u8981\u5BD2\u6684\uFF1B\u4FE1\u606F\u4E0D\u8DB3\u65F6\u5728\u5F00\u5934\u7528\u300C\u9700\u8981\u8865\u5145\uFF1A\u300D\u5217\u51FA\u3002",
            "",
            `# \u56E2\u961F\u5171\u4EAB\u4E0A\u4E0B\u6587
${digest || "\uFF08\u65E0\uFF09"}`,
            args.context ? `# \u8865\u5145\u80CC\u666F
${args.context}` : "",
            `# \u4F60\u7684\u5B50\u4EFB\u52A1
${args.task}`
          ].filter(Boolean).join("\n");
          const run = await rt.start(pick2, {
            label: `[${w.role}] ${args.task.slice(0, 60)}`,
            prompt: [{ type: "text", text: prompt }],
            parent,
            agentOptions: { provider: w.provider, model: w.model },
            signal: exec?.signal
          });
          const result = await run.result;
          const out = (result.output ?? []).map((b) => b?.text ?? "").join("\n").trim() || "\uFF08\u5B50\u4EE3\u7406\u65E0\u6587\u672C\u8F93\u51FA\uFF09";
          memory.add("worker", w.role, out);
          store.pushLog(`\u{1F9E9} ${w.role} \u5B50\u4EE3\u7406\u5B8C\u6210\uFF08${result.stopReason ?? "?"}\uFF09`);
          let verdict = "";
          if (args.verify !== false && config.verifySubagents) {
            try {
              const v = await runVerifier(out);
              verdict = v.pass ? "\n\n[\u9A8C\u8BC1] \u2705 \u901A\u8FC7" : `

[\u9A8C\u8BC1] \u26A0\uFE0F ${v.issues.length} \u4E2A\u95EE\u9898
${v.issues.map((i) => `  \xB7 [${i.severity}] ${i.where}\uFF1A${i.what}`).join("\n")}${v.revised ? `
\u4FEE\u6B63\u7248\uFF1A
${v.revised}` : ""}`;
            } catch (err) {
              verdict = `

[\u9A8C\u8BC1] \u6267\u884C\u5931\u8D25\uFF1A${err.message}`;
            }
          }
          return `\u{1F9E9} \u771F\u5B9E\u5B50\u4EE3\u7406\u5B8C\u6210 \xB7 ${w.role} \xB7 ${w.provider}/${w.model} \xB7 stopReason=${result.stopReason ?? "?"}\uFF08\u7528\u91CF\u8BA1\u5165 dsh \u7528\u91CF\u7EDF\u8BA1\uFF09${budgetWarn ? "\n" + budgetWarn : ""}

${out}${verdict}`;
        } finally {
          store.setRunning(false);
        }
      }
    }),
    defineTool({
      name: "team_verify",
      description: "\u7528\u5F53\u524D\u6A21\u5F0F\u7684\u9A8C\u8BC1\u6A21\u578B\u72EC\u7ACB\u5BA1\u67E5\u5185\u5BB9\uFF0C\u8FD4\u56DE\u7ED3\u6784\u5316\u7ED3\u8BBA\uFF08pass/issues/revised\uFF09",
      parameters: params({
        content: { type: "string", required: true, description: "\u5F85\u5BA1\u67E5\u5185\u5BB9" },
        criteria: { type: "string", description: "\u53EF\u9009\u9A8C\u6536\u6807\u51C6" }
      }),
      output: textOutput,
      execute: async (args) => {
        guard();
        store.setRunning(true, "\u9A8C\u8BC1");
        try {
          const v = await runVerifier(args.content, args.criteria);
          const head = v.pass ? "\u2705 \u9A8C\u8BC1\u901A\u8FC7" : `\u26A0\uFE0F \u53D1\u73B0 ${v.issues.length} \u4E2A\u95EE\u9898`;
          const issues = v.issues.map((i) => `  \xB7 [${i.severity}] ${i.where}\uFF1A${i.what}`).join("\n");
          return `${head}${usageLine()}
${issues}
${v.revised ? `
\u4FEE\u6B63\u7248\uFF1A
${v.revised}` : ""}`;
        } finally {
          store.setRunning(false);
        }
      }
    }),
    defineTool({
      name: "team_status",
      description: "\u67E5\u770B\u5F53\u524D\u7F16\u961F\u3001\u5404\u89D2\u8272\u6A21\u578B\u4E0E\u8FD0\u884C\u72B6\u6001",
      parameters: params({}),
      output: textOutput,
      execute: async () => {
        const m = modes.active;
        const s = store.get();
        return [
          `\u5F53\u524D\u6A21\u5F0F\uFF1A${m.name}\uFF08${m.id}\uFF09\uFF5C\u72B6\u6001\uFF1A${s.running ? s.activity : "\u7A7A\u95F2"}`,
          `\u4E3B\u63A7\uFF1A${m.lead.provider}/${m.lead.model}${m.leadSource === "session" ? "\uFF08leadSource=session\uFF1A\u5B9E\u9645\u4E3B\u63A7=\u4F1A\u8BDD\u5F53\u524D\u6A21\u578B\uFF0C\u6B64\u4E3A\u5EFA\u8BAE\u503C\uFF09" : ""}`,
          ...m.workers.map((w) => `\u6267\u884C\uFF5C${w.role}\uFF1A${w.provider}/${w.model}${w.note ? "\uFF5C" + w.note : ""}`),
          `\u9A8C\u8BC1\uFF1A${m.verifier.provider}/${m.verifier.model}`,
          `\u56E2\u961F\u8BB0\u5FC6\uFF1A${memory.size} \u6761`
        ].join("\n");
      }
    }),
    defineTool({
      name: "team_usage",
      description: "\u67E5\u770B\u5404\u89D2\u8272/\u5404\u6A21\u578B\u7684 API \u8C03\u7528\u4E0E\u82B1\u8D39\uFF08\u4ECA\u5929/\u672C\u6708/\u5168\u90E8\uFF09",
      parameters: params({ period: { type: "string", description: "today | month | all\uFF0C\u9ED8\u8BA4 today" } }),
      output: textOutput,
      execute: async (args) => {
        const map = { today: 24 * 3600 * 1e3, month: 30 * 24 * 3600 * 1e3, all: void 0 };
        return ledger.reportText(map[args.period ?? "today"] ?? 24 * 3600 * 1e3);
      }
    }),
    defineTool({
      name: "team_auto",
      description: "\u4E00\u5957\u5F0F\u81EA\u52A8\u6D41\u6C34\u7EBF\uFF1A\u4E3B\u63A7\u62C6\u89E3\u6D3E\u53D1 \u2192 \u5404\u6267\u884C\u89D2\u8272\u5E76\u884C\u6267\u884C \u2192 \u9A8C\u8BC1\u5458\u5BA1\u67E5\uFF08\u4E0D\u5408\u683C\u81EA\u52A8\u8FD4\u4FEE\u4E00\u8F6E\uFF09\u2192 \u6C47\u603B\u4EA4\u4ED8\u3002\u53EA\u9700\u7ED9\u51FA\u4EFB\u52A1\u5373\u53EF",
      parameters: params({
        task: { type: "string", required: true, description: "\u5B8C\u6574\u4EFB\u52A1\u63CF\u8FF0" },
        criteria: { type: "string", description: "\u53EF\u9009\u9A8C\u6536\u6807\u51C6" },
        planJson: { type: "string", description: '\u53EF\u9009\uFF1A\u4E3B\u63A7\u5DF2\u60F3\u597D\u7684\u8BA1\u5212 [{"worker":"\u89D2\u8272\u540D","task":"\u5B50\u4EFB\u52A1"}]\uFF0C\u7701\u53BB\u89C4\u5212\u8C03\u7528' }
      }),
      output: textOutput,
      execute: async (args) => {
        const budgetWarn = guard();
        const mode = modes.active;
        store.setRunning(true, args.task);
        memory.clear();
        memory.add("task", "lead", args.task);
        const costBefore = ledger.today().total.costUsd;
        try {
          const plan = args.planJson ? Gateway.parseJson(args.planJson) : await planWithLead(args.task);
          store.pushLog(`\u{1F4CB} \u8BA1\u5212\uFF1A${plan.subtasks.length} \u4E2A\u5B50\u4EFB\u52A1`);
          const dispatch = async (subtasks) => {
            const jobs = subtasks.map((st) => {
              const w = mode.workers.find((x) => x.role === st.worker) ?? mode.workers.find((x) => x.note?.includes("\u901A\u7528")) ?? mode.workers[0];
              if (!w) throw new Error("\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u6267\u884C\u89D2\u8272");
              return { w, st };
            });
            store.setActivity(`\u5E76\u884C\u6267\u884C ${jobs.length} \u4E2A\u5B50\u4EFB\u52A1`);
            return Promise.all(jobs.map(({ w, st }) => runWorker(w, st.task).catch((e) => `\u274C ${w.role} \u5931\u8D25\uFF1A${e.message}`)));
          };
          let outputs = await dispatch(plan.subtasks);
          let collected = plan.subtasks.map((st, i) => `## [${st.worker}] ${st.task}
${outputs[i]}`).join("\n\n");
          let verdict = await runVerifier(collected, args.criteria);
          if (!verdict.pass) {
            store.pushLog("\u{1F501} \u9A8C\u8BC1\u672A\u901A\u8FC7\uFF0C\u81EA\u52A8\u8FD4\u4FEE\u4E00\u8F6E");
            const failedIdx = verdict.issues.map((i) => i.where).join("\uFF1B");
            const reTasks = plan.subtasks.map((st) => ({
              worker: st.worker,
              task: `${st.task}

\uFF08\u8FD4\u4FEE\u8981\u6C42\uFF1A\u9A8C\u8BC1\u5458\u6307\u51FA\u7684\u95EE\u9898\u2014\u2014${failedIdx}\u3002\u8BF7\u9488\u5BF9\u6027\u4FEE\u6B63\u3002\uFF09`
            }));
            const reOut = await dispatch(reTasks);
            collected = plan.subtasks.map((st, i) => `## [${st.worker}] ${st.task}
${reOut[i]}`).join("\n\n");
            verdict = await runVerifier(collected, args.criteria);
          }
          const finalText = mode.leadSource === "mode" ? await assembleWithLead(args.task, collected) : `${collected}

\uFF08\u9A8C\u8BC1\u7ED3\u8BBA\uFF1A${verdict.pass ? "\u901A\u8FC7" : "\u4ECD\u6709\u95EE\u9898\uFF0C\u89C1 issues"}${verdict.revised ? "\uFF0C\u5DF2\u9644\u4FEE\u6B63\u7248" : ""}\uFF09`;
          const delta = Math.round((ledger.today().total.costUsd - costBefore) * 1e4) / 1e4;
          store.pushLog("\u{1F3C1} \u6D41\u6C34\u7EBF\u5B8C\u6210");
          return `${budgetWarn ?? ""}\u2705 \u7F16\u961F\u6D41\u6C34\u7EBF\u5B8C\u6210${usageLine()}\uFF08\u672C\u6B21 $${delta}\uFF09

${finalText}`;
        } finally {
          store.setRunning(false);
        }
      }
    })
  ];
  for (const t of tools) ctx.tools.register(t);
}
function cheapest(mode) {
  return mode.workers.reduce((a, b) => a.model < b.model ? a : b, mode.workers[0] ?? mode.lead);
}
async function verifyWithMode(deps, content, criteria) {
  const { modes, gateway, memory, store } = deps;
  const v = modes.active.verifier;
  store.setActivity(`\u9A8C\u8BC1\u4E2D\uFF1A${v.provider}/${v.model}`);
  const messages = [
    {
      role: "system",
      content: '\u4F60\u662F\u56E2\u961F\u7684\u72EC\u7ACB\u9A8C\u8BC1\u5458\uFF08\u4E0D\u53C2\u4E0E\u4EA7\u51FA\uFF09\uFF0C\u8D1F\u8D23\u5BA1\u67E5\u6267\u884C\u6210\u5458\u7684\u6210\u679C\u3002\u8F93\u51FA JSON\uFF1A{"pass": boolean, "issues": [{"where": string, "what": string, "severity": "low"|"high"}], "revised": string|null}\u3002issues \u4E3A\u7A7A\u6570\u7EC4\u8868\u793A\u901A\u8FC7\uFF1B\u8F7B\u5FAE\u95EE\u9898\u53EF\u81EA\u884C\u5728 revised \u4E2D\u7ED9\u51FA\u4FEE\u6B63\u7248\u672C\uFF1B\u4E25\u91CD\u95EE\u9898 pass=false \u5E76\u6307\u660E\u4F4D\u7F6E\u3002'
    },
    {
      role: "user",
      content: [
        criteria ? `# \u9A8C\u6536\u6807\u51C6
${criteria}` : "# \u9A8C\u6536\u6807\u51C6\n\u4E0E\u4EFB\u52A1\u8981\u6C42\u4E00\u81F4\u3001\u65E0\u4E8B\u5B9E\u77DB\u76FE\u3001\u65E0\u7F3A\u6F0F\u3001\u53EF\u76F4\u63A5\u4EA4\u4ED8",
        `# \u5F85\u5BA1\u5185\u5BB9
${content}`
      ].filter(Boolean).join("\n\n")
    }
  ];
  const r = await gateway.call({ role: "verifier", kind: "verify", target: v, messages, json: true, temperature: 0.2 });
  memory.add("verifier", "verifier", r.text);
  return Gateway.parseJson(r.text);
}
function formatVerdict(v) {
  if (v.pass) return "\u2705 \u901A\u8FC7";
  const issues = v.issues.map((i) => `[${i.severity}] ${i.where}\uFF1A${i.what}`).join("\uFF1B");
  return `\u26A0\uFE0F ${v.issues.length} \u4E2A\u95EE\u9898\uFF1A${issues}${v.revised ? "\uFF08\u5DF2\u9644\u4FEE\u6B63\u7248\uFF09" : ""}`;
}

// src/memory.ts
var TeamMemory = class {
  constructor(opts, summarizer) {
    this.opts = opts;
    this.summarizer = summarizer;
  }
  entries = [];
  summary = "";
  add(kind, role2, content) {
    this.entries.push({ ts: Date.now(), kind, role: role2, content });
  }
  async digest() {
    const total = this.entries.reduce((s, e) => s + e.content.length, 0);
    if (total > this.opts.summarizeOverChars && this.summarizer) {
      await this.compress();
    }
    const parts = [];
    if (this.summary) parts.push(`[\u5148\u524D\u6458\u8981]
${this.summary}`);
    let budget = this.opts.digestMaxChars - (this.summary?.length ?? 0);
    const recent = [];
    for (let i = this.entries.length - 1; i >= 0 && budget > 200; i--) {
      const e = this.entries[i];
      const piece = e.content.length > budget ? e.content.slice(0, budget) + "\u2026(\u622A\u65AD)" : e.content;
      recent.unshift(`[${e.kind}/${e.role}] ${piece}`);
      budget -= piece.length + 20;
    }
    parts.push(recent.join("\n\n"));
    return parts.join("\n\n");
  }
  async compress() {
    if (!this.summarizer) return;
    const keepFrom = Math.floor(this.entries.length / 2);
    const old = this.entries.slice(0, keepFrom);
    if (!old.length) return;
    const prompt = old.map((e) => `[${e.kind}/${e.role}] ${e.content}`).join("\n\n");
    try {
      this.summary = await this.summarizer(
        `\u8BF7\u628A\u4EE5\u4E0B\u591A\u667A\u80FD\u4F53\u534F\u4F5C\u8BB0\u5F55\u538B\u7F29\u6210\u8981\u70B9\u6458\u8981\uFF08\u4FDD\u7559\u4EFB\u52A1\u76EE\u6807\u3001\u5DF2\u786E\u5B9A\u7684\u4E8B\u5B9E\u3001\u5404\u89D2\u8272\u4EA7\u51FA\u4F4D\u7F6E\u3001\u672A\u51B3\u95EE\u9898\uFF09\uFF0C\u4E0D\u8D85\u8FC7 800 \u5B57\uFF1A

${prompt.slice(0, 2e4)}`
      );
      this.entries = this.entries.slice(keepFrom);
    } catch {
    }
  }
  snapshot() {
    return { summary: this.summary, entries: [...this.entries] };
  }
  clear() {
    this.entries = [];
    this.summary = "";
  }
  get size() {
    return this.entries.length;
  }
};
function makeSummarizer(gateway, pickTarget) {
  return async (prompt) => {
    const messages = [
      { role: "system", content: "\u4F60\u662F\u591A\u667A\u80FD\u4F53\u56E2\u961F\u7684\u8BB0\u5F55\u5458\uFF0C\u8D1F\u8D23\u538B\u7F29\u4E0A\u4E0B\u6587\u3002\u53EA\u8F93\u51FA\u6458\u8981\u672C\u8EAB\u3002" },
      { role: "user", content: prompt }
    ];
    const r = await gateway.call({ role: "memory", kind: "summarize", target: pickTarget(), messages, maxTokens: 1200 });
    return r.text;
  };
}

// src/modes.ts
var MOCK_MODE = {
  id: "mock-test",
  name: "\u6A21\u62DF\u81EA\u6D4B\u6A21\u5F0F\uFF08\u96F6 API\uFF09",
  description: "\u5168\u90E8\u89D2\u8272\u4F7F\u7528\u5185\u7F6E mock \u9002\u914D\u5668\uFF0C\u65E0\u9700\u4EFB\u4F55 API Key \u5373\u53EF\u8DD1\u901A\u6574\u6761\u6D41\u6C34\u7EBF",
  lead: { provider: "mock", model: "mock-smart" },
  leadSource: "mode",
  workers: [
    { role: "\u901A\u7528\u6267\u884C", provider: "mock", model: "mock-fast", note: "\u6A21\u62DF\u6267\u884C" },
    { role: "\u5EC9\u4EF7\u6279\u91CF", provider: "mock", model: "mock-fast", note: "\u6A21\u62DF\u6267\u884C" }
  ],
  verifier: { provider: "mock", model: "mock-smart" },
  memory: { shared: true, digestMaxChars: 6e3 },
  budget: { monthlyCapUsd: 0, onExceed: "warn" },
  enforceSubagents: true
};
var PLACEHOLDER_ID = "custom";
function placeholderMode() {
  return {
    id: PLACEHOLDER_ID,
    name: "\u6211\u7684\u7F16\u961F",
    description: "\u9996\u6B21\u4F7F\u7528\u81EA\u52A8\u751F\u6210\uFF0C\u5C55\u5F00\u9762\u677F\u6311\u9009\u6A21\u578B\u540E\u4FDD\u5B58\u5373\u53EF",
    lead: { provider: "deepseek", model: "deepseek-chat" },
    leadSource: "session",
    workers: [{ role: "\u901A\u7528\u6267\u884C", provider: "deepseek", model: "deepseek-chat", note: "\u901A\u7528\u5B50\u4EFB\u52A1" }],
    verifier: { provider: "deepseek", model: "deepseek-chat" },
    memory: { shared: true, digestMaxChars: 6e3 },
    budget: { monthlyCapUsd: 0, onExceed: "warn" },
    enforceSubagents: true
  };
}
var slug = (name2) => name2.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "mode";
var ModeRegistry = class {
  constructor(config, persist, saved) {
    this.config = config;
    this.persist = persist;
    if (saved?.savedModes?.length) {
      for (const m of saved.savedModes) this.entries.set(m.id, { mode: structuredClone(m), origin: "saved" });
    }
    if (this.config.mock?.enabled) this.entries.set(MOCK_MODE.id, { mode: structuredClone(MOCK_MODE), origin: "mock" });
    for (const m of this.config.modes ?? []) {
      if (!this.entries.has(m.id)) this.entries.set(m.id, { mode: structuredClone(m), origin: "config" });
    }
    if (this.entries.size === 0) this.entries.set(PLACEHOLDER_ID, { mode: placeholderMode(), origin: "placeholder" });
    this.activeId = saved?.activeModeId && this.entries.has(saved.activeModeId) ? saved.activeModeId : this.entries.keys().next().value;
  }
  entries = /* @__PURE__ */ new Map();
  activeId = "";
  /** dsh 模型目录就绪后，把占位编队的角色替换成用户真实配置的模型（仅一次） */
  bootstrapFromCatalog(providers) {
    const entry = this.entries.get(this.activeId);
    if (!entry || entry.origin !== "placeholder") return null;
    const flat = providers.flatMap((p) => p.models.map((m) => ({ provider: p.id, model: m.id, name: m.name })));
    if (!flat.length) return null;
    const pick2 = (want, avoid) => flat.find((m) => want.test(m.provider + "/" + m.model) && m.model !== avoid)?.model ?? flat.find((m) => m.model !== avoid)?.model ?? flat[0].model;
    const lead = flat.find((m) => /pro|smart|flash/i.test(m.model)) ?? flat[0];
    const leadModel = pick2(/pro|smart|flash/i, "");
    const workModel = pick2(/flash|mini|lite|fast/i, leadModel);
    const verifyModel = pick2(/pro|smart/i, workModel);
    entry.mode = {
      ...entry.mode,
      lead: { provider: lead.provider, model: leadModel },
      workers: [{ role: "\u901A\u7528\u6267\u884C", provider: lead.provider, model: workModel, note: "\u901A\u7528\u5B50\u4EFB\u52A1" }],
      verifier: { provider: lead.provider, model: verifyModel }
    };
    entry.origin = "saved";
    this.persistSaved();
    return entry.mode;
  }
  /** 占位编队待引导 */
  needsBootstrap() {
    return this.entries.get(this.activeId)?.origin === "placeholder";
  }
  list() {
    return [...this.entries.values()].map((x) => x.mode);
  }
  get active() {
    return (this.entries.get(this.activeId) ?? this.entries.values().next().value).mode;
  }
  switch(id) {
    if (!this.entries.has(id)) throw new Error(`\u6A21\u5F0F "${id}" \u4E0D\u5B58\u5728\u3002\u53EF\u7528\uFF1A${[...this.entries.keys()].join(", ")}`);
    this.activeId = id;
    this.persistSaved();
    return this.active;
  }
  /** 把当前激活模式的某角色改成指定模型（直接保存在该模式里） */
  setRole(role2, provider, model) {
    const mode = this.active;
    const target = role2 === "lead" ? mode.lead : role2 === "verifier" ? mode.verifier : mode.workers.find((w) => w.role === role2);
    if (!target) throw new Error(`\u89D2\u8272 "${role2}" \u4E0D\u5B58\u5728\u3002\u53EF\u7528\uFF1Alead, verifier, ${mode.workers.map((w) => w.role).join(", ")}`);
    target.provider = provider;
    target.model = model;
    this.markSaved();
    this.persistSaved();
    return mode;
  }
  /** 保存当前编队为新模式（或覆盖指定 id 的模式），并切换过去 */
  saveMode(input) {
    const current = this.active;
    const id = input.id || (this.entries.has(slug(input.name)) && this.entries.get(slug(input.name)).mode.name === input.name ? slug(input.name) : this.uniqueSlug(input.name));
    const mode = {
      ...structuredClone(current),
      id,
      name: input.name || current.name
    };
    this.entries.set(id, { mode, origin: "saved" });
    this.activeId = id;
    this.persistSaved();
    return mode;
  }
  removeMode(id) {
    if (this.entries.size <= 1) throw new Error("\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u6A21\u5F0F");
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`\u6A21\u5F0F "${id}" \u4E0D\u5B58\u5728`);
    this.entries.delete(id);
    if (this.activeId === id) this.activeId = this.entries.keys().next().value;
    this.persistSaved();
  }
  markSaved() {
    const e = this.entries.get(this.activeId);
    if (e && e.origin === "placeholder") e.origin = "saved";
  }
  uniqueSlug(name2) {
    const base = slug(name2);
    let id = base;
    let i = 2;
    while (this.entries.has(id)) id = `${base}-${i++}`;
    return id;
  }
  persistSaved() {
    const savedModes = [...this.entries.values()].filter((x) => x.origin === "saved").map((x) => x.mode);
    this.persist({ activeModeId: this.activeId, savedModes });
  }
  roles() {
    const mode = this.active;
    return [
      { role: "lead", provider: mode.lead.provider, model: mode.lead.model, kind: "lead" },
      ...mode.workers.map((w) => ({ role: w.role, provider: w.provider, model: w.model, kind: "worker" })),
      { role: "verifier", provider: mode.verifier.provider, model: mode.verifier.model, kind: "verifier" }
    ];
  }
};

// src/server.ts
import { createServer } from "node:http";
var DashboardServer = class {
  constructor(deps) {
    this.deps = deps;
  }
  server = null;
  start() {
    const preferred = this.deps.config.ui.dashboardPort;
    const ports = [preferred, ...Array.from({ length: 10 }, (_, i) => preferred + 1 + i)];
    return (async () => {
      for (const port of ports) {
        const r = await this.tryListen(port);
        if (r !== "busy") {
          this.reused = r === "reused";
          return port;
        }
      }
      throw new Error(`\u770B\u677F\u7AEF\u53E3\u5206\u914D\u5931\u8D25\uFF08${ports[0]}-${ports[ports.length - 1]} \u5168\u90E8\u4E0D\u53EF\u7528\uFF09`);
    })();
  }
  /** start() 返回的端口是否复用了别的进程里的 agent-modes 看板 */
  isReused() {
    return this.reused;
  }
  reused = false;
  tryListen(port) {
    return new Promise((resolve2) => {
      const s = createServer((req, res) => {
        void this.route(req, res);
      });
      s.on("error", async (err) => {
        if (err.code !== "EADDRINUSE") return resolve2("busy");
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/status`);
          const j = await r.json();
          resolve2(typeof j.activeModeId === "string" ? "reused" : "busy");
        } catch {
          resolve2("busy");
        }
      });
      s.listen(port, "127.0.0.1", () => {
        this.server = s;
        resolve2("listening");
      });
    });
  }
  stop() {
    if (!this.server) return;
    this.server.close();
    this.server.closeAllConnections();
    this.server = null;
  }
  async route(req, res) {
    const url = (req.url ?? "/").split("?")[0];
    try {
      if (req.method === "GET" && (url === "/" || url === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(dashboardHtml());
        return;
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (url === "/api/mode/switch") {
          this.deps.onSwitch(String(body.id));
        } else if (url === "/api/mode/save") {
          this.deps.onSaveMode(String(body.name || "\u672A\u547D\u540D\u6A21\u5F0F"), body.id ? String(body.id) : void 0);
        } else if (url === "/api/mode/remove") {
          this.deps.onRemoveMode(String(body.id));
        } else if (url === "/api/role") {
          this.deps.onSetRole(String(body.role), String(body.provider), String(body.model));
        } else {
          throw new Error(`\u672A\u77E5\u63A5\u53E3 ${url}`);
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...cors() });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...cors() });
      switch (url) {
        case "/api/status": {
          const b = this.deps.ledger.budgetStatus();
          const m = this.deps.ledger.month();
          res.end(JSON.stringify({
            ...this.deps.store.get(),
            today: this.deps.ledger.today(),
            monthTok: { promptTokens: m.promptTokens, completionTokens: m.completionTokens, calls: m.calls },
            budget: b,
            log: this.deps.store.logLines()
          }));
          break;
        }
        case "/api/modes":
          res.end(JSON.stringify(this.deps.modes.list().map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            roles: [
              { role: "lead", provider: m.lead.provider, model: m.lead.model },
              ...m.workers.map((w) => ({ role: w.role, provider: w.provider, model: w.model })),
              { role: "verifier", provider: m.verifier.provider, model: m.verifier.model }
            ]
          }))));
          break;
        case "/api/models": {
          try {
            const providers = await this.deps.dsh.listProviderModels();
            res.end(JSON.stringify({ available: providers.length > 0, providers }));
          } catch (err) {
            res.end(JSON.stringify({ available: false, providers: [], error: err.message }));
          }
          break;
        }
        case "/api/sessions":
          res.end(JSON.stringify(this.deps.sessions.list(12)));
          break;
        case "/api/session-feed": {
          const url2 = new URL(req.url ?? "/", "http://x");
          const key = url2.searchParams.get("key") ?? "";
          res.end(JSON.stringify(this.deps.sessions.feed(key, 40)));
          break;
        }
        case "/api/usage":
          res.end(JSON.stringify({ text: this.deps.ledger.reportText(), today: this.deps.ledger.today(), month: this.deps.ledger.budgetStatus() }));
          break;
        default:
          throw new Error(`\u672A\u77E5\u63A5\u53E3 ${url}`);
      }
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", ...cors() });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
};
var cors = () => ({ "Access-Control-Allow-Origin": "*" });
function readBody(req) {
  return new Promise((resolve2, reject) => {
    let data = "";
    req.on("data", (c) => data += c);
    req.on("end", () => {
      try {
        resolve2(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}
function dashboardHtml() {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>\u667A\u80FD\u4F53\u7F16\u961F \xB7 Agent Modes</title>
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif; background:#111418; color:#d7dde3; margin:0; padding:24px; }
  .bar { display:flex; align-items:center; gap:12px; background:#1a1f26; border:1px solid #2a313b; border-radius:12px; padding:10px 16px; cursor:pointer; user-select:none; }
  .bar:hover { border-color:#3fa66a; }
  .dot { width:10px; height:10px; border-radius:50%; background:#3fa66a; }
  .dot.busy { background:#e0a63f; animation:pulse 1s infinite; }
  @keyframes pulse { 50% { opacity:.4; } }
  .panel { display:none; margin-top:12px; background:#161b21; border:1px solid #2a313b; border-radius:12px; padding:16px 20px; }
  h2 { font-size:13px; color:#8b949e; margin:18px 0 8px; font-weight:600; }
  table { width:100%; border-collapse:collapse; }
  td, th { padding:6px 8px; border-bottom:1px solid #232a33; text-align:left; }
  select, input { background:#1e242c; color:#d7dde3; border:1px solid #2a313b; border-radius:6px; padding:3px 6px; }
  .tag { font-size:12px; padding:1px 8px; border-radius:10px; background:#23303a; color:#7ec9a0; }
  .meter { height:6px; background:#232a33; border-radius:3px; overflow:hidden; }
  .meter i { display:block; height:100%; background:#3fa66a; }
  #log { font-family:ui-monospace,monospace; font-size:12px; color:#9aa4af; white-space:pre-wrap; }
  button { background:#24483a; color:#9fe0bb; border:none; border-radius:6px; padding:4px 12px; cursor:pointer; }
</style></head><body>
<div class="bar" id="bar"><span class="dot" id="dot"></span><b id="mode">\u2014</b><span id="act" style="color:#8b949e">\u2026</span>
  <span style="margin-left:auto" class="tag" id="cost">$0.00</span><span class="tag" id="calls">0 \u6B21</span></div>
<div class="panel" id="panel">
  <h2>\u7F16\u961F\u89D2\u8272\uFF08\u70B9\u51FB\u5207\u6362\u6A21\u578B\uFF0C\u7ACB\u5373\u751F\u6548\uFF09</h2><table id="roles"></table>
  <h2>\u6A21\u5F0F</h2><div id="modes"></div>
  <h2>\u672C\u6708\u9884\u7B97</h2><div class="meter"><i id="bud" style="width:0"></i></div><span id="budtext"></span>
  <h2>\u4ECA\u65E5\u7528\u91CF\uFF08\u6309\u89D2\u8272\uFF09</h2><table id="usage"></table>
  <h2>\u52A8\u6001</h2><div id="log">\u2014</div>
</div>
<script>
const $ = id => document.getElementById(id)
const fmtK = n => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0))
const api = p => fetch(p).then(r => r.json())
$('bar').onclick = () => { const p = $('panel'); p.style.display = p.style.display === 'block' ? 'none' : 'block' }
async function refresh() {
  try {
    const s = await api('/api/status')
    $('mode').textContent = '\u7F16\u961F\uFF1A' + (s.activeModeId || '\u2014')
    $('act').textContent = s.running ? s.activity : '\u7A7A\u95F2'
    $('dot').className = 'dot' + (s.running ? ' busy' : '')
    $('cost').textContent = '\u2191' + fmtK(s.today?.total?.promptTokens ?? 0) + ' \u2193' + fmtK(s.today?.total?.completionTokens ?? 0)
    $('calls').textContent = (s.today?.total?.calls ?? 0) + ' \u6B21'
    $('roles').innerHTML = (s.roles || []).map((r, i) =>
      '<tr><td>' + (r.kind === 'lead' ? '\u{1F9E0} \u4E3B\u63A7' : r.kind === 'verifier' ? '\u{1F50D} \u9A8C\u8BC1' : '\u2699\uFE0F \u6267\u884C') + '</td><td><b>' + r.role + '</b></td>' +
      '<td><input id="p' + i + '" value="' + r.provider + '" size="9"></td>' +
      '<td><input id="m' + i + '" value="' + r.model + '" size="22"></td>' +
      '<td><button onclick="setRole(' + i + ')">\u5E94\u7528</button></td></tr>').join('')
    window._roles = s.roles
    const ms = await api('/api/modes')
    $('modes').innerHTML = ms.map(m => '<button style="margin:2px' + (m.id === s.activeModeId ? ';background:#3fa66a;color:#0d1117' : '') +
      '" onclick="switchMode(\\'' + m.id + '\\')">' + m.name + '</button>').join(' ')
    const b = s.budget || {}
    $('bud').style.width = Math.round((b.ratio || 0) * 100) + '%'
    $('budtext').textContent = '\u672C\u6708 \u2191' + fmtK(s.monthTok?.promptTokens ?? 0) + ' \u2193' + fmtK(s.monthTok?.completionTokens ?? 0) + ' tokens \xB7 ' + (s.monthTok?.calls ?? 0) + ' \u6B21\u8C03\u7528'
    $('usage').innerHTML = Object.entries(s.today?.byRole || {}).map(([k, v]) =>
      '<tr><td>' + k + '</td><td>' + v.calls + ' \u6B21</td><td>\u2191' + fmtK(v.promptTokens) + ' \u2193' + fmtK(v.completionTokens) + '</td></tr>').join('') || '<tr><td>\u6682\u65E0</td></tr>'
    $('log').textContent = (s.log || []).map(l => new Date(l.ts).toLocaleTimeString() + '  ' + l.text).join('\\n') || '\u2014'
  } catch (e) { $('act').textContent = '\u770B\u677F\u670D\u52A1\u672A\u54CD\u5E94\uFF1A' + e.message }
}
async function setRole(i) {
  const r = window._roles[i]
  await fetch('/api/role', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: r.role, provider: $('p' + i).value, model: $('m' + i).value }) })
  refresh()
}
async function switchMode(id) {
  await fetch('/api/mode/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
  refresh()
}
refresh(); setInterval(refresh, 3000)
</script></body></html>`;
}

// src/sessions.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";
var FRAME_MAGIC = [40, 181, 47, 253];
var AUTO_INJECT_PREFIXES = ["<system-reminder>", "Current runtime context", "A skill is a reusable"];
var home = () => process.env.DSH_HOME || join(homedir(), ".dsh");
var cut = (s, n) => s.length > n ? s.slice(0, n) + "\u2026" : s;
function decodeFile(file) {
  const buf = readFileSync(file);
  const offsets = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === FRAME_MAGIC[0] && buf[i + 1] === FRAME_MAGIC[1] && buf[i + 2] === FRAME_MAGIC[2] && buf[i + 3] === FRAME_MAGIC[3]) offsets.push(i);
  }
  offsets.push(buf.length);
  let text = "";
  for (let f = 0; f < offsets.length - 1; f++) {
    try {
      text += zstdDecompressSync(buf.subarray(offsets[f], offsets[f + 1])).toString("utf8");
      if (!text.endsWith("\n")) text += "\n";
    } catch {
    }
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      out.push({ ts: o.time ?? 0, type: o.type ?? "", data: typeof o.data === "string" ? JSON.parse(o.data) : o.data ?? {} });
    } catch {
    }
  }
  return out;
}
var blocksText = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => typeof b === "string" ? b : b?.type === "text" ? b.text : "").filter(Boolean).join("\n").trim();
};
var isAutoInject = (t) => AUTO_INJECT_PREFIXES.some((p) => t.startsWith(p));
var SessionReader = class {
  cache = /* @__PURE__ */ new Map();
  sessionsRoot() {
    const root = join(home(), "sessions");
    return existsSync(root) ? root : null;
  }
  /** 列出最近更新的会话（按文件 mtime 倒序） */
  list(limit = 12) {
    const root = this.sessionsRoot();
    if (!root) return [];
    const candidates = [];
    for (const ws of readdirSync(root)) {
      const wsDir = join(root, ws);
      let sessionDirs;
      try {
        sessionDirs = readdirSync(wsDir);
      } catch {
        continue;
      }
      for (const sid of sessionDirs) {
        if (!sid.startsWith("session-")) continue;
        const file = join(wsDir, sid, "session.v4.jsonl.zstd");
        if (!existsSync(file)) continue;
        try {
          const st = statSync(file);
          candidates.push({ key: ws + "/" + sid, file, mtime: st.mtimeMs });
        } catch {
        }
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    const out = [];
    for (const c of candidates.slice(0, limit)) {
      try {
        const events = this.events(c.file);
        let title = "";
        let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        let preview = "";
        let updatedAt = 0;
        const models = [];
        for (const ev of events) {
          updatedAt = Math.max(updatedAt, ev.ts);
          if (ev.type === "request/context") {
            const route = (ev.data?.provider ?? "") + "/" + (ev.data?.model ?? "");
            if (route !== "/" && !models.includes(route)) models.push(route);
          } else if (ev.type === "session/title") {
            const t = String(ev.data?.title ?? "");
            if (t && t !== "Session title generator") title = title || t;
          } else if (ev.type === "assistant/message") {
            const u = ev.data?.usage;
            if (u) {
              usage.inputTokens += u.inputTokens ?? 0;
              usage.outputTokens += u.outputTokens ?? 0;
              usage.totalTokens += u.totalTokens ?? 0;
            }
          } else if (ev.type === "user/message" && !preview) {
            const t = blocksText(ev.data?.content);
            if (t && !isAutoInject(t)) preview = cut(t.replace(/\s+/g, " "), 60);
          }
        }
        out.push({
          key: c.key,
          sessionId: c.key.split("/").pop()?.replace("session-", "") ?? "",
          workspace: c.key.split("/")[0].replace(/^-+|-+$/g, "").replace(/~0020/g, " "),
          title: title || preview || c.key.split("/").pop() || "\u672A\u547D\u540D\u4F1A\u8BDD",
          createdAt: events[0]?.ts ?? 0,
          updatedAt,
          usage,
          preview,
          models
        });
      } catch {
      }
    }
    return out;
  }
  /** 跨会话记忆映射：把最近 N 个会话的标题与最后用户输入，压缩成团队记忆可注入的块 */
  recentMemory(n = 2) {
    if (n <= 0) return "";
    const blocks = this.list(Math.max(n, 3)).slice(0, n).map((ss) => {
      const last = ss.preview ? `\u7528\u6237\u6700\u540E\u8BF4\u300C${ss.preview}\u300D` : "\uFF08\u65E0\u7528\u6237\u8F93\u5165\u8BB0\u5F55\uFF09";
      return `- [${ss.title}]\uFF08${ss.workspace}\uFF09${last}`;
    });
    return blocks.length ? blocks.join("\n") : "";
  }
  /** 一个会话的对话/命令动态（按时间序，默认最后 40 条） */
  feed(key, limit = 40) {
    const root = this.sessionsRoot();
    if (!root) return { title: "", entries: [] };
    const [ws, sid] = key.split("/");
    if (!ws || !sid || ws.includes("..") || sid.includes("..")) return { title: "", entries: [] };
    const file = join(root, ws, sid, "session.v4.jsonl.zstd");
    if (!existsSync(file)) return { title: "", entries: [] };
    const events = this.events(file);
    let title = "";
    let lastRoute = "";
    const entries = [];
    const openCalls = /* @__PURE__ */ new Map();
    for (const ev of events) {
      if (ev.type === "request/context") {
        lastRoute = (ev.data?.provider ?? "") + "/" + (ev.data?.model ?? "");
        continue;
      }
      if (ev.type === "session/title") {
        const t = String(ev.data?.title ?? "");
        if (t && t !== "Session title generator") title = title || t;
        continue;
      }
      if (ev.type === "user/message") {
        const t = blocksText(ev.data?.content);
        if (!t || isAutoInject(t)) continue;
        entries.push({ ts: ev.ts, kind: "user", text: cut(t.replace(/\s+/g, " "), 300) });
        continue;
      }
      if (ev.type === "assistant/message") {
        const u = ev.data?.usage;
        const text = blocksText(ev.data?.message?.content) || blocksText(ev.data?.content);
        entries.push({
          ts: ev.ts,
          kind: "assistant",
          text: cut(text || "\uFF08\u672C\u8F6E\u4E3A\u5DE5\u5177\u8C03\u7528\uFF09", 300),
          usage: u ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 } : void 0,
          model: lastRoute || void 0
        });
        continue;
      }
      if (ev.type === "tool/call") {
        openCalls.set(String(ev.data?.callId ?? ""), { name: String(ev.data?.name ?? "?"), args: String(ev.data?.arguments ?? ""), ts: ev.ts });
        continue;
      }
      if (ev.type === "tool/result") {
        const callId = String(ev.data?.message?.toolCallId ?? "");
        const call = openCalls.get(callId) ?? { name: "?", args: "", ts: ev.ts };
        openCalls.delete(callId);
        const isError = !!ev.data?.message?.isError;
        let argText = call.args;
        try {
          const a = JSON.parse(call.args);
          const q = Array.isArray(a.questions) && a.questions[0];
          argText = a.command ?? a.prompt ?? a.question ?? q?.question ?? a.path ?? cut(call.args, 120);
        } catch {
        }
        entries.push({
          ts: ev.ts,
          kind: "tool",
          tool: call.name,
          text: cut(String(argText).replace(/\s+/g, " "), 220),
          error: isError
        });
        continue;
      }
    }
    return { title, entries: entries.slice(-limit) };
  }
  events(file) {
    const st = statSync(file);
    const ck = file + "|" + st.mtimeMs + "|" + st.size;
    const hit = this.cache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.events;
    const events = decodeFile(file);
    this.cache.set(file, { mtime: st.mtimeMs, size: st.size, events });
    if (this.cache.size > 40) {
      for (const k of this.cache.keys()) {
        if (this.cache.size <= 40) break;
        this.cache.delete(k);
      }
    }
    return events;
  }
};

// src/store.ts
var Store = class {
  state;
  log = [];
  constructor(activeModeId, roles) {
    this.state = { activeModeId, running: false, activity: "\u7A7A\u95F2", lastUpdate: Date.now(), roles };
  }
  get() {
    return { ...this.state, lastUpdate: Date.now() };
  }
  logLines() {
    return this.log.slice(-50);
  }
  setRoles(roles) {
    this.state.roles = roles;
    this.touch();
  }
  setActiveMode(id) {
    this.state.activeModeId = id;
    this.touch();
  }
  setRunning(running, task) {
    this.state.running = running;
    this.state.currentTask = task;
    if (!running) this.state.activity = "\u7A7A\u95F2";
    this.touch();
  }
  setActivity(activity) {
    this.state.activity = activity;
    this.touch();
  }
  pushLog(text) {
    this.log.push({ ts: Date.now(), text });
    if (this.log.length > 100) this.log = this.log.slice(-80);
    this.touch();
  }
  touch() {
    this.state.lastUpdate = Date.now();
  }
};

// src/usage.ts
import { mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var DAY = 24 * 3600 * 1e3;
var UsageLedger = class {
  constructor(config, dataDir) {
    this.config = config;
    this.file = join2(dataDir, "usage.json");
    mkdirSync(dataDir, { recursive: true });
    try {
      this.entries = JSON.parse(readFileSync2(this.file, "utf8"));
    } catch {
      this.entries = [];
    }
  }
  entries = [];
  file;
  record(entry) {
    this.entries.push(entry);
    if (this.entries.length > 5e3) this.entries = this.entries.slice(-4e3);
    this.flush();
  }
  flush() {
    try {
      writeFileSync(this.file, JSON.stringify(this.entries));
    } catch {
    }
  }
  monthStart(now = Date.now()) {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  summary(windowMs) {
    const since = windowMs ? Date.now() - windowMs : 0;
    const rows = this.entries.filter((e) => e.ts >= since);
    const total = {
      calls: rows.length,
      promptTokens: rows.reduce((s, e) => s + e.promptTokens, 0),
      completionTokens: rows.reduce((s, e) => s + e.completionTokens, 0),
      costUsd: round4(rows.reduce((s, e) => s + e.costUsd, 0))
    };
    const byRole = {};
    for (const e of rows) {
      byRole[e.role] ??= { calls: 0, costUsd: 0, promptTokens: 0, completionTokens: 0 };
      const r = byRole[e.role];
      r.calls++;
      r.costUsd = round4(r.costUsd + e.costUsd);
      r.promptTokens += e.promptTokens;
      r.completionTokens += e.completionTokens;
    }
    const byModel = {};
    for (const e of rows) {
      const key = `${e.provider}/${e.model}`;
      byModel[key] ??= { calls: 0, costUsd: 0 };
      byModel[key].calls++;
      byModel[key].costUsd = round4(byModel[key].costUsd + e.costUsd);
    }
    return { total, byRole, byModel };
  }
  today() {
    return this.summary(DAY);
  }
  month() {
    const since = this.monthStart();
    const rows = this.entries.filter((e) => e.ts >= since);
    return {
      costUsd: round4(rows.reduce((s, e) => s + e.costUsd, 0)),
      calls: rows.length,
      promptTokens: rows.reduce((s, e) => s + e.promptTokens, 0),
      completionTokens: rows.reduce((s, e) => s + e.completionTokens, 0)
    };
  }
  budgetStatus() {
    const cap = this.config.budget.monthlyCapUsd;
    const m = this.month();
    const exceeded = cap > 0 && m.costUsd >= cap;
    const ratio = cap > 0 ? Math.min(1, m.costUsd / cap) : 0;
    return { cap, ...m, exceeded, ratio };
  }
  /** 预算拦截判断：block 模式下超预算抛错，warn 模式返回提示语 */
  checkBudget() {
    const st = this.budgetStatus();
    if (!st.exceeded) return null;
    const msg = `\u672C\u6708\u5DF2\u6D88\u8D39 $${st.costUsd}\uFF0C\u8FBE\u5230\u9884\u7B97\u4E0A\u9650 $${st.cap}`;
    return this.config.budget.onExceed === "block" ? msg : `${msg}\uFF08warn \u6A21\u5F0F\u7EE7\u7EED\u6267\u884C\uFF09`;
  }
  reportText(windowMs) {
    const s = this.summary(windowMs);
    const scope = windowMs === DAY ? "\u4ECA\u5929" : windowMs ? `\u6700\u8FD1 ${Math.round(windowMs / DAY)} \u5929` : "\u5168\u90E8";
    const lines = [
      `\u7528\u91CF\u62A5\u544A\uFF08${scope}\uFF09\uFF1A\u5171 ${s.total.calls} \u6B21\u8C03\u7528\uFF0C\u5165 ${s.total.promptTokens} / \u51FA ${s.total.completionTokens} tokens`,
      ...Object.entries(s.byRole).map(([role2, r]) => `  \xB7 ${role2}\uFF1A${r.calls} \u6B21\uFF0C\u5165 ${r.promptTokens} / \u51FA ${r.completionTokens}`),
      ...Object.entries(s.byModel).map(([m2, r]) => `  \xB7 ${m2}\uFF1A${r.calls} \u6B21`)
    ];
    const m = this.month();
    lines.push(`\u672C\u6708\uFF1A${m.calls} \u6B21\u8C03\u7528\uFF0C\u5165 ${m.promptTokens} / \u51FA ${m.completionTokens} tokens`);
    return lines.join("\n");
  }
};
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

// src/index.ts
var name = "dsh-agent-modes";
var inject = ["tools"];
function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const dataDir = join3(process.cwd(), ".dsh-agent-modes");
  mkdirSync2(dataDir, { recursive: true });
  const persistFile = join3(dataDir, "state.json");
  const loadPersist = () => {
    try {
      return JSON.parse(readFileSync3(persistFile, "utf8"));
    } catch {
      return void 0;
    }
  };
  const persist = (d) => {
    try {
      writeFileSync2(persistFile, JSON.stringify(d));
    } catch {
    }
  };
  const modes = new ModeRegistry(config, persist, loadPersist());
  const ledger = new UsageLedger(config, dataDir);
  const dsh = new DshLlm(ctx);
  if (config.mock.enabled) registerMockAdapter(ctx);
  const gateway = new Gateway(config, (r) => ledger.record({
    ts: Date.now(),
    role: r.role,
    provider: r.provider,
    model: r.model,
    promptTokens: r.usage.prompt_tokens,
    completionTokens: r.usage.completion_tokens,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    kind: "api"
  }), dsh);
  const memory = new TeamMemory(
    { digestMaxChars: config.memory.digestMaxChars, summarizeOverChars: config.memory.summarizeOverChars },
    makeSummarizer(gateway, () => cheapest(modes.active))
  );
  const store = new Store(modes.active.id, modes.roles());
  const sessions = new SessionReader();
  registerTools(ctx, { modes, gateway, ledger, memory, store, config, recentMemory: (n) => sessions.recentMemory(n) });
  if (modes.needsBootstrap()) {
    void dsh.listProviderModels().then((providers) => {
      if (providers.length && modes.bootstrapFromCatalog(providers)) {
        store.setRoles(modes.roles());
        ctx.logger?.info?.("[agent-modes] \u5DF2\u6309 dsh \u6A21\u578B\u76EE\u5F55\u751F\u6210\u521D\u59CB\u7F16\u961F\uFF0C\u5C55\u5F00\u9762\u677F\u53EF\u8C03\u6574\u5E76\u4FDD\u5B58\u4E3A\u4F60\u7684\u6A21\u5F0F");
      }
    }).catch(() => {
    });
  }
  if (config.verifySubagents) {
    new SubagentEnforcer(ctx, {
      getMode: () => modes.active,
      log: (text) => store.pushLog(text),
      verify: async (text) => {
        try {
          return formatVerdict(await verifyWithMode({ modes, gateway, memory, store }, text));
        } catch (err) {
          return `\u9A8C\u8BC1\u6267\u884C\u5931\u8D25\uFF1A${err.message}`;
        }
      }
    }).attach();
  }
  if (!config.ui.enabled) return;
  const dash = new DashboardServer({
    config,
    modes,
    store,
    ledger,
    dsh,
    sessions,
    onSwitch: (id) => {
      const m = modes.switch(id);
      store.setActiveMode(m.id);
      store.setRoles(modes.roles());
      memory.clear();
    },
    onSaveMode: (name2, id) => {
      const m = modes.saveMode({ name: name2, id });
      store.setActiveMode(m.id);
      store.setRoles(modes.roles());
    },
    onRemoveMode: (id) => {
      modes.removeMode(id);
      store.setActiveMode(modes.active.id);
      store.setRoles(modes.roles());
      memory.clear();
    },
    onSetRole: (role2, provider, model) => {
      modes.setRole(role2, provider, model);
      store.setRoles(modes.roles());
    }
  });
  ctx.effect(() => {
    void dash.start().then((port) => {
      if (dash.isReused()) {
        ctx.logger?.info?.(`[agent-modes] \u590D\u7528\u5DF2\u8FD0\u884C\u7684\u770B\u677F http://127.0.0.1:${port}`);
        return;
      }
      ctx.logger?.info?.(`[agent-modes] \u770B\u677F\u5DF2\u542F\u52A8 http://127.0.0.1:${port}\uFF08\u754C\u9762\u5E95\u90E8\u6A2A\u6761\u53EF\u5C55\u5F00\uFF1B\u767B\u5F55\u9875\u6253\u4E0D\u5F00\u5C31\u7528\u6D4F\u89C8\u5668\u8BBF\u95EE\uFF09`);
      if (port !== config.ui.dashboardPort) {
        ctx.logger?.warn?.(`[agent-modes] \u7AEF\u53E3 ${config.ui.dashboardPort} \u88AB\u5360\u7528\uFF0C\u770B\u677F\u5DF2\u6539\u7528 ${port}`);
      }
    }).catch((err) => {
      ctx.logger?.warn?.(`[agent-modes] \u770B\u677F\u542F\u52A8\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u7F16\u6392\u529F\u80FD\uFF09\uFF1A${err.message}`);
    });
    return () => dash.stop();
  });
}
export {
  Config,
  DshLlm,
  Gateway,
  MOCK_PROVIDER,
  MockAdapter,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
