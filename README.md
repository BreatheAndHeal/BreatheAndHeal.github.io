# The Unsaid

A calm, private online space for honest conversations, emotional support and personal perspective.

## Current launch checklist
- Primary domain: https://theunsaidcare.com (custom-domain activation and verification must be completed before announcing it as the primary URL)
- Existing Cloudflare Pages fallback: https://the-unsaid-bg2.pages.dev — keep available during domain cutover and rollback checks
- Public contact: theunsaid.care@gmail.com
- Phone / WhatsApp: 8707236175
- Cloudflare Pages branch: `migration/cloudflare-preview`
- Vercel `main` remains a separate rollback deployment; do not assume the two branches are identical.
- SEO discovery: `https://theunsaidcare.com/robots.txt` and `https://theunsaidcare.com/sitemap.xml` after the custom domain is active and `PUBLIC_SITE_URL` has been updated.
- Booking: live slot booking, Razorpay payment verification, Calendar/Meet confirmation and email notifications
- Payment: Razorpay Checkout with server-side verification and captured-payment webhook
- Scheduling: live availability with database slot locks
- Privacy, terms, cancellation/refund and safety pages added for the current service/tool setup
- Booking schedule: 07:00–23:00 IST daily, including Sundays; 20-minute start intervals
- Launch hardening checks are in the Cloudflare target branch; automated smoke tests do not prove a full live payment/calendar/email cycle.

Domain cutover is complete only after the domain-owner email is verified, the custom domain shows active with HTTPS, booking/API paths work, Razorpay configuration is updated, and the new sitemap is reachable. Keep the `pages.dev` fallback available until these checks pass.

The site avoids invented qualifications, client counts, outcome statistics, or testimonials. Any future testimonial should be published only with permission.
