---
name: local-routing-policy
description: Decide when a fixed local Senior may delegate a bounded task to a fixed local Junior agent profile, and specify the evidence required to accept the result.
---

# Local routing policy

Use this policy only when the parent session is explicitly pinned to the configured Qwen Senior model. Do not use it with Copilot `Auto`.

A task is Junior-eligible only when all conditions hold:

- it has one narrow objective;
- inputs and allowed files are explicit;
- the result is independently verifiable;
- failure can be safely escalated without partial production changes;
- it contains no security, architecture, migration, public API, concurrency, incident, or ambiguous product decision;
- no other Junior is already running on a 48 GB host.

Choose the smallest matching role:

| Work | Agent |
|---|---|
| Search, locate, inspect, summarize code evidence | `local-router-junior-explorer` |
| Run one named test/lint/type-check/build command | `local-router-junior-test-runner` |
| Add explicit unit cases in named test files only | `local-router-junior-test-writer` |
| Everything else | keep on Senior |

When delegating, include objective, allowed/forbidden files, exact validation, return format, and `ESCALATE` rule. Senior must review every returned diff and command result.

Treat model identity as an observable property. Confirm the physical Senior → Junior → Senior sequence in oMLX DEBUG logs; never trust the agent name or response alone.
