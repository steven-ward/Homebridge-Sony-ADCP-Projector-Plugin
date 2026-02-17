# Changelog

## v2.3.1 – 2026-02-17

- fix: include README.md and CHANGELOG.md in npm package (7315ede)
- chore: remove internal files from git tracking, fix types and schema (62e9cc9)
- fix: prevent polling from overriding Active during power transitions (8417475)
- docs: update README for v2.3.0 platform plugin architecture (90bf12b)
- fix: remove self-referential dependency from package.json (253235e)

[Compare changes](https://github.com/steven-ward/Homebridge-Sony-ADCP-Projector-Plugin/compare/v2.3.0...v2.3.1)

## v2.3.0 – 2026-02-17

### Added

- `CurrentMediaState` / `TargetMediaState` characteristics on TV service — projector now shows warm-up (LOADING) and cool-down (INTERRUPTED) states in HomeKit during power transitions, then settles to PLAY/STOP
- Background 30-second post-power poll to track warm-up / cool-down completion
- Remote key support for REWIND, FAST_FORWARD, NEXT_TRACK, PREVIOUS_TRACK
- ADCP command constants: `MODEL_QUERY`, `SERIAL_QUERY`, `IPV4_ADDRESS`, `IPV4_NETWORK_SETTING`
- Test infrastructure: `adcp.test.js` (44 tests), `adcp-commands.test.js` (30 tests), `tests/helpers/`
- `_refreshActiveIdentifier()` — polling now syncs active input from projector to HomeKit
- `.gitignore` (was missing — `.tgz` archives and log files were untracked)

### Fixed

- `Brightness` service `On.onSet` was accidentally calling `setPowerState`; now a no-op (matches `Contrast` behaviour)
- `powerState` now resets to `false` and pushes `Active = 0` to HomeKit when ADCP socket disconnects
- `VolumeControlType` changed from `ABSOLUTE` to `NONE` — projector has no volume control
- `getContrast()` now uses `ADCP_COMMANDS.CONTRAST_QUERY` instead of hardcoded string
- `enableHdrSelector` default corrected from `false` to `true`
- ESLint config: removed incorrect `eslint-plugin-react` dependency, added Node + Jest globals
- Removed unused `ADCP_COMMANDS` import and `PLATFORM_NAME` constant from `platform.js`

---

## v2.1.0 – 2025-12-07

### Breaking Changes

- **Converted from accessory to platform plugin** - Required for proper TV icon in HomeKit
- You must remove the old accessory config and add a new platform config
- The projector will appear as a new accessory and need to be re-added to HomeKit

### Added

- Publishes as external accessory with `TELEVISION` category (proper TV icon in Home app)
- New `platform.js` architecture for proper TV accessory support

### Fixed

- Added missing `_beginPowerTransition` and `_completePowerTransition` methods
- Fixed Blank Screen switch `onGet` handler blocking on network calls
- Added 10-second connection cooldown after failures to prevent hammering offline projectors

---

## v2.0.3 – 2025-12-07

### Fixed

- Added missing `_beginPowerTransition` and `_completePowerTransition` methods that caused runtime errors
- Fixed Blank Screen switch `onGet` handler blocking on network calls (caused "slow to respond" warnings)
- Added 10-second connection cooldown after failures to prevent hammering offline projectors
- Changed connection/socket error logging from `error` to `warn` level for cleaner logs

## v2.0.x (legacy) – 2025-12-07

### Added

- Command queue with debouncing to prevent ADCP overloads plus centralized `adcp-commands.js` constants.
- Connection lifecycle events (connect/auth/disconnect/error) exposed to the accessory and surfaced via logging.
- Background polling with configurable interval, on-device telemetry refresh (power/input/brightness/error/lamp).
- HomeKit UI layout alignment, input/mode validation, and metadata persistence across restarts.
- TypeScript definitions (`index.d.ts`) and GitHub Actions CI (Node 18/20/22) running lint + Jest.
- Quick Start, compatibility matrix, ADCP cheat sheet, and troubleshooting table in `README.md`.

### Changed

- HomeKit Television service now reports warm-up/cool-down states via media characteristics for better UX.
- Package scripts now run strict lint/test (no `|| true`) so CI failures surface correctly.

### Fixed

- Error & lamp sensors now cache last values and refresh silently during polling to avoid stale states.

## v2.0.0 – 2025-08-10

- feat: Add publish script for Homebridge Sony ADCP Projector (529c70f)
- feat: Update config schema and add input source management for Sony projectors (f793bc6)
- Additional updates (32c105a)
- Added additional debug code. (f076ebf)
- version update (1916adc)
- Modified (23d4ae9)
- Modifications (83a7d62)
- Minor fixes (573e5e1)
- Modified accessory.js to stop crash when no serial returned (4064fc8)
- Removed lint (992313d)
- Removed jest (4a27c0d)
- Updated version to 1.1.0 (014f437)
- feat: Enhance ADCP projector plugin with improved control and configuration (d1761dd)
- Updated version (5504245)
- Added config for connection timeout setting. Updated the default port. (bb4d0f4)
- Fixes (70c14fa)
- Fixed package.json dependencies (dfb3582)
- Version Updated (170bf9f)
- Made corrections (ee89515)
- Modified dependency config per homebridge Removed SNMP Corrected default port setting for adcp (107b3a0)
- Version updated (723d5cb)
- Removed SNMP reference (29a2210)
- Regenerated package.json (7a36bfa)
- Updated github url (153430c)
- Initial commit (8c329cc)
