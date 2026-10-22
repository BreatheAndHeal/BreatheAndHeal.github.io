const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = (name) => fs.readFileSync(path.join(root, name), "utf8");
const guideFiles = [
  "overthinking.html",
  "heartbreak.html",
  "loneliness.html",
  "career-confusion.html",
  "life-decisions.html",
  "difficult-conversations.html"
];
const publicPages = [
  "index.html", "journal.html", ...guideFiles,
  "terms.html", "refunds.html", "privacy.html", "crisis.html", "404.html"
];

test("homepage has two order summaries sourced from existing booking session data", () => {
  const home = html("index.html");
  assert.match(home, /id="emotionalOrderSummary"/);
  assert.match(home, /id="astrologyOrderSummary"/);
  for (const field of ["emotional-session", "emotional-date", "emotional-time", "emotional-total", "astrology-session", "astrology-date", "astrology-time", "astrology-total"]) {
    assert.ok(home.includes('data-summary="' + field + '"'), "Missing summary field: " + field);
  }
  assert.match(home, /const meta=BOOKING_SESSIONS\[sessionSelect\?\.value\]/);
  assert.match(home, /updateOrderSummary\("emotional"\)/);
  assert.match(home, /updateOrderSummary\("astrology"\)/);
  assert.match(home, /The total is shown in the order summary and again in Razorpay checkout\./);
});

test("five-item navigation keeps topics and check-in reachable from the hero", () => {
  const home = html("index.html");
  const nav = home.match(/<nav class="links" id="links">[\s\S]*?<\/nav>/)?.[0] || "";
  assert.equal((nav.match(/<a\b/g) || []).length, 5);
  for (const href of ['href="#sessions"', 'href="#astrology"', 'href="/journal"', 'href="#faq"', 'href="#book"']) {
    assert.ok(nav.includes(href), "Missing nav target " + href);
  }
  const hero = home.match(/<section class="hero">[\s\S]*?<\/section>/)?.[0] || "";
  assert.ok(hero.includes('href="#topics"'));
  assert.ok(hero.includes('href="#checkin"'));
  assert.ok(hero.includes("Choose a time, pay, get confirmation"), "hero CTA should use the approved wording");
  assert.match(home, /if\(e\.key==="Escape"\)\{closeModal\(\);links\?\.classList\.remove\("open"\)\}/);
});

test("each guide has a byline, three related guides, and large share metadata", () => {
  for (const file of guideFiles) {
    const page = html(file);
    const h1End = page.indexOf("</h1>");
    const bylineAt = page.indexOf("By [NAME] · Last updated [DATE]");
    assert.ok(h1End >= 0 && bylineAt > h1End && bylineAt - h1End < 100, file + " byline should sit directly under h1");
    assert.equal((page.match(/class="related-card"/g) || []).length, 3, file + " should have three related guide cards");
    assert.match(page, /property="og:site_name" content="The Unsaid"/);
    assert.match(page, /property="og:image" content="https:\/\/theunsaidcare\.com\/og-image\.jpg"/);
    assert.match(page, /name="twitter:card" content="summary_large_image"/);
    assert.match(page, /name="twitter:image" content="https:\/\/theunsaidcare\.com\/og-image\.jpg"/);
    assert.doesNotMatch(page, /(?:href|src|content)=["'][^"']+\.html(?:[?#][^"']*)?["']/i);
  }
});

test("all public HTML pages have shared footer and favicon link tags", () => {
  for (const file of publicPages) {
    const page = html(file);
    assert.match(page, /© 2026 The Unsaid/, file + " is missing the static copyright year");
    for (const required of ['/favicon.ico', '/assets/favicon.svg', '/assets/favicon-192.png', '/assets/favicon-512.png', '/assets/apple-touch-icon.png']) {
      assert.ok(page.includes(required), file + " is missing favicon reference " + required);
    }
    assert.doesNotMatch(page, /7905806974/, file + " contains the retired phone number");
  }
});

test("robots and sitemap use the production host and extensionless public routes", () => {
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.match(robots, /User-agent:\s*\*\s+Allow:\s*\/\s+Sitemap:\s*https:\/\/theunsaidcare\.com\/sitemap\.xml/);
  assert.doesNotMatch(sitemap, /\.html/);
  for (const route of ["/", "/journal", "/overthinking", "/heartbreak", "/loneliness", "/career-confusion", "/life-decisions", "/difficult-conversations", "/terms", "/refunds", "/privacy"]) {
    assert.ok(sitemap.includes("<loc>https://theunsaidcare.com" + route + "</loc>"), "Sitemap missing " + route);
  }
});
