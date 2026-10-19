const { sql } = require("./db");

const RETENTION_DAYS = 90;
const PURGE_DAYS = 180;
const RETENTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let lastRunAt = 0;
let inFlight = null;

/**
 * Best-effort retention sweep, triggered by valid booking/availability traffic
 * and rate-limited to once per warm runtime every six hours.
 *
 * At 90 days after an unpaid hold expires, remove customer contact details,
 * free-text and astrology birth details. After 180 days, delete eligible
 * unpaid/pending rows with no recorded payment ID. Paid bookings and rows with
 * a payment ID are intentionally preserved for reconciliation and recordkeeping.
 * Stale slot locks and rate-limit keys are also removed.
 */
async function cleanupExpiredRecords() {
  if (Date.now() - lastRunAt < RETENTION_COOLDOWN_MS) {
    return { anonymized: 0, deleted: 0, slotLocksDeleted: 0, rateLimitsDeleted: 0 };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const anonymizedRows = await sql`
      UPDATE bookings
      SET customer_name = 'Expired booking',
          customer_email = 'expired+' || id || '@invalid.example',
          customer_whatsapp = '',
          language = NULL,
          concern = NULL,
          message = NULL,
          birth_date = NULL,
          birth_time = NULL,
          birth_place = NULL,
          updated_at = NOW()
      WHERE payment_status <> 'paid'
        AND booking_status = 'pending'
        AND razorpay_payment_id IS NULL
        AND expires_at IS NOT NULL
        AND expires_at < NOW() - INTERVAL '90 days'
        AND customer_email NOT LIKE 'expired+%@invalid.example'
      RETURNING id
    `;

    const deletedRows = await sql`
      DELETE FROM bookings
      WHERE payment_status <> 'paid'
        AND booking_status = 'pending'
        AND razorpay_payment_id IS NULL
        AND expires_at IS NOT NULL
        AND expires_at < NOW() - INTERVAL '180 days'
      RETURNING id
    `;

    const deletedSlotLocks = await sql`
      DELETE FROM slot_locks
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
      RETURNING booking_id
    `;

    const deletedRateLimits = await sql`
      DELETE FROM api_rate_limits
      WHERE updated_at < NOW() - INTERVAL '24 hours'
      RETURNING rate_key
    `;

    lastRunAt = Date.now();
    return {
      anonymized: anonymizedRows.length,
      deleted: deletedRows.length,
      slotLocksDeleted: deletedSlotLocks.length,
      rateLimitsDeleted: deletedRateLimits.length
    };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

module.exports = { RETENTION_DAYS, PURGE_DAYS, cleanupExpiredRecords };
