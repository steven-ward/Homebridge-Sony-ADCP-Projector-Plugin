---
name: project-conventions
description: Internal code conventions for this Homebridge plugin. Claude reads this automatically when working on the codebase.
user-invocable: false
---

## Code conventions for homebridge-sony-adcp-projector

**ADCP commands**: Always use `ADCP_COMMANDS` constants from `adcp-commands.js`. Never hardcode ADCP strings inline in `platform.js` or elsewhere.

**HAP accessory lifecycle**: TV accessories use `publishExternalAccessories()`, never `registerPlatformAccessories()`.

**Logging**: Use `this.log.debug()` for verbose output, `this.log.info()` for normal state changes, `this.log.error()` for failures. Never use `console.log`.

**Error handling in ADCP**: Catch errors at the command level, not the caller level. The queue in `adcp.js` handles retries — callers should handle `null`/`undefined` responses gracefully.

**Commit style**: Conventional commits — `feat:`, `fix:`, `chore(release):`, `refactor:`, `docs:`.
