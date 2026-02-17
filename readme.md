# Homebridge Sony ADCP Projector Plugin

[![npm](https://img.shields.io/npm/v/homebridge-sony-adcp-projector)](https://www.npmjs.com/package/homebridge-sony-adcp-projector)
[![Downloads](https://img.shields.io/npm/dm/homebridge-sony-adcp-projector)](https://www.npmjs.com/package/homebridge-sony-adcp-projector)

Control Sony projectors that expose the ADCP (Advanced Display Control Protocol) interface directly from Apple HomeKit. The plugin registers as a native **Television** service so you get power, inputs, remote controls, and warm-up/cool-down state feedback in the Home app, plus optional extras (picture modes, brightness, sensors).

---

## Quick Start

```bash
# 1. Install Homebridge (skip if already running)
sudo npm install -g homebridge

# 2. Install the plugin
sudo npm install -g homebridge-sony-adcp-projector

# 3. Enable ADCP on the projector
#   Settings → Network Settings → ADCP → Enable (port: 53595)

# 4. Add the platform in Homebridge UI (see Configuration below)
# 5. Restart Homebridge
```

> **Upgrading from v2.0.x?** The plugin changed from an `accessory` to a `platform` in v2.1.0. You must migrate your config (see [Configuration](#configuration-overview)), remove the old accessory from HomeKit, and re-pair.

---

## Features

| Area              | Details                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Power & Inputs    | Native TV tile with Siri, automations, and remote control support                           |
| Warm-up/Cool-down | Home app shows loading state while projector warms up, then settles to playing or stopped   |
| Remote Keys       | Arrow, Select, Back, Exit, Play/Pause, Rewind, Fast Forward, Next, Previous                 |
| Picture / HDR     | Picture Mode, HDR Mode, Test Pattern selectors (virtual inputs or dedicated switches)       |
| Brightness        | Lightbulb slider that maps to projector brightness                                          |
| Contrast          | Lightbulb slider that maps to projector contrast                                            |
| Sensors           | Error warning indicator + Lamp/Laser hours readout                                          |
| Reliability       | Debounced ADCP command queue, 10s connection cooldown, background polling, auto-retry       |
| Tooling           | Config schema for Homebridge UI, TypeScript definitions, Jest test suite, GitHub Actions CI |

---

## Compatibility

### Tested Models

| Model        | Status         | Notes                                            |
| ------------ | -------------- | ------------------------------------------------ |
| VPL‑XW5000ES | ✅             | Full regression tested                           |
| VPL‑XW7000ES | ✅ (community) | Reported working with identical ADCP command set |

> Any Sony projector with ADCP enabled should work, but commands can vary by firmware.

### Requirements

- Node.js **18.20+** (or 20/22)
- Homebridge **1.11+**
- Projector reachable over IP with ADCP enabled
- Default ADCP port: **53595** (adjust if changed in the projector menu)

---

## Configuration Overview

The Homebridge UI config editor exposes the full schema. Key fields:

| Field                                      | Type             | Default         | Description                                                                            |
| ------------------------------------------ | ---------------- | --------------- | -------------------------------------------------------------------------------------- |
| `ip`                                       | string           | —               | Projector IP (required)                                                                |
| `adcpPort`                                 | integer          | 53595           | ADCP TCP port                                                                          |
| `useAuth` / `password`                     | boolean / string | false / —       | Enable if ADCP "Requires Authentication" is ON                                         |
| `inputs`                                   | array            | HDMI1/2         | Inputs shown in HomeKit (unique IDs)                                                   |
| `enableBrightness`                         | boolean          | true            | Add Lightbulb service for brightness                                                   |
| `enableContrast`                           | boolean          | false           | Add Lightbulb service for contrast                                                     |
| `enableHdrSelector`                        | boolean          | true            | Surface HDR modes                                                                      |
| `enableTestPatterns`                       | boolean          | false           | Surface test patterns                                                                  |
| `enableLampHours`                          | boolean          | true            | Show lamp-hour sensor                                                                  |
| `pictureModes`, `hdrModes`, `testPatterns` | arrays           | presets         | Name/code pairs for virtual banks                                                      |
| `uiLayout`                                 | string           | `"inputs_only"` | `inputs_only` → HDMI in selector, modes as switches; `mixed_virtual` → all in selector |
| `enablePolling` / `pollingInterval`        | boolean / int    | true / 30       | Background state sync cadence (seconds)                                                |
| `logging`                                  | string           | `"standard"`    | `"none"`, `"standard"`, or `"debug"`                                                   |

Example platform config (`~/.homebridge/config.json`):

```json
{
  "platforms": [
    {
      "platform": "SonyProjector",
      "name": "Cinema Room",
      "ip": "192.168.1.50",
      "adcpPort": 53595,
      "inputs": [
        { "id": 1, "name": "Apple TV", "adcp": "hdmi1" },
        { "id": 2, "name": "PS5", "adcp": "hdmi2" }
      ],
      "enableBrightness": true,
      "enableLampHours": true,
      "pictureModes": [
        { "name": "Cinema", "code": "cinema_film_1" },
        { "name": "Game", "code": "game" }
      ],
      "uiLayout": "inputs_only",
      "pollingInterval": 45
    }
  ]
}
```

---

## ADCP Protocol Reference (Common Commands)

| Command                        | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| `power "on"` / `"off"`         | Power control                                       |
| `power_status ?`               | Read power state (`"on"`, `"standby"`, `"cooling"`) |
| `input "hdmi1"`                | Switch input                                        |
| `input ?`                      | Query current input                                 |
| `picture_mode "cinema_film_1"` | Set picture mode                                    |
| `picture_mode ?`               | Query picture mode                                  |
| `hdr "auto"` / `"off"`         | Set HDR mode                                        |
| `brightness 50`                | Set brightness (0–100)                              |
| `brightness ?`                 | Query brightness                                    |
| `contrast 75`                  | Set contrast (0–100)                                |
| `blank "on"` / `"off"`         | Video mute (Blank Screen)                           |
| `version ?`                    | Firmware version + lamp/laser hours                 |
| `error ?`                      | Error status                                        |
| `key "up"` / `"down"` etc.     | Remote key presses                                  |

---

## Usage Tips

- **Single tap** the TV tile to toggle power. The Home app shows a loading indicator while the projector warms up (~30s) and a stopped state when it cools down.
- **Long press** to access inputs, brightness, and remote keys.
- In `inputs_only` layout, picture/HDR/test pattern toggles appear as exclusive switch groups alongside the HDMI selector.
- Remote keys supported: arrows, select, back, exit, play/pause, rewind, fast-forward, next, previous.

If HomeKit shows a house icon instead of a TV icon, remove and re-add the accessory after upgrading — the Television service requires external accessory publishing which changes the pairing signature.

---

## Troubleshooting

| Symptom                             | Fix                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| "No Response" / offline             | Confirm projector IP + ADCP port, ensure it's awake, check polling interval                |
| Authentication failures             | Verify ADCP password (Settings → Network → ADCP) and that `useAuth` matches the projector  |
| Commands lag or first request fails | Debounce + retry are built-in; ensure Homebridge host can reach projector with low latency |
| Sensor data stale                   | Polling runs every 30s by default; adjust `pollingInterval` or refresh manually in Home    |
| TV tile gone after update           | Config changed from `accessories` to `platforms` — re-add using platform config format     |

Enable `logging: "debug"` for verbose ADCP traces in Homebridge logs.

---

## Development

```bash
git clone https://github.com/steven-ward/Homebridge-Sony-ADCP-Projector-Plugin.git
cd Homebridge-Sony-ADCP-Projector-Plugin
npm install
npm run lint    # ESLint
npm run test    # Jest (74 tests, runs --runInBand)
npm run fmt     # Prettier
```

CI (GitHub Actions) runs lint + Jest on Node 18/20/22. TypeScript definitions (`index.d.ts`) ship with the package for better editor support.

---

## License

[MIT](LICENSE)
