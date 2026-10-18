const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("payment recovery contact displays one accurate support email", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.match(
    html,
    /function supportMessage\(\)\{return "theunsaid\.care@gmail\.com · 7905806974"\}/
  );
  assert.doesNotMatch(html, /alternate:\s*theunsaid\.care@gmail\.com/);
});

test("homepage does not make an unverified people-supported claim", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.doesNotMatch(html, /200+\\s*<\\/div>\\s*<b>People supported<\\/b>/i);
  assert.match(html, /<div class="impact-num">No rush<\\/div><b>At your own pace<\\/b>/);
});
