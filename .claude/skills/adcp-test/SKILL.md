---
name: adcp-test
description: Run live ADCP connectivity and command tests against the real projector. Requires projector IP to be reachable.
disable-model-invocation: true
---

Run live device tests:

1. Ask the user for the projector IP if not provided
2. Run `node test-adcp.js <ip>` and capture output
3. Run `node validate-adcp.js <ip>` and capture output
4. Summarize which commands succeeded, failed, or timed out
5. Flag any unexpected responses for investigation
