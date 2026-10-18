const crypto = require("crypto");
const { sql } = require("./db");

/**
 * Prefer Cloudflare's edge-injected address. x-real-ip is the next choice for
 * supported hosts; x-forwarded-for is last because client-supplied forwarding
 * headers must not override a trusted platform address.
 */
function getClientIp(req) {
  const headers = req && req.headers ? req.headers : {};
  const cloudflare = String(headers["cf-connecting-ip"] || "").trim();
  const real = String(headers["x-real-ip"] || "").trim();
  const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  return cloudflare || real || forwarded || "unknown";
}

function requesterKey(req) {
  const ip = getClientIp(req);
  const secret = process.env.RAZORPAY_KEY_SECRET ||
    process.env.GOOGLE_APPS_SCRIPT_SECRET ||
    "the-unsaid-rate-limit";
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

/**
 * Atomic shared limiter across isolates/instances and both deployments that
 * share the database. A single INSERT .. ON CONFLICT serializes updates per
 * endpoint/IP key; stale keys are pruned in small batches.
 *
 * Requires the additive api_rate_limits table from schema.sql.
 */
async function allowRequest(req, name, limit, windowMs) {
  const rateKey = String(name) + ":" + requesterKey(req);
  const rows = await sql`
    WITH stale AS (
      DELETE FROM api_rate_limits
      WHERE rate_key IN (
        SELECT rate_key
        FROM api_rate_limits
        WHERE updated_at < NOW() - INTERVAL '24 hours'
          AND rate_key <> ${rateKey}
        ORDER BY updated_at
        LIMIT 100
      )
      RETURNING rate_key
    )
    INSERT INTO api_rate_limits (rate_key, window_started_at, request_count, updated_at)
    VALUES (${rateKey}, NOW(), 1, NOW())
    ON CONFLICT (rate_key) DO UPDATE SET
      request_count = CASE
        WHEN api_rate_limits.window_started_at <= NOW() -
          (${windowMs}::double precision * INTERVAL '1 millisecond')
        THEN 1
        ELSE api_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN api_rate_limits.window_started_at <= NOW() -
          (${windowMs}::double precision * INTERVAL '1 millisecond')
        THEN NOW()
        ELSE api_rate_limits.window_started_at
      END,
      updated_at = NOW()
    RETURNING (request_count <= ${limit}) AS allowed
  `;
  return rows[0]?.allowed === true;
}

module.exports = { allowRequest, getClientIp, requesterKey };
