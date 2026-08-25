import assert from "node:assert/strict";
import { test } from "node:test";
import { isRunCancellable, isRunInFlight } from "../src/lib/format.ts";

/**
 * The rule the polling depends on. `pending_review` being OUT of this set is
 * not a detail: the detail screen re-seeds the reviewer's draft on every run
 * change, so polling during review would wipe what they are typing. If someone
 * "helpfully" adds pending_review here, that is the bug, and this is what
 * catches it.
 */
test("polls only while the server still owns the run", () => {
  assert.equal(isRunInFlight("queued"), true);
  assert.equal(isRunInFlight("extracting"), true);
  assert.equal(isRunInFlight("running"), true);
});

test("never polls once a PERSON owns the run — protects the review draft", () => {
  assert.equal(isRunInFlight("pending_review"), false);
});

test("never polls a settled run", () => {
  assert.equal(isRunInFlight("succeeded"), false);
  assert.equal(isRunInFlight("failed"), false);
});

test("an unknown status does not start an endless poll", () => {
  assert.equal(isRunInFlight("nonsense"), false);
  assert.equal(isRunInFlight(""), false);
});

/**
 * The cancel button's visibility must mirror the server exactly. The API allows
 * cancelling from `queued` and `pending_review` only and 409s otherwise — a
 * button offered mid-execution would hand the user an error they cannot act on.
 */
test("offers cancel exactly where the API allows it", () => {
  assert.equal(isRunCancellable("queued"), true);
  assert.equal(isRunCancellable("pending_review"), true);
});

test("never offers cancel mid-execution — an email already sent cannot be un-sent", () => {
  assert.equal(isRunCancellable("extracting"), false);
  assert.equal(isRunCancellable("running"), false);
});

test("never offers cancel on a settled run", () => {
  assert.equal(isRunCancellable("succeeded"), false);
  assert.equal(isRunCancellable("failed"), false);
  assert.equal(isRunCancellable("nonsense"), false);
});
