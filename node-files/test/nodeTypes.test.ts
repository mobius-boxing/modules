/*
 * The registry reader: `GET /node-types` in, a palette and a generated config
 * panel out.
 *
 * This is the file that makes "adding a node type is a backend file and nothing
 * else" true, so it is tested against the descriptor shape the API actually
 * publishes (`INodeFilesNodeTypeDescriptor`), including a type this build has
 * never heard of and an input kind it has never heard of.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultConfig,
  fallbackDescriptor,
  findDescriptor,
  normalizeNodeTypes,
  summarize,
} from "../src/lib/nodeTypes.ts";

/** The condition node's real descriptor, copied from the API's registry. */
const CONDITION = {
  type: "condition",
  label: "Condición",
  description: "Compara un campo extraído con un valor y sigue la rama verdadera o falsa.",
  handles: ["true", "false"],
  acceptsInput: true,
  configSchema: [
    {
      key: "left",
      label: "Campo",
      input: "fieldKey",
      required: true,
      options: [],
      templated: false,
      placeholder: null,
      help: "Uno de los campos declarados en el flujo.",
      defaultValue: null,
    },
    {
      key: "op",
      label: "Operador",
      input: "select",
      required: true,
      options: [{ value: "eq", label: "es igual a" }],
      templated: false,
      placeholder: null,
      help: null,
      defaultValue: "eq",
    },
    {
      key: "right",
      label: "Valor",
      input: "text",
      required: false,
      options: [],
      templated: false,
      placeholder: "1000",
      help: null,
      defaultValue: null,
    },
  ],
};

test("a condition is three inputs because the registry says so, not because we know what a condition is", () => {
  const [condition] = normalizeNodeTypes([CONDITION]);
  assert.deepEqual(
    condition?.configSchema.map((input) => [input.key, input.input, input.required]),
    [
      ["left", "fieldKey", true],
      ["op", "select", true],
      ["right", "text", false],
    ],
  );
  assert.deepEqual(condition?.handles, ["true", "false"], "the branches come from the descriptor");
  assert.deepEqual(condition?.configSchema[1]?.options, [{ value: "eq", label: "es igual a" }]);
});

test("handles and acceptsInput come from the descriptor, never from the type's name", () => {
  const [trigger, mystery] = normalizeNodeTypes([
    {
      type: "trigger",
      label: "Disparador",
      handles: ["out"],
      acceptsInput: false,
      configSchema: [],
    },
    {
      type: "slack",
      label: "Slack",
      handles: ["true", "false"],
      acceptsInput: true,
      configSchema: [],
    },
  ]);
  assert.equal(trigger?.acceptsInput, false, "nothing may point at the start of the graph");
  assert.deepEqual(
    mystery?.handles,
    ["true", "false"],
    "a type this build never heard of branches",
  );
});

test("a descriptor missing its handles still draws a connectable node", () => {
  const [loose] = normalizeNodeTypes([{ type: "email", label: "Email", configSchema: [] }]);
  assert.deepEqual(loose?.handles, ["out"]);
  assert.equal(loose?.acceptsInput, true);

  const [empty] = normalizeNodeTypes([{ type: "email", handles: ["nonsense"], configSchema: [] }]);
  assert.deepEqual(empty?.handles, ["out"], "an unknown handle is not a handle");
});

test("an unknown input kind degrades to a text box rather than disappearing", () => {
  const [type] = normalizeNodeTypes([
    {
      type: "email",
      label: "Email",
      configSchema: [
        { key: "colour", label: "Color", input: "colorPicker" },
        { label: "sin key", input: "text" },
      ],
    },
  ]);
  assert.equal(type?.configSchema.length, 1, "the input without a key is dropped");
  assert.equal(type?.configSchema[0]?.input, "text", "the unknown kind is still editable");
});

test("normalizeNodeTypes drops what it cannot identify and keeps what it can", () => {
  const descriptors = normalizeNodeTypes([
    { type: "email", label: "Enviar email", configSchema: [] },
    { type: "slack", configSchema: null },
    { label: "sin type" },
    "nope",
  ]);
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.type),
    ["email", "slack"],
  );
  assert.equal(descriptors[1]?.label, "slack", "an unlabelled type prints its own name");
  assert.deepEqual(descriptors[1]?.configSchema, [], "an unreadable schema is an empty form");
  assert.equal(findDescriptor(descriptors, "http"), null);
});

test("a node whose type the registry does not know is still drawn and still connects", () => {
  const fallback = fallbackDescriptor("quantum");
  assert.equal(fallback.label, "quantum", "it stays identifiable");
  assert.deepEqual(fallback.handles, ["out"]);
  assert.equal(fallback.acceptsInput, true);
  assert.deepEqual(fallback.configSchema, []);
});

test("a new node starts with the schema's declared defaults and nothing else", () => {
  const [condition] = normalizeNodeTypes([CONDITION]);
  assert.deepEqual(defaultConfig(condition!), { op: "eq" });
});

test("the node summary is the first configured value, in the schema's order", () => {
  const [condition] = normalizeNodeTypes([CONDITION]);
  assert.equal(summarize(condition!, {}), "", "nothing configured yet");
  assert.equal(summarize(condition!, { op: "gte", right: "25000" }), "gte", "op precedes right");
  assert.equal(summarize(condition!, { left: "total", op: "gte" }), "total");
  assert.equal(summarize(condition!, { left: "   ", op: "gte" }), "gte", "blank is not configured");
});
