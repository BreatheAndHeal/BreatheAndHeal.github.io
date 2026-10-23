const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("both booking forms offer optional guide preference and default to no preference", () => {
  const home = read("index.html");
  for (const [id, key] of [
    ["guidePreference", "guidePreference"],
    ["astroGuidePreference", "astroGuidePreference"]
  ]) {
    const field = home.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'));
    assert.ok(field, id + " field must exist");
    assert.match(field[0], /<option value="no_preference" selected>No preference<\/option>/);
    assert.match(field[0], /<option value="utkarsh">Utkarsh<\/option>/);
    assert.match(field[0], /<option value="anshika">Anshika<\/option>/);
    assert.doesNotMatch(field[0], /\brequired\b/, id + " must remain optional");
    assert.ok(home.includes('guidePreference:q("' + key + '")'), id + " must be sent to the backend");
  }
  const emotionalForm = home.match(/<form id="booking">([\\s\\S]*?)<\\/form>/)?.[1] || "";
  const astrologyForm = home.match(/<form id="astrologyBooking">([\\s\\S]*?)<\\/form>/)?.[1] || "";
  assert.ok(emotionalForm.indexOf('id="message"') < emotionalForm.indexOf('id="guidePreference"'),
    "emotional guide preference should follow the message field");
  assert.ok(astrologyForm.indexOf('id="astroMessage"') < astrologyForm.indexOf('id="astroGuidePreference"'),
    "astrology guide preference should follow the message field");
  assert.equal((home.match(/We’ll take your preference into account when arranging your session\\./g) || []).length, 2);
  assert.doesNotMatch(home, /Available times remain based on the shared calendar/);
});

test("create-order validates, persists, migrates and updates guide preference on unpaid retry", () => {
  const api = read("api/create-order.js");
  const schema = read("schema.sql");

  assert.ok(api.includes('const guidePreference=clean(body.guidePreference,30).toLowerCase() || "no_preference";'));
  assert.ok(api.includes('if(!["utkarsh","anshika","no_preference"].includes(guidePreference))'));
  assert.ok(api.includes("ADD COLUMN IF NOT EXISTS guide_preference TEXT NOT NULL DEFAULT 'no_preference'"));
  assert.ok(api.includes("booking_date,booking_time,language,guide_preference,concern,message"));
  assert.ok(api.includes("guidePreference"));
  assert.ok(api.includes("guide_preference"));
  assert.ok(schema.includes("guide_preference TEXT NOT NULL DEFAULT 'no_preference'"));
  assert.ok(schema.includes("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_preference TEXT NOT NULL DEFAULT 'no_preference';"));
});

test("paid booking confirmation forwards the chosen guide as a note without promising assignment", () => {
  const confirm = read("lib/confirm-booking.js");
  const calendar = read("lib/calendar.js");

  assert.ok(confirm.includes('work.guide_preference==="utkarsh"'));
  assert.ok(confirm.includes('work.guide_preference==="anshika"'));
  assert.ok(confirm.includes("Client has no guide preference."));
  assert.ok(confirm.includes("Preference only; not a guaranteed assignment."));
  assert.ok(confirm.includes("notes:guidePreferenceNote"));
  assert.ok(calendar.includes("notes:notes||"));
});

test("privacy policy discloses guide preference and retention anonymizes expired unpaid selections", () => {
  const privacy = read("privacy.html");
  const retention = read("lib/retention.js");
  assert.ok(privacy.includes("your selected guide preference, if you provide one"));
  assert.ok(privacy.includes("guide preferences and astrology birth details"));
  assert.ok(retention.includes("await ensureGuidePreferenceColumn();"));
  assert.ok(retention.includes("guide_preference = 'no_preference'"));
});
