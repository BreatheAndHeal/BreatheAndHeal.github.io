const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Exercise repository defaults even when a developer has local overrides.
// Simulate stale Production values: the requested schedule must not regress to old settings.
process.env.WORK_START_HOUR = "10";
process.env.WORK_END_HOUR = "22";
process.env.SLOT_INTERVAL_MINUTES = "30";
process.env.WORK_DAYS = "1,2,3,4,5,6";
process.env.MIN_LEAD_MINUTES = "60";
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

test("booking schedule stays seven days, 07:00–23:00 IST, every 20 minutes even with stale env overrides", () => {
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

test("booking UI uses centered stacked layout and daily schedule copy in both forms", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const guidance = "Available daily, including Sundays, 7:00 AM–11:00 PM IST. Start times are every 20 minutes; sessions finish by 11:00 PM.";
  assert.equal(html.split(guidance).length - 1, 2);
  assert.match(html, /\.book\{display:grid;grid-template-columns:minmax\(0,1fr\);/);
  assert.match(html, /\.book-panel\{width:min\(100%,900px\);margin:0 auto/);
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


test("astrology dropdown shows name and duration without price while preserving payment mapping values", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('<option value="Vedic Insight — 20 min · ₹899">Vedic Insight — 20 min</option>'));
  assert.ok(html.includes('<option value="Deep Vedic Reading — 40 min · ₹1,399">Deep Vedic Reading — 40 min</option>'));
  assert.ok(html.includes('<option value="Complete Vedic Guidance — 60 min · ₹1,999">Complete Vedic Guidance — 60 min</option>'));
  assert.equal(html.includes('<option>Vedic Insight — 20 min · ₹899</option>'), false);
  assert.equal(html.includes('<option>Deep Vedic Reading — 40 min · ₹1,399</option>'), false);
  assert.equal(html.includes('<option>Complete Vedic Guidance — 60 min · ₹1,999</option>'), false);
});

test("FAQ answers toggle explicitly and have a visible open state", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('document.querySelectorAll(".faq details > summary")'));
  assert.ok(html.includes('event.preventDefault();'));
  assert.ok(html.includes('if(item) item.open=!item.open;'));
  assert.ok(html.includes('.faq details[open]>p{display:block}'));
  assert.ok(html.includes('.faq details:not([open])>p{display:none}'));
});

test("FAQ cards lift gently and show a soft shadow on hover and keyboard focus", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes("transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease,background .22s ease"));
  assert.ok(html.includes("@media(hover:hover){.faq details:hover"));
  assert.ok(html.includes(".faq details:focus-within"));
  assert.ok(html.includes("transform:translateY(-3px)"));
  assert.ok(html.includes("box-shadow:0 12px 26px rgba(45,52,47,.08)"));
});
