# DEV photo rules and verification

## Rules: before and now

| Rule | Before this change | Now / evidence |
| --- | --- | --- |
| Matched Add uploads nothing and creates no review | Already the DEV behavior | Actual UI action policy has an upload-forbidden regression; server AST guard rejects upload/queue calls in DEV scan/Add handlers. Completion releases review state and parent scan resources. |
| Search pick with usable image has no offer/upload | Already the DEV behavior | Tested policy rejects even a forced Yes action for this case. |
| Search pick missing image offers optional upload | Already optional, different wording | Exact requested question; Yes calls upload, Skip calls no upload. Failed upload keeps the card added and offers retry. |
| Wrong-image report, reason, optional photo | Not available | Result-tile and added-notice action; reason-only reports enter the existing queue. Explicit attachment only; reports never add ownership. Admin must supply an image before approving a reason-only report, or reject without changing the card. |
| Admins alone bypass approval | Trusted uploaders also bypassed | Both upload/submit endpoints use the admin-only policy. Trusted users queue. Wrong-image reports always queue, including admin reports. |

## Real code and real DEV database test

Run:
`NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on node_modules/.bin/tsx scripts/verify-dev-photo-review.ts`

Successful run used isolated temporary DEV users/card/queue records, the same
approval function as the admin endpoint, a real existing Cloudinary image download,
and the bundled embedding model. No storage, model or database mocks were used.
It verified:
- trusted users do not bypass and cannot approve; full admins can;
- a reason-only item is returned by the real queue query and cannot be blindly approved;
- failed image preparation leaves the queue pending and the card unchanged;
- successful approval commits the image, a 384-value vector, approved status and
  exactly one audit record; repeated approval is rejected;
- all owned temporary fixtures are removed afterward.

This is **not** a signed-in browser test, a new Cloudinary upload test, or proof
that a collector's independent camera photo is recognized. It uses an existing
reference image, not the user's absent Colossus photo.

## Requested full gap-fill journey — honest step results

1. **Search-pick missing image → Add:** UI action policy tested; signed-in browser
   acceptance not yet performed.
2. **Explicit Yes → upload user's photo:** implemented existing upload path,
   but not exercised with the user's photo/authenticated session here.
3. **Appears in admin queue:** real fixture insert and real queue read passed;
   the upload-to-queue browser handoff remains unverified.
4. **Admin approves:** real approval function with persisted admin-role checks
   passed; authenticated HTTP/admin UI interaction remains unverified.
5. **Image and scan index update:** real image/vector/decision/audit transaction
   passed. Shared-vector replacement/exclusion is also covered by scanner tests.
6. **A new camera scan finds that card:** still unverified. Needs an independent
   camera query and a completed real upload/approval. No fabricated before/after rank.

Colossus's actual replacement and paired rank proof remain unfinished. Ghost Rider
needs an identifiable fresh scan event/query. No publishing or production writes.
DEV uploads now use unique assets in a separate DEV folder so matching dev/prod
user/card IDs cannot overwrite production or previously approved images.