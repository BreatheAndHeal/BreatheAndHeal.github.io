const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rateLimit = require("../lib/rate-limit");
const retention = require("../lib/retention");

test("Cloudflare edge client IP takes precedence over untrusted forwarding headers", () => {
  assert.equal(rateLimit.getClientIp({
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "x-real-ip": "198.51.100.20",
      "x-forwarded-for": "192.0.2.30, 10.0.0.1"
    }
  }), "203.0.113.10");
  assert.equal(rateLimit.getClientIp({
    headers: { "x-real-ip": "198.51.100.20", "x-forwarded-for": "192.0.2.30" }
  }), "198.51.100.20");
  assert.equal(rateLimit.getClientIp({
    headers: { "x-forwarded-for": "192.0.2.30, 10.0.0.1" }
  }), "192.0.2.30");
});

test("rate-limit storage is shared/atomic and does not persist raw client IPs", () => {
  const previous = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_SECRET = "launch-test-secret";
  try {
    const req = { headers: { "cf-connecting-ip": "203.0.113.10" } };
    const key = rateLimit.requesterKey(req);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(key.includes("203.0.113.10"), false);
    assert.notEqual(key, rateLimit.requesterKey({ headers: { "cf-connecting-ip": "203.0.113.11" } }));
    const src = fs.readFileSync(path.join(root, "lib/rate-limit.js"), "utf8");
    assert.match(src, /INSERT INTO api_rate_limits/);
    assert.match(src, /ON CONFLICT \(rate_key\) DO UPDATE/);
  } finally {
    if (previous === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = previous;
  }
});

test("expired unpaid booking retention is limited to 90 days and clears optional sensitive fields", () => {
  assert.equal(retention.RETENTION_DAYS, 90);
  const src = fs.readFileSync(path.join(root, "lib/retention.js"), "utf8");
  for (const field of ["customer_whatsapp = ''", "concern = NULL", "message = NULL", "birth_date = NULL", "birth_time = NULL", "birth_place = NULL"]) {
    assert.ok(src.includes(field), "retention sweep should clear " + field);
  }
  assert.match(src, /payment_status <> 'paid'/);
  assert.match(src, /expires_at < NOW\(\) - INTERVAL '90 days'/);
  assert.match(src, /RETURNING id/);
});

test("paid-booking Calendar recheck fails closed and leaves confirmation retryable", () => {
  const src = fs.readFileSync(path.join(root, "lib/confirm-booking.js"), "utf8");
  assert.match(src, /Google Calendar availability recheck failed; confirmation will retry/);
  assert.match(src, /booking_status='paid_pending_confirmation'/);
});

test("reduced motion is respected and the existing trust-strip claim remains unchanged", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.ok(html.includes('<div class="impact-num">200+</div><b>People supported</b><span>Across different personal situations</span>'));
});

test("privacy policy describes the applied retention period", () => {
  const html = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(html, /90 days after the temporary hold expires/);
});
