---
name: Upgrade freshness
description: Paid collection access must not depend on stale client plan state.
---
Never reject a collection add solely from the device's stored free-plan status. Let the server enforce the current account's limit, and show an upgrade prompt only for the explicit collection-limit error.

**Why:** A confirmed paid account at the free-plan cap could still be blocked before its request reached the server. The user wants upgrades to work without signing out.

**How to apply:** Require a fresh backend account before claiming activation success. Foreground entitlement refreshes should be read-only, not full login synchronization, and should not disrupt an established session during a temporary outage.
