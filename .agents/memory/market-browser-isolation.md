---
name: Market browser verification boundaries
description: Safe isolation and interpretation of Market Price signed-in browser checks.
---

Keep Market Price browser verification offline from the paid provider and use
temporary accounts/tables, not collector accounts.

**Why:** the user explicitly requested mocked provider responses, isolated test
accounts, no provider activation, and no publishing for this verification.

**How to apply:** distinguish responsive authenticated component/service checks
from live Firebase sign-in and native-device verification when reporting coverage.
When cloning database structures for isolation, replace copied sequence defaults:
schema-local tables alone do not prevent writes to original serial sequences.
