# The Unsaid — booking backend setup

This repository contains the public GitHub Pages site plus Vercel serverless endpoints for the real booking flow.

## Required Vercel environment variables

- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- DATABASE_URL
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REFRESH_TOKEN
- GOOGLE_CALENDAR_ID (use `primary` for the connected Google account)
- BOOKING_TIMEZONE=Asia/Kolkata
- WORK_START_HOUR=10
- WORK_END_HOUR=20
- SLOT_INTERVAL_MINUTES=30
- MIN_LEAD_MINUTES=60
- WORK_DAYS=1,2,3,4,5,6

Never put Razorpay secrets or Google refresh tokens in public HTML or GitHub source.

## Database

Run `schema.sql` once in the Neon SQL editor.

## Razorpay

Use Razorpay API keys on the server only. Configure the Payment Captured webhook to:

`https://<your-vercel-project>.vercel.app/api/webhook`

The frontend should create an order through `/api/create-order`, open Razorpay Checkout with the returned `orderId`, and send the Checkout response to `/api/verify-payment`.

## Google Calendar / Meet

Create an OAuth client with Calendar access and store the resulting refresh token as `GOOGLE_REFRESH_TOKEN`. The backend creates a Calendar event with a Google Meet conference and invites the customer's email address.

## Default availability

Monday-Saturday, 10:00 AM-8:00 PM, with 30-minute start intervals and a 60-minute minimum lead time. These values are environment variables and can be changed without editing the code.
