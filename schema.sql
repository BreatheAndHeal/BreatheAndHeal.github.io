CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  session_name TEXT NOT NULL,
  amount_inr INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_whatsapp TEXT NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  booking_tz TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  language TEXT,
  guide_preference TEXT NOT NULL DEFAULT 'no_preference',
  concern TEXT,
  message TEXT,
  birth_date DATE,
  birth_time TIME,
  birth_place TEXT,
  consent_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  payment_status TEXT NOT NULL DEFAULT 'created',
  booking_status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  meet_link TEXT,
  calendar_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Also add the consent columns when this schema is applied to an existing database.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_preference TEXT NOT NULL DEFAULT 'no_preference';

CREATE TABLE IF NOT EXISTS slot_locks (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  slot_start TIME NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (slot_date, slot_start)
);

CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(booking_status);
CREATE INDEX IF NOT EXISTS slot_locks_expiry_idx ON slot_locks(expires_at);
 
-- Shared request rate limits across serverless instances/deployments.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_rate_limits_updated_at_idx ON api_rate_limits(updated_at);
