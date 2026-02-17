# Homebridge Sony ADCP Projector Plugin

[![npm](https://img.shields.io/npm/v/homebridge-sony-adcp-projector)](https://www.npmjs.com/package/homebridge-sony-adcp-projector)
[![Downloads](https://img.shields.io/npm/dm/homebridge-sony-adcp-projector)](https://www.npmjs.com/package/homebridge-sony-adcp-projector)

Control Sony projectors that expose the ADCP (Advanced Display Control Protocol) interface directly from Apple HomeKit. The accessory registers as a native **Television** service so you get power, inputs, and remote controls in the Home app plus optional extras (modes, brightness, sensors).

---

## Quick Start

```bash
# 1. Install Homebridge (skip if already running)
sudo npm install -g homebridge

# 2. Install the plugin
sudo npm install -g homebridge-sony-adcp-projector

# 3. Enable ADCP on the projector
#   Settings → Network Settings → ADCP → Enable (port: 53595)

# 4. Add accessory in the Homebridge UI with your projector IP
# 5. Restart Homebridge
```

---

## Features

| Area           | Details                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| Power & Inputs | Native TV tile with Siri, automations, and remote control support                     |
| Picture / HDR  | Picture Mode, HDR Mode, Test Pattern selectors (virtual inputs or dedicated switches) |
| Brightness     | Lightbulb slider that maps to projector brightness                                    |
| Sensors        | Error warning indicator + Lamp/Laser hours readout                                    |
| Reliability    | Debounced ADCP command queue, background polling, connection lifecycle logging        |
| Tooling        | Config schema for Homebridge UI, TypeScript definitions, Jest-ready CI workflow       |

---

## Compatibility

### Tested Models

| Model        | Status         | Notes                                            |
| ------------ | -------------- | ------------------------------------------------ |
| VPL‑XW5000ES | ✅             | Full regression tested                           |
| VPL‑XW7000ES | ✅ (community) | Reported working with identical ADCP command set |

> Any Sony projector with ADCP enabled should work, but commands can vary. Refer to the protocol PDF included in this repo.

### Requirements

- Node.js **18.20+** (or 20/22)
- Homebridge **1.11+**
- Projector reachable over IP with ADCP enabled
- Default ADCP port: **53595** (adjust if changed in the projector)

---

## Configuration Overview

The Homebridge UI config editor exposes the full schema. Key fields:

| Field                                      | Type              | Default         | Description                                                                            |
| ------------------------------------------ | ----------------- | --------------- | -------------------------------------------------------------------------------------- |
| `ip`                                       | string            | —               | Projector IP (required)                                                                |
| `adcpPort`                                 | integer           | 53595           | ADCP TCP port                                                                          |
| `useAuth` / `password`                     | boolean / string  | false / —       | Enable if ADCP “Requires Authentication” is ON                                         |
| `inputs`                                   | array             | HDMI1/2         | Inputs shown in HomeKit (unique IDs)                                                   |
| `enableBrightness`                         | boolean           | true            | Add Lightbulb service for brightness                                                   |
| `enableHdrSelector`                        | boolean           | true            | Surface HDR modes                                                                      |
| `enableTestPatterns`                       | boolean           | false           | Surface test patterns                                                                  |
| `enableLampHoursSensor`                    | boolean           | true            | Show lamp-hour sensor                                                                  |
| `pictureModes`, `hdrModes`, `testPatterns` | arrays            | presets         | Name/code pairs for virtual banks                                                      |
| `uiLayout`                                 | string            | `"inputs_only"` | `inputs_only` → HDMI in selector, modes as switches; `mixed_virtual` → all in selector |
| `enablePolling` / `pollingInterval`        | boolean / integer | true / 30       | Background state sync cadence (seconds)                                                |
| `logging`                                  | string            | `"standard"`    | `"none"`, `"standard"`, or `"debug"`                                                   |

Example:

```json
{
  "accessories": [
    {
      "accessory": "SonyProjector",
      "name": "Cinema Room",
      "ip": "192.168.1.50",
      "adcpPort": 53595,
      "inputs": [
        { "id": 1, "name": "Apple TV", "adcp": "hdmi1" },
        { "id": 2, "name": "PS5", "adcp": "hdmi2" }
      ],
      "enableBrightness": true,
      "enableLampHoursSensor": true,
      "pictureModes": [
        { "name": "Cinema", "code": 1 },
        { "name": "Game", "code": 3 }
      ],
      "uiLayout": "inputs_only",
      "pollingInterval": 45
    }
  ]
}
```

---

## ADCP Protocol Reference (Common Commands)

| Command                | Description                                   |
| ---------------------- | --------------------------------------------- |
| `power "on"` / `"off"` | Power control                                 |
| `power_status ?`       | Read power state (`on`, `standby`, `cooling`) |
| `input "hdmi1"`        | Switch input                                  |
| `pmod <code>`          | Picture mode                                  |
| `hdrv <code>`          | HDR mode                                      |
| `brit <0-100>`         | Brightness                                    |
| `mute 0/1`             | Video mute (Blank Screen)                     |
| `lamp ?`               | Lamp/laser hours                              |
| `erst ?`               | Error code                                    |

> The full Sony PDF lives in `docs/Sony_ADCP_Supported_Commands.pdf` inside this repo. Use it for additional picture, geometry, or network commands.

---

## Usage Tips

- **Single tap** the TV tile to toggle power.
- **Long press** to access inputs, brightness, and remote keys.
- In `inputs_only` layout, picture/HDR/test pattern toggles appear as exclusive switch groups for quick access without cluttering the TV selector.

If HomeKit shows a house icon instead of a TV icon, remove and re-add the accessory after upgrading—the service signature changed with the Television profile.

---

## Troubleshooting

| Symptom                             | Fix                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| “No Response” / offline             | Confirm projector IP + ADCP port, ensure it’s awake, and check polling interval            |
| Authentication failures             | Verify ADCP password (Settings → Network → ADCP) and that `useAuth` matches the projector  |
| Commands lag or first request fails | Debounce + retry are built-in; ensure Homebridge host can reach projector with low latency |
| Sensor data stale                   | Increase polling interval (default 30s) or manually refresh in Home app                    |

Enable `logging: "debug"` for verbose ADCP traces in Homebridge logs.

---

## Development

```bash
git clone https://github.com/steven-ward/Homebridge-Sony-ADCP-Projector-Plugin.git
cd Homebridge-Sony-ADCP-Projector-Plugin
npm install
npm run lint
npm run test
```

CI (GitHub Actions) runs lint + Jest on Node 18/20/22. TypeScript definitions (`index.d.ts`) ship with the package for better editor support.

---

## License

[MIT](LICENSE)
