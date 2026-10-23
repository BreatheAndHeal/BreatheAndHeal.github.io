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

test("expired unpaid booking retention anonymizes at 90 days and purges eligible rows at 180 days", () => {
  assert.equal(retention.RETENTION_DAYS, 90);
  assert.equal(retention.PURGE_DAYS, 180);
  const src = fs.readFileSync(path.join(root, "lib/retention.js"), "utf8");
  for (const field of ["customer_whatsapp = ''", "concern = NULL", "message = NULL", "birth_date = NULL", "birth_time = NULL", "birth_place = NULL"]) {
    assert.ok(src.includes(field), "retention sweep should clear " + field);
  }
  assert.match(src, /UPDATE bookings/);
  assert.match(src, /DELETE FROM bookings/);
  assert.match(src, /payment_status <> 'paid'/);
  assert.equal((src.match(/razorpay_payment_id IS NULL/g) || []).length, 2);
  assert.equal((src.match(/paid_at IS NULL/g) || []).length, 2);
  assert.match(src, /expires_at < NOW\(\) - INTERVAL '90 days'/);
  assert.match(src, /expires_at < NOW\(\) - INTERVAL '180 days'/);
  assert.match(src, /DELETE FROM api_rate_limits/);
  assert.match(src, /updated_at < NOW\(\) - INTERVAL '24 hours'/);
  assert.match(src, /DELETE FROM slot_locks/);
  assert.match(src, /slot_date < CURRENT_DATE/);
});

test("captured-payment webhook preserves in-flight Calendar state and does not await Calendar/Meet", () => {
  const webhook = fs.readFileSync(path.join(root, "api/webhook.js"), "utf8");
  const edgeAdapter = fs.readFileSync(path.join(root, "functions/_shared/legacy-adapter.js"), "utf8");
  const edgeRoute = fs.readFileSync(path.join(root, "functions/api/webhook.js"), "utf8");
  assert.match(webhook, /'confirmed','paid_slot_conflict','calendar_processing'/);
  assert.match(webhook, /paid_at=COALESCE\(paid_at,NOW\(\)\)/);
  assert.match(webhook, /req\.waitUntil\(confirmationPromise\)/);
  assert.doesNotMatch(webhook, /await confirmPaidBooking\(booking\.id\)/);
  assert.match(edgeAdapter, /context\.waitUntil/);
  assert.match(edgeRoute, /runLegacyHandler\(request, handler, \{ waitUntil \}\)/);
});

test("paid-booking Calendar recheck fails closed and leaves confirmation retryable", () => {
  const src = fs.readFileSync(path.join(root, "lib/confirm-booking.js"), "utf8");
  assert.match(src, /Google Calendar availability recheck failed; confirmation will retry/);
  assert.match(src, /booking_status='paid_pending_confirmation'/);
});

test("reduced motion is respected and the requested experience metrics are present", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(html, /<div class="impact-num">6\+ years<\/div><b>Relevant experience<\/b>/);
  assert.match(html, /<div class="impact-num">1,200\+<\/div><b>Clients served<\/b>/);
  assert.doesNotMatch(html, /<div class="impact-num">Your pace<\/div><b>No pressure to perform<\/b>/);
  assert.doesNotMatch(html, /<div class="impact-num">1:1<\/div><b>Focused attention<\/b>/);
});

test("privacy policy describes the applied retention period", () => {
  const html = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
  assert.match(html, /90 days after the temporary hold expires/);
});
