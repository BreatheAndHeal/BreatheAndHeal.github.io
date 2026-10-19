# Staging environment

This branch is reserved for testing The Unsaid against the independently managed Neon project `the-unsaid-staging`.

- Configure `DATABASE_URL` only in the Cloudflare Pages Preview environment for this branch.
- Never copy production booking data into this database.
- Keep production environment variables and the production branch unchanged.
- Use Razorpay Test Mode and isolated test calendar resources for staging verification.
