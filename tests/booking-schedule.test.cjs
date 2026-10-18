const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Exercise repository defaults even when a developer has local overrides.
for (const name of ["WORK_START_HOUR","WORK_END_HOUR","SLOT_INTERVAL_MINUTES","WORK_DAYS","MIN_LEAD_MINUTES"]) {
  process.env[name] = "";
}
const {
  WORK_START, WORK_END, SLOT_MINUTES, WORK_DAYS, validateSlot, toBlocks, timeRangesOverlap
} = require("../lib/config");

function nextSunday() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + 8);
  while (date.getDay() !== 0) date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

test("default booking schedule is seven days, 07:00–23:00 IST, every 20 minutes", () => {
  assert.equal(WORK_START, 7);
  assert.equal(WORK_END, 23);
  assert.equal(SLOT_MINUTES, 20);
  assert.deepEqual([...WORK_DAYS].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test("Sunday is bookable and all session lengths fit within 07:00–23:00", () => {
  const sunday = nextSunday();
  assert.equal(new Date(sunday + "T00:00:00Z").getUTCDay(), 0);
  assert.equal(validateSlot(sunday, "07:00", 20), null);
  assert.equal(validateSlot(sunday, "07:20", 40), null);
  assert.equal(validateSlot(sunday, "22:40", 20), null);
  assert.equal(validateSlot(sunday, "22:20", 40), null);
  assert.equal(validateSlot(sunday, "22:00", 60), null);
  assert.equal(validateSlot(sunday, "22:20", 60), "That time is outside the available hours.");
  assert.equal(validateSlot(sunday, "23:00", 20), "That time is outside the available hours.");
  assert.equal(validateSlot(sunday, "07:10", 20), "Please choose a standard 20-minute slot.");
});

test("booking locks are generated at 20-minute intervals for 20/40/60-minute sessions", () => {
  assert.deepEqual(toBlocks("07:00", 20), ["07:00:00"]);
  assert.deepEqual(toBlocks("07:00", 40), ["07:00:00", "07:20:00"]);
  assert.deepEqual(toBlocks("22:20", 40), ["22:20:00", "22:40:00"]);
  assert.deepEqual(toBlocks("22:00", 60), ["22:00:00", "22:20:00", "22:40:00"]);
});

test("real-time overlap check protects old bookings from the previous 30-minute grid", () => {
  assert.equal(timeRangesOverlap("10:00", 30, "10:20", 20), true);
  assert.equal(timeRangesOverlap("10:00", 60, "10:40", 20), true);
  assert.equal(timeRangesOverlap("10:00", 20, "10:20", 20), false);
  assert.equal(timeRangesOverlap("10:00", 40, "10:40", 20), false);
});

test("booking UI clearly shows the daily schedule in both forms", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const guidance = "Available daily, including Sundays, 7:00 AM–11:00 PM IST. Start times are every 20 minutes; sessions finish by 11:00 PM.";
  assert.equal(html.split(guidance).length - 1, 2);
});

test("both Apps Script adapters use the same 20-minute busy grid", () => {
  for (const file of ["production-apps-script/Code.gs", "staging-apps-script/Code.gs"]) {
    const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
    assert.match(source, /const SLOT_MINUTES = 20;/);
    assert.match(source, /body\.slotIntervalMinutes \|\| 30/);
    assert.match(source, /minutes \+= slotMinutes/);
    assert.match(source, /slotEnd = slotStart \+ slotMinutes \* 60 \* 1000;/);
  }
});
