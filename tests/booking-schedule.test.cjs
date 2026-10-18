const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Simulate stale Production values: the requested schedule must not regress to old settings.
process.env.WORK_START_HOUR = "10";
process.env.WORK_END_HOUR = "22";
process.env.SLOT_INTERVAL_MINUTES = "30";
process.env.WORK_DAYS = "1,2,3,4,5,6";
process.env.MIN_LEAD_MINUTES = "60";
const {
  SESSIONS, BOOKING_SESSION_METADATA, canonicalSession, WORK_START, WORK_END,
  SLOT_MINUTES, WORK_DAYS, validateSlot, toBlocks, timeRangesOverlap
} = require("../lib/config");
const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");

function nextSunday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 8);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

test("Vercel schedule stays 07:00–23:00 every day with 20-minute starts despite stale env overrides", () => {
  assert.equal(WORK_START, 7);
  assert.equal(WORK_END, 23);
  assert.equal(SLOT_MINUTES, 20);
  assert.deepEqual([...WORK_DAYS].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test("the current booking catalogue has exact durations and prices", () => {
  assert.deepEqual(SESSIONS, {
    "Focused Conversation — 20 min": { service: "emotional", amount: 499, duration: 20 },
    "Deep Conversation — 40 min": { service: "emotional", amount: 699, duration: 40 },
    "Extended Session — 60 min": { service: "emotional", amount: 1199, duration: 60 },
    "Vedic Insight — 20 min": { service: "astrology", amount: 899, duration: 20 },
    "Deep Vedic Reading — 40 min": { service: "astrology", amount: 1399, duration: 40 },
    "Complete Vedic Guidance — 60 min": { service: "astrology", amount: 1999, duration: 60 }
  });
  assert.equal(BOOKING_SESSION_METADATA["Deep Vedic Reading — 50 min"].duration, 50);
  assert.equal(canonicalSession("Vedic Insight — 30 min · ₹999"), null);
});

test("Sunday and late-day starts work only if the full session ends by 23:00", () => {
  const sunday = nextSunday();
  assert.equal(new Date(sunday + "T00:00:00Z").getUTCDay(), 0);
  assert.equal(validateSlot(sunday, "07:00", 20), null);
  assert.equal(validateSlot(sunday, "22:40", 20), null);
  assert.equal(validateSlot(sunday, "22:20", 40), null);
  assert.equal(validateSlot(sunday, "22:00", 60), null);
  assert.equal(validateSlot(sunday, "22:20", 60), "That time is outside the available hours.");
  assert.equal(validateSlot(sunday, "07:10", 20), "Please choose a standard 20-minute slot.");
});

test("20-minute slot locks cover 20/40/60-minute appointments and old-grid overlap", () => {
  assert.deepEqual(toBlocks("07:00", 20), ["07:00:00"]);
  assert.deepEqual(toBlocks("07:00", 40), ["07:00:00", "07:20:00"]);
  assert.deepEqual(toBlocks("22:00", 60), ["22:00:00", "22:20:00", "22:40:00"]);
  assert.equal(timeRangesOverlap("10:00", 30, "10:20", 20), true);
  assert.equal(timeRangesOverlap("10:00", 20, "10:20", 20), false);
});

test("Vercel homepage uses the requested four cards, menu and timing copy", () => {
  for (const value of [
    "Focused Conversation — 20 min",
    "Deep Conversation — 40 min",
    "Extended Session — 60 min",
    "Vedic Insight — 20 min · ₹899",
    "Deep Vedic Reading — 40 min · ₹1,399",
    "Complete Vedic Guidance — 60 min · ₹1,999",
    "Available daily, including Sundays, 7:00 AM–11:00 PM IST. Start times are every 20 minutes; sessions finish by 11:00 PM."
  ]) assert.ok(html.includes(value), "Missing current content: " + value);

  assert.equal([...html.matchAll(/<article class="impact">[\s\S]*?<\/article>/g)].length, 4);
  assert.ok(html.includes('<div class="impact-num">200+</div><b>People supported</b>'));
  assert.ok(html.includes('<div class="impact-num">No rush</div><b>At your own pace</b>'));
  for (const oldValue of [
    "Focused Conversation — 30 min", "Deep Conversation — 45 min", "Vedic Insight — 30 min",
    "Deep Vedic Reading — 50 min", "Complete Vedic Guidance — 70 min", "₹999", "₹1,499", "₹2,199"
  ]) assert.equal(html.includes(oldValue), false, "Old session option still present: " + oldValue);
  assert.match(html, /\.book\{display:grid;grid-template-columns:minmax\(0,1fr\);/);
  assert.match(html, /\.book-panel\{width:min\(100%,900px\);margin:0 auto/);
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
  assert.ok(html.includes(".faq details:hover,.faq details:focus-within"));
  assert.ok(html.includes("transform:translateY(-3px)"));
  assert.ok(html.includes("box-shadow:0 12px 26px rgba(45,52,47,.08)"));
});
