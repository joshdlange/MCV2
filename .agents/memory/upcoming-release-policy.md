---
name: Upcoming release policy
description: Why releases require confirmed dates, staged checklists, and request-time catch-up.
---
Treat a release date as midnight America/Chicago on that date, not midnight UTC or the following day. Keep discovered announcements private until admin review; never infer confirmation from a feed's publication date.

**Why:** The previous expiry job could remove an upcoming announcement without creating its catalog. Date-only parsing and reliance on a daily timer also made release timing unreliable. Autoscaled instances may sleep through the release instant.

**How to apply:** Release the complete staged checklist and retire its upcoming entry atomically, and preserve request-time catch-up alongside recurring checks. An announcement without a confirmed date and prepared checklist must not silently disappear or publish an incomplete catalog. Schema changes go through Publish, never startup DDL.

The owner supplied 2026 CardFun Marvel Spider Rally as a November 30, 2026 release with no checklist yet, using the supplied box art; the supplied Cyclops image is the upcoming 2026 Topps Chrome Marvel Studios preview.

**Why:** Owner-confirmed announcement and artwork choices, not automatically discovered checklist evidence.
**How to apply:** Do not invent Spider Rally cards or treat its box art as a checklist.