---
name: Password reset via Resend
description: Provider split for email (Resend = password reset only, Brevo = everything else) and Firebase Admin quirks around reset links
---

# Password reset / email provider split

- **Resend** sends ONLY password reset emails (+ admin test endpoint). **Brevo** sends all other transactional email. No marketing via Resend. Details in replit.md.
- The RESEND_API_KEY is a send-only restricted key — it cannot list domains, so verify delivery by sending to `delivered@resend.dev`.

## Firebase Admin quirks
- `admin.auth().generatePasswordResetLink(email)` for a **non-existent user** throws an opaque `auth/internal-error` ("INTERNAL ASSERT FAILED: Unable to create the email action link"), NOT `auth/user-not-found`.
- **How to apply:** call `admin.auth().getUserByEmail(email)` first to get a clean `auth/user-not-found` signal, then generate the link.
- **Why:** distinguishing unknown-user from genuine internal failure is impossible from generatePasswordResetLink's error alone.

## Anti-enumeration contract on /api/auth/forgot-password
- Unknown email, send failure, and federated-only accounts (Google/Apple, no password provider) ALL return the same generic success response. Never return 500 on the send path — a 200/500 divergence confirms account existence.
- Endpoint has in-memory rate limiting (5/hr per IP, 3/hr per email). If this ever moves to multi-instance deployment, the in-memory map won't be shared.
