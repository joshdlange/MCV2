# Database availability and sign-in recovery

## Deployment acceptance

- Run `npm run test:availability` and `npm run test:release`, then `npm run build`.
- Publish the verified changes.
- Check `/health/dependencies` on the published domain: HTTP 200 with `dependencies.database` equal to `available`. A 503 or a timeout is a failure.
- Check `/ready`: HTTP 200 only after startup is complete and the database probe passes.
- `/health` is a process/startup liveness check, not evidence that the database or sign-in works.
- Confirm a normal existing-user sign-in works on the published app.

## External monitoring (requires separate activation)

An endpoint is not a monitor. Configure an independent service to check
`https://app.marvelcardvault.com/health/dependencies` every minute.
Require HTTP 200 and the expected database-available response, not merely any
HTML page or successful redirect. Use a timeout of 10 seconds and alert after
two consecutive failed checks, with a recovery notification when healthy.
Enable the owner's chosen notification channel and verify a test notification.
Do not declare monitoring active until the monitor and delivery are verified.

Better Stack is the proposed independent service; connection and configuration
must be completed separately. Monitoring from the app itself cannot detect a
total application outage reliably.

## Incident response

1. Check the external monitor and production logs, not workspace logs.
2. Distinguish database unavailability from invalid authentication.
   `DATABASE_UNAVAILABLE` is a retryable HTTP 503, not a missing account.
3. For “endpoint has been disabled,” investigate the database provider's
   endpoint state and account/audit events. Do not assume a billing cause or
   data loss from that message alone. If the database is provider-managed,
   use the provider's supported recovery process; application retries cannot
   enable a disabled endpoint.
4. Never switch production to the development database or create replacement
   accounts to work around unavailable reads.
5. Use structured auth availability logs to count distinct hashed identities,
   separating attempts from people. These logs identify authenticated users
   reaching the sync endpoint, not all anonymous visitors or client failures.
6. Confirm dependency health and a successful account sync after recovery.
   Record the observed outage window and distinguish it from an exact start
   time, which may precede the first observed failure.

## Expected application behavior

- Initial sign-in remains gated until a valid backend account is returned.
- Temporary database and network failures display a connection-outage message,
  with automatic capped-backoff retries and a manual retry option.
- Signing out or changing identity cancels stale retries.
- A failed database lookup must not be interpreted as “new user.”
- No collection, payment, or other business mutation is blindly replayed.
- Structured logs exclude email addresses, raw Firebase identities, and tokens.

## Limits

These changes improve detection, safe failure, and recovery. They do not provide
database failover or guarantee provider uptime. The underlying cause of the
September 21, 2026 disabled-endpoint incident remains unconfirmed; restoring
connectivity alone does not establish the root cause.