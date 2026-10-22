const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SESSIONS, BOOKING_SESSION_METADATA, canonicalSession } = require("../lib/config");

const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");

test("active Emotional Guidance and Vedic Astrology catalogue has requested durations and prices", () => {
  const expected = {
    "Focused Conversation — 20 min": { service: "emotional", amount: 499, duration: 20 },
    "Deep Conversation — 40 min": { service: "emotional", amount: 699, duration: 40 },
    "Extended Session — 60 min": { service: "emotional", amount: 1199, duration: 60 },
    "Vedic Insight — 20 min": { service: "astrology", amount: 899, duration: 20 },
    "Deep Vedic Reading — 40 min": { service: "astrology", amount: 1399, duration: 40 },
    "Complete Vedic Guidance — 60 min": { service: "astrology", amount: 1999, duration: 60 }
  };

  assert.deepEqual(SESSIONS, expected);
});

test("visible cards, booking dropdowns, and duration FAQ use the same current options", () => {
  for (const text of [
    "Focused Conversation — 20 min",
    "Deep Conversation — 40 min",
    "Extended Session — 60 min",
    "Vedic Insight — 20 min · ₹899",
    "Deep Vedic Reading — 40 min · ₹1,399",
    "Complete Vedic Guidance — 60 min · ₹1,999",
    "Clear pricing for 20-, 40- and 60-minute conversations.",
    "Emotional Guidance is available in 20, 40 and 60-minute sessions. Vedic Astrology readings are available in 20, 40 and 60-minute formats."
  ]) {
    assert.ok(html.includes(text), "homepage is missing current copy: " + text);
  }

  for (const stale of [
    "Focused Conversation — 30 min",
    "Deep Conversation — 45 min",
    "Vedic Insight — 30 min",
    "Deep Vedic Reading — 50 min",
    "Complete Vedic Guidance — 70 min",
    "₹999",
    "₹1,499",
    "₹2,199",
    "50 minutes",
    "70 minutes"
  ]) {
    assert.equal(html.includes(stale), false, "homepage still contains outdated option: " + stale);
  }

  // Three source occurrences are expected: the option value/card binding, the card selector, and the single price map.
  // The visible labels are rendered from BOOKING_SESSIONS at runtime rather than duplicated as hardcoded option text.
  assert.equal(html.split("Vedic Insight — 20 min · ₹899").length - 1, 3);
  assert.equal(html.split("Deep Vedic Reading — 40 min · ₹1,399").length - 1, 3);
  assert.equal(html.split("Complete Vedic Guidance — 60 min · ₹1,999").length - 1, 3);
  assert.ok(html.includes("function renderBookingSessionPrices()"));
  assert.ok(html.includes('const session=BOOKING_SESSIONS[option.value]'));
  assert.ok(html.includes('option.textContent=label+" · ₹"+session.amount.toLocaleString("en-IN");'));

  assert.ok(html.includes('"Vedic Insight — 20 min · ₹899":{amount:899,service:"astrology"}'));
  assert.ok(html.includes('"Deep Vedic Reading — 40 min · ₹1,399":{amount:1399,service:"astrology"}'));
  assert.ok(html.includes('"Complete Vedic Guidance — 60 min · ₹1,999":{amount:1999,service:"astrology"}'));
});

test("new bookings reject retired session choices while existing bookings retain recovery metadata", () => {
  assert.equal(canonicalSession("Focused Conversation — 30 min"), null);
  assert.equal(canonicalSession("Deep Conversation — 45 min"), null);
  assert.equal(canonicalSession("Vedic Insight — 30 min · ₹999"), null);
  assert.equal(canonicalSession("Deep Vedic Reading — 50 min · ₹1,499"), null);
  assert.equal(canonicalSession("Complete Vedic Guidance — 70 min · ₹2,199"), null);

  assert.deepEqual(BOOKING_SESSION_METADATA["Focused Conversation — 30 min"], {
    service: "emotional", amount: 499, duration: 30
  });
  assert.deepEqual(BOOKING_SESSION_METADATA["Deep Conversation — 45 min"], {
    service: "emotional", amount: 699, duration: 45
  });
  assert.deepEqual(BOOKING_SESSION_METADATA["Vedic Insight — 30 min"], {
    service: "astrology", amount: 999, duration: 30
  });
  assert.deepEqual(BOOKING_SESSION_METADATA["Deep Vedic Reading — 50 min"], {
    service: "astrology", amount: 1499, duration: 50
  });
  assert.deepEqual(BOOKING_SESSION_METADATA["Complete Vedic Guidance — 70 min"], {
    service: "astrology", amount: 2199, duration: 70
  });
});
