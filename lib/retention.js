const { sql } = require("./db");

const RETENTION_DAYS = 90;
const RETENTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let lastRunAt = 0;
let inFlight = null;

/**
 * Best-effort lazy retention sweep. It is triggered by valid booking/availability
 * traffic and at most once per warm runtime every six hours. It preserves the
 * booking ID, order ID, amount, slot and status for payment reconciliation, but
 * replaces contact details and clears free-text / astrology birth details.
 */
async function scrubExpiredUnpaidBookings() {
  if (Date.now() - lastRunAt < RETENTION_COOLDOWN_MS) return 0;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const rows = await sql`
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
        AND expires_at IS NOT NULL
        AND expires_at < NOW() - INTERVAL '90 days'
        AND customer_email NOT LIKE 'expired+%@invalid.example'
      RETURNING id
    `;
    lastRunAt = Date.now();
    return rows.length;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

module.exports = { RETENTION_DAYS, scrubExpiredUnpaidBookings };
