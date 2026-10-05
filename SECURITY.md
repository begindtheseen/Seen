# Security Policy

If you find a security problem in Seen, I'd like to hear about it so I can fix it.

## Reporting a vulnerability

Please report it privately. Open the Security tab of this repository and use the "Report a vulnerability" button. That sends the details only to me.

Please don't open a public issue or pull request for a security problem, since that would make it visible before it is fixed.

I'll reply within a few days, and I'll keep you updated while I work on a fix.

## How payments and accounts are handled

Payments go through Stripe Checkout, and sign in is handled by Supabase Auth. Card numbers are entered on Stripe's own pages, so card data never touches this app's servers.
