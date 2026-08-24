/*
 * Run with `npm test -w @mobius-modules/node-files` (node's built-in test
 * runner + native TS type stripping — no jest, no dependencies, and nothing to
 * typecheck since @types/node is not installed in this monorepo). Same setup as
 * shared/whitelabel.
 *
 * Only the pure helpers are covered: the field key rule the API also enforces,
 * the value coercion the review form submits, and the defensive reader for the
 * `extracted` jsonb.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fieldsForRun,
  fromEditableValue,
  moveField,
  normalizeExtracted,
  toEditableValue,
  validateFieldKey,
  validateFields,
} from "../src/lib/fields.ts";

test("accepts keys matching the API's pattern and rejects the rest", () => {
  assert.equal(validateFieldKey("numero_factura"), null);
  assert.equal(validateFieldKey("Total2"), null);
  assert.equal(validateFieldKey("a"), null);

  assert.notEqual(validateFieldKey(""), null);
  assert.notEqual(validateFieldKey("1campo"), null, "a leading digit is invalid");
  assert.notEqual(validateFieldKey("_campo"), null, "a leading underscore is invalid");
  assert.notEqual(validateFieldKey("numero-factura"), null, "a hyphen is invalid");
  assert.notEqual(validateFieldKey("numero factura"), null, "a space is invalid");
  assert.notEqual(validateFieldKey("número"), null, "an accent is invalid");
  assert.notEqual(validateFieldKey("campo\n"), null, "a trailing newline is invalid");
});

test("rejects a schema with a duplicate key or a missing label", () => {
  const field = (key: string, label: string) =>
    ({ key, label, type: "string", required: false }) as const;

  assert.equal(validateFields([field("a", "A"), field("b", "B")]), null);
  assert.notEqual(validateFields([field("a", "A"), field("a", "Otra")]), null);
  assert.notEqual(validateFields([field("a", "  ")]), null);
});

test("moves a field and leaves out-of-range moves alone", () => {
  assert.deepEqual(moveField(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveField(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveField(["a", "b", "c"], 0, 0), ["a", "b", "c"]);
  assert.deepEqual(moveField(["a", "b", "c"], 0, 3), ["a", "b", "c"]);
  assert.deepEqual(moveField(["a", "b", "c"], -1, 0), ["a", "b", "c"]);
});

test("coerces the reviewer's text to the declared type", () => {
  assert.equal(fromEditableValue("42", "number"), 42);
  assert.equal(fromEditableValue("1234,50", "currency"), 1234.5);
  assert.equal(fromEditableValue("no es un número", "number"), null);
  assert.equal(fromEditableValue("true", "boolean"), true);
  assert.equal(fromEditableValue("false", "boolean"), false);
  assert.equal(fromEditableValue("2026-08-24", "date"), "2026-08-24");
  assert.deepEqual(fromEditableValue("uno, dos ,, tres", "list"), ["uno", "dos", "tres"]);
  assert.equal(fromEditableValue("  hola  ", "string"), "hola");
});

test("an empty box is null for every type — never 0, false or an empty string", () => {
  for (const type of ["string", "number", "date", "currency", "boolean", "list"] as const) {
    assert.equal(fromEditableValue("   ", type), null, `${type} should read empty as null`);
  }
});

test("a value survives a round trip through the review form", () => {
  assert.equal(fromEditableValue(toEditableValue(0), "number"), 0);
  assert.equal(fromEditableValue(toEditableValue(false), "boolean"), false);
  assert.deepEqual(fromEditableValue(toEditableValue(["a", "b"]), "list"), ["a", "b"]);
  assert.equal(fromEditableValue(toEditableValue(null), "string"), null);
});

test("reads extracted values whether or not they carry a confidence", () => {
  assert.deepEqual(normalizeExtracted({ total: { value: 12, confidence: 0.9 } }), {
    total: { value: 12, confidence: 0.9 },
  });
  assert.deepEqual(normalizeExtracted({ total: 12 }), { total: { value: 12, confidence: null } });
  assert.deepEqual(normalizeExtracted({ total: { value: null } }), {
    total: { value: null, confidence: null },
  });
  assert.deepEqual(normalizeExtracted({ items: ["a", "b"] }), {
    items: { value: ["a", "b"], confidence: null },
  });
  // Anything that is not an object at all: no values, no crash.
  assert.deepEqual(normalizeExtracted(null), {});
  assert.deepEqual(normalizeExtracted("nope"), {});
  assert.deepEqual(normalizeExtracted([1, 2]), {});
});

test("falls back to the extracted keys when the run carries no schema", () => {
  const declared = [{ key: "a", label: "A", type: "string" as const, required: true }];
  const extracted = normalizeExtracted({ b: 1, c: 2 });

  assert.deepEqual(fieldsForRun(declared, extracted), declared);
  assert.deepEqual(
    fieldsForRun(undefined, extracted).map((field) => field.key),
    ["b", "c"],
  );
  assert.deepEqual(fieldsForRun([], extracted).map((field) => field.label), ["b", "c"]);
});
