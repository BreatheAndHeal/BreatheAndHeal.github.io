const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("payment recovery contact displays one accurate support email", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.match(
    html,
    /function supportMessage\(\)\{return "theunsaid\.care@gmail\.com · 8707236175"\}/
  );
  assert.doesNotMatch(html, /alternate:\s*theunsaid\.care@gmail\.com/);
});


test("homepage keeps four impact cards including requested experience and client metrics", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const cards = [...html.matchAll(/<article class="impact">([\\s\\S]*?)<\\/article>/g)].map((match) => match[1]);

  assert.equal(cards.length, 4, "homepage must keep exactly four impact cards");
  assert.match(cards[0], /<div class="impact-num">1:1<\\/div><b>One-to-one space<\\/b><span>Focused attention on your concern<\\/span>/);
  assert.match(cards[1], /<div class="impact-num">6\\+ years<\\/div><b>Relevant experience<\\/b><span>Experience supporting thoughtful one-to-one conversations<\\/span>/);
  assert.match(cards[2], /<div class="impact-num">1,200\\+<\\/div><b>Clients served<\\/b><span>People who have trusted The Unsaid for guidance<\\/span>/);
  assert.match(cards[3], /<div class="impact-num">No rush<\\/div><b>At your own pace<\\/b><span>Share only what feels comfortable<\\/span>/);
  assert.doesNotMatch(html, /<div class="impact-num">Your pace<\\/div><b>No pressure to perform<\\/b>/);
  assert.doesNotMatch(html, /<div class="impact-num">1:1<\\/div><b>Focused attention<\\/b>/);
  assert.doesNotMatch(html, /<div class="impact-num">200\\+<\\/div><b>People supported<\\/b>/);
  assert.doesNotMatch(html, /<div class="impact-num">2\\+<\\/div><b>Years of practice<\\/b>/);
  assert.doesNotMatch(html, /<div class="impact-num">3<\\/div><b>Session lengths<\\/b>/);
});
