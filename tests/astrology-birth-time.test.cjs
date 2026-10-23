const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("astrology form offers Hindi, Hinglish and English and sends the selected language", () => {
  const home = read("index.html");

  assert.ok(home.includes('<label for="astroLanguage">Language</label>'));
  assert.ok(home.includes('<select id="astroLanguage" required>'));
  for (const language of ["Hindi", "Hinglish", "English"]) {
    assert.ok(home.includes('<option value="' + language + '">' + language + '</option>'), "Missing language option: " + language);
  }
  assert.ok(home.includes('language:q("astroLanguage")'));
  assert.ok(home.includes("You can choose Hindi, Hinglish or English for both Emotional Guidance and Vedic Astrology."));
});

test("unknown birth-time checkbox disables the input and removes its required state", () => {
  const home = read("index.html");

  assert.ok(home.includes('<label for="birthTime">Exact birth time</label>'));
  assert.ok(home.includes('id="birthTime" type="time" required aria-describedby="birthTimeHelp"'));
  assert.ok(home.includes('id="birthTimeUnknown" type="checkbox"'));
  assert.ok(home.includes("I don't know my exact birth time"));
  assert.ok(home.includes("birthTimeInput.disabled=unknown;"));
  assert.ok(home.includes("birthTimeInput.required=!unknown;"));
  assert.ok(home.includes('if(unknown)birthTimeInput.value="";'));
  assert.ok(home.includes('birthTimeUnknown:document.getElementById("birthTimeUnknown").checked'));
  assert.ok(home.includes('<label for="astroDate">Choose date</label>'));
});

test("create-order accepts empty astrology birth time only with explicit unknown flag", () => {
  const api = read("api/create-order.js");
  const schema = read("schema.sql");

  assert.ok(api.includes("const birthTimeUnknown=body.birthTimeUnknown===true;"));
  assert.ok(api.includes("const validBirthTime=birthTimeUnknown ? !birthTime : isValidHHMM(birthTime);"));
  assert.ok(api.includes("!validBirthTime"));
  assert.ok(api.includes("${birthTimeUnknown?null:(birthTime||null)}"));
  assert.ok(api.includes("${clean(body.language,30)}"));
  assert.ok(schema.includes("birth_time TIME,"), "birth_time should remain nullable; do not require a database migration");
  assert.ok(api.includes('const meta=sessionName ? SESSIONS[sessionName] : null;'), "session/price validation must remain in place");
  assert.ok(api.includes('const keyId=process.env.RAZORPAY_KEY_ID;'), "Razorpay order creation must remain intact");
});
