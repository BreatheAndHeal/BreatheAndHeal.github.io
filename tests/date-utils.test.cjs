const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDatabaseDate } = require("../lib/date-utils");

test("normalizes PostgreSQL DATE strings for payment retry comparisons", () => {
  assert.equal(normalizeDatabaseDate("2026-10-18"), "2026-10-18");
  assert.equal(normalizeDatabaseDate("2026-10-18T00:00:00.000Z"), "2026-10-18");
  assert.equal(
    normalizeDatabaseDate(new Date("2026-10-18T00:00:00.000Z")),
    "2026-10-18"
  );
});

test("rejects values without a date prefix", () => {
  assert.equal(normalizeDatabaseDate(null), "");
  assert.equal(normalizeDatabaseDate(""), "");
  assert.equal(normalizeDatabaseDate("not-a-date"), "");
});
