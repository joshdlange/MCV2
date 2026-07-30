---
name: Background processes in agent shell
description: nohup'd background processes die between bash tool calls; and pgrep self-matches the polling command
---
Background processes started with nohup/& in one bash tool call are killed when that call's session ends — they do NOT survive to the next call.
**Why:** each bash tool invocation is its own session; long scans run this way die silently with no error in the log.
**How to apply:** for any job longer than ~100s, run it inside the long-lived workflow server (e.g. dev-only boot trigger via flag file) instead of a background shell process. Also: `pgrep -f pattern` matches the polling bash command itself (the pattern is in its argv) — always exclude self or check the actual process args, or you'll see phantom "RUNNING" forever. Shell calls are also hard-capped at 5 min — a long DB batch killed mid-call rolls back uncommitted work with no output. Alternative for one-off long jobs: temporary console workflow running a script that tees to a /tmp log and ends with `sleep 3600`; poll the log from shell calls, then removeWorkflow.
