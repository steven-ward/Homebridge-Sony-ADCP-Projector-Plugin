# homebridge-sony-adcp-projector

Homebridge platform plugin that exposes Sony projectors as HomeKit Television accessories via ADCP (IP control protocol, TCP port 53595).

## Commands

```bash
npm run lint        # ESLint check
npm run lint:fix    # ESLint auto-fix
npm run fmt         # Prettier format
npm run test        # Jest (runs --runInBand — tests are sequential, not parallel)
npm run prepublishOnly  # lint + test + fmt (runs before publish)
bash publish.sh     # Full release: bump semver, update CHANGELOG, git tag, npm publish
```

## Architecture

```
index.js          # Homebridge plugin registration only
platform.js       # SonyProjectorPlatform — HAP Platform class, accessory lifecycle
adcp.js           # ADCP class — TCP connection, auth, command queue, retry logic
adcp-commands.js  # ADCP command catalog (string constants + factory functions)
config.schema.json # Homebridge UI schema (defines what appears in config editor)
```

## Key Gotchas

- **Two queue mechanisms, don't confuse them**: `_pendingCommand` (promise chain in `adcp.js`) serializes execution with 200ms pacing; `commandQueue` (plain array) routes TCP responses to the right promise. They work together.
- **`Promise.all` in `_refreshAllStates` is misleading**: calls still serialize through `_enqueueCommand` — there's no actual parallelism.
- **`version ?` command serves dual duty**: used for both `getFirmwareVersion()` and `getLampHours()` — same wire command, different parsing.
- **All projector state lives in `platform.js`**: `adcp.js` is stateless w.r.t. projector state. Never store projector state in `adcp.js`.
- **TV accessories must be external**: Uses `api.publishExternalAccessories()` — not `registerPlatformAccessories()`. HomeKit requires this for the Television category. Changing this breaks pairing.
- **ADCP default port**: 53595. Configurable via `adcpPort` in config.
- **Auth flow**: When `useAuth` is true, projector sends a nonce; plugin responds with SHA-256(nonce + password). Handled in `adcp.js connect()`.
- **Connection cooldown**: After a failed connection, a 10-second cooldown blocks retries to avoid hammering a powered-off projector. Controlled by `_connectionCooldownMs`.
- **Command pacing**: 200ms debounce between commands (`debounceMs`). Don't remove — projector drops commands sent too fast.
- **`.tgz` files in repo root**: Packed release archives. Never edit or commit these manually — `publish.sh` manages them.

## Known Bugs (unfixed)

- **Missing command constants** (`adcp-commands.js`): `adcp.js` references `MODEL_QUERY`, `SERIAL_QUERY`, `IPV4_ADDRESS`, `IPV4_NETWORK_SETTING` — none exist in the catalog. Sends literal `"undefined\r\n"` to projector on startup; fails silently. Fix: add aliases in `adcp-commands.js`.
- **`enableHdrSelector` default mismatch**: `platform.js` uses `?? false` but `config.schema.json` defaults to `true` — HDR switches are off by default in practice. Fix: change to `?? true` at `platform.js:132`.
- **`currentInput` never polled**: physical remote input changes don't sync to HomeKit. No `_refreshActiveIdentifier()` in polling loop.
- **`npm test` passes vacuously**: no test files exist; Jest finds nothing and exits 0. `prepublishOnly` provides no real coverage guarantee.

## Release Workflow

```bash
bash publish.sh
```

Interactive — prompts for patch/minor/major bump, handles CHANGELOG.md update, git commit + tag, npm publish, and push. Requires npm 2FA OTP if account has it enabled.

## Config Schema

`config.schema.json` drives the Homebridge UI config editor. Required fields: `ip`. Optional: `adcpPort`, `useAuth`, `password`, `timeout`, `inputs[]`.
