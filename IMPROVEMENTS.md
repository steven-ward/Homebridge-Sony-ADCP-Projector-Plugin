# Homebridge Sony ADCP Projector Plugin — Improvement Roadmap

Goal: deliver the most stable and capable Sony projector integration for Apple HomeKit by tightening transport reliability, keeping HomeKit state truthful, and aligning the configuration/UX with the actual feature set. This document synthesizes:

- The current code (`accessory.js`, `adcp.js`, `config.schema.json`, utilities) @ repo.
- Sony’s “Protocol Manual — Supported Command List” PDF (included in this repo).
- Homebridge plugin authoring guidance from https://developers.homebridge.io/#/plugins.

---

## Top-Level Objectives

1. **ADCP Transport Resilience**
   - Ensure we never overwhelm the projector, leak sockets, or leave commands hanging.
2. **Truthful State + UX**
   - HomeKit tiles should always match real projector state, and config options/README should describe what’s truly implemented.
3. **Developer Confidence**
   - Tests, typed surfaces, and tooling that let us iterate safely.

Each objective below has concrete tasks grouped by priority.

---

## 1. ADCP Transport Resilience (High Priority)

### 1.1 Harden the command pipeline

**Files:** `adcp.js`

- Add an explicit **command queue** with per-command timeout + retry counters (homebridge docs emphasize non-blocking async responses).
- Implement **debounce/backoff** (150–200 ms) between ADCP calls; Siri automations currently hammer `executeCommand` in parallel, risking “err_busy” responses.
- Track `lastCommandTime`, `commandLock`, and guard all HomeKit `onSet` handlers by awaiting the queue to prevent race conditions.

### 1.2 Normalize command vocabulary

**Files:** `adcp.js`, new `adcp-commands.js`, PDF reference

- Create `adcp-commands.js` exporting constants + helpers derived from the Sony command PDF. This removes scattered string literals and makes it easy to audit which ADCP verbs we rely on.
- Update `adcp.js` helpers (`_adcpSetPictureMode`, `_adcpGetBrightness`, etc.) to use the shared constant map so that future firmware quirks are patched in one place.

### 1.3 Connection lifecycle visibility

**Files:** `adcp.js`, `accessory.js`

- Make `ADCP` extend `EventEmitter` and emit `connected`, `authenticated`, `disconnected`, `error`, and `retry` events. This mirrors Homebridge guidance for long-lived transports.
- In `accessory.js`, subscribe to the events to surface diagnostics in debug logs and optionally expose a ContactSensor/StatusFault if ADCP stays offline for >N seconds.

### 1.4 Discovery + tooling parity

**Files:** `discovery.js`, `validate-adcp.js`

- Default to **port 53595** and accept `--port`/`--timeout` CLI args; current script hardcodes 53484.
- Echo fingerprints (IP, model, ADCP authentication capability) so users can confirm settings before onboarding the accessory.

---

## 2. State Synchronization & Telemetry (High Priority)

### 2.1 Configurable polling loop

**Files:** `accessory.js`, `config.schema.json`

- Add `enablePolling` (default true) and `pollingInterval` (10–300 s, default 30 s). Poll power state, ActiveIdentifier, picture/HDR/test pattern caches, and brightness when the projector is on.
- Reflect polled values back into the relevant HAP characteristics so the Home app shows accurate state even if the physical remote was used.

### 2.2 Error + lamp telemetry

**Files:** `accessory.js`

- Ensure `_setupErrorSensor` and `_setupLampHoursSensor` degrade gracefully (`err_cmd` should clear faults instead of logging errors repeatedly).
- Consider exposing lamp hours via a custom characteristic (or migrating to a `StatelessProgrammableSwitch` for lamp warnings) so values are not mislabeled as “lux”.

### 2.3 Warm-up / cool-down UX

**Files:** `accessory.js`

- Enhance `_postPowerPoll` to publish `ActiveTransitionCount` / `CurrentMediaState` changes (if available via television service) to reflect the ~30 s projector ramp.

---

## 3. Configuration & User Experience (Medium Priority)

### 3.1 Align `uiLayout` naming

**Files:** `config.schema.json`, `readme.md`, Homebridge UI schema

- The schema currently exposes `"inputs_only"` / `"mixed_virtual"` while README references `"grouped"` / `"legacy"`. Pick a single set (`inputs_only` default, `mixed_virtual` legacy) and update docs/screenshots accordingly.

### 3.2 Input/mode validation

**Files:** `config.schema.json`, `accessory.js`

- Add JSON schema constraints preventing duplicate `id` or `code` values (unique items) to avoid overlapping `ActiveIdentifier` ranges.
- On boot, validate that user-supplied ADCP command strings exist in the protocol PDF (fail fast with a descriptive log).

### 3.3 Model metadata

**Files:** `accessory.js`

- If `staticModel/staticSerial` aren’t provided, fetch once at startup (already partially done) and cache to disk in `~/.homebridge/persist` so accessories survive projector sleep without timeouts.

---

## 4. Testing, Types & Tooling (Medium Priority)

### 4.1 Jest coverage

**Files:** `package.json`, `__tests__/*`

- Add Jest config with Node env, create mocks for `net.Socket`, and cover:
  - Command queue/debounce behavior.
  - Retry path when the socket drops mid-command.
  - Accessory service building (inputs-only vs mixed layout).
- Wire `npm test` + `npm run test:watch` to CI (GitHub Actions if available).

### 4.2 TypeScript declarations

**Files:** `index.d.ts`, `package.json`

- Publish `.d.ts` mirroring `SonyProjectorConfig` so Homebridge UI plugins and TypeScript Homebridge setups get proper intellisense.

### 4.3 Linting / formatting

**Files:** `eslint.config.mjs`

- Extend lint rules to cover async handler complexity (no floating promises) and run `npm run lint` in CI before release.

---

## 5. Documentation & Release Hygiene (Low Priority)

### 5.1 README overhaul

**Files:** `readme.md`

- Remove duplicated sections, add a **Quick Start** block, and clearly document which controls are actually implemented (volume is not).
- Include a **Compatibility matrix** (tested Sony models, firmware revs) and an **ADCP command table** referencing the bundled PDF.

### 5.2 CHANGELOG discipline

**Files:** `CHANGELOG.md`

- Maintain per-release entries (features, fixes, breaking changes). Tie each entry back to sections in this roadmap so users can see progress.

### 5.3 Release process

**Files:** `publish.sh`

- Once high-priority work ships, bump to `v2.1.0` via `./publish.sh` (select “minor”) and tag the release with notes summarizing ADCP stability + polling improvements.

---

## Suggested Execution Order

1. Command queue & debouncing (1.1)
2. Command constants + discovery fixes (1.2, 1.4)
3. Connection lifecycle events (1.3)
4. Polling/state sync work (2.1–2.3)
5. Config/UX alignment (3.x)
6. Tests + types (4.x)
7. Docs + release polish (5.x)

---

## Implementation Tips

- Follow Homebridge plugin guidance for async handlers (return quickly, never block the event loop) per https://developers.homebridge.io/#/plugins.
- Lean on the Sony ADCP PDF to confirm command names/case; many verbs are case-sensitive and respond with `err_cmd` when mis-capitalized.
- Run `validate-adcp.js` or `discovery.js --port 53595` against a live projector after transport changes.
- Keep an eye on circular references when introducing `adcp-commands.js`.
- Update this document as tasks land so it reflects the current truth.

---
