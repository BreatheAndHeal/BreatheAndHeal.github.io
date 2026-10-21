# The Unsaid

A calm, private online space for honest conversations, emotional support and personal perspective.

## Current launch checklist
- Real WhatsApp/phone: 8707236175
- Public website: https://the-unsaid-bg2.pages.dev
- Public contact: theunsaid.care@gmail.com
- Phone / WhatsApp: 8707236175
- Cloudflare Pages branch: `migration/cloudflare-preview`
- Vercel `main` remains a separate rollback deployment; do not assume the two branches are identical.
- SEO discovery: robots.txt + sitemap.xml
- Booking: live slot booking, Razorpay payment verification, Calendar/Meet confirmation and email notifications
- Payment: Razorpay Checkout with server-side verification and captured-payment webhook
- Scheduling: live availability with database slot locks
- Privacy, terms, cancellation/refund and safety pages added for the current service/tool setup
- Booking schedule: 07:00–23:00 IST daily, including Sundays; 20-minute start intervals
- Launch hardening work is tracked in the launch-readiness branch; automated smoke tests do not prove a full live payment/calendar/email cycle.

The site avoids invented qualifications, client counts, outcome statistics, or testimonials. Any future testimonial should be published only with permission.
