---
name: Publishing schema drift
description: Runtime-created tables and partial database changes during failed publishing.
---

Declare durable runtime tables in the schema source and ensure they exist in development before publishing. Runtime CREATE IF NOT EXISTS alone is not protection from a publish-time DROP.

**Why:** A failed publish listed pricing guard tables for deletion; subsequent production inspection and user-provided logs confirmed missing eBay quota tables while the older app continued serving. A failed publish does not imply that production schema changes were rolled back.

**How to apply:** Inspect the development-to-production schema diff before retrying. Preserve production tables rather than approving unintended drops. Apply additive development definitions, then let Publish restore missing production structures. Separately verify runtime behavior after publishing; a successful homepage does not prove background pricing is healthy.
