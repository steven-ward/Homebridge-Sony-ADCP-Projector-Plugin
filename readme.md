# Homebridge Sony ADCP Projector Plugin

A Homebridge plugin to control Sony VPL-XW5000ES projector using the ADCP protocol over IP.

## Features

- **Power Control**: Turn the projector on or off via HomeKit.
- **Input Selection**: Switch between different input sources (e.g., HDMI1, HDMI2).
- **Volume and Mute Control**: Adjust volume and mute/unmute audio.
- **Image Quality Settings**: Adjust brightness, contrast, and picture mode.
- **Display Settings**: Change aspect ratio, screen position, and screen size.
- **Freeze and Split Screen**: Control freeze function and split-screen mode.
- **Authentication Support**: Authenticate with the projector if required.
- **Persistent Connection**: Efficient communication with the projector using a persistent TCP/IP connection.
- **Robust Error Handling**: Handles network errors, timeouts, and disconnections gracefully.
- **Logging**: Detailed logs for troubleshooting and monitoring.
- **Error & Warning Status Monitoring**: Monitor the projector's error and warning statuses.
- **Network Configuration Support**: Configure network settings for the projector.
- **Improved Logging & Debugging**: Enhanced logging features for better debugging.
- **Automatic Serial Number Retrieval**: Automatically retrieve the projector's serial number.

## Installation

1. **Install Homebridge** (if not already installed):

   ```bash
   sudo npm install -g homebridge
   ```

## Configuration

The plugin requires a configuration in JSON format. The following fields are required:

- `adcpPort`: The port used for ADCP communication.
- Updated logging options.

## Usage

To change inputs, use the HomeKit interface to select the desired input source. To adjust picture settings, access the respective settings in the HomeKit app. You can retrieve the projector status via the Homebridge interface.

## Troubleshooting

Common issues include authentication errors and network connectivity problems. Ensure that the projector is on the same network and that the correct authentication details are provided.
# Homebridge Sony ADCP Projector

[![npm](https://img.shields.io/npm/v/homebridge-sony-adcp-projector)](https://www.npmjs.com/package/homebridge-sony-adcp-projector)
[![Homebridge Verified](https://img.shields.io/badge/homebridge-verified-brightgreen)](https://homebridge.io)

Control your Sony projector over IP using the ADCP protocol. This plugin exposes the projector to Apple HomeKit as a **Television** accessory, complete with power control, input selection, and the native Remote UI in the Home app.

---

## Features

### Core
- **Power On / Off** from the Home app.
- **Input Source Selection** (HDMI1, HDMI2, etc.).
- **HomeKit Television UI** with remote control support.
- Optional **ADCP Authentication**.
- **Automatic Serial Number Retrieval**.

### Optional Controls *(model-dependent)*
- Volume and mute.
- Brightness, contrast, picture mode.
- Aspect ratio, screen position, screen size.
- Freeze and split screen.

### Other
- Persistent TCP/IP connection.
- Error & warning status monitoring.
- Detailed logging for troubleshooting.

---

## Requirements
- Node.js >= 18.20.0
- Homebridge >= 1.6.0
- A Sony projector with **ADCP** enabled (Settings > Network Settings > ADCP)
- The projector’s IP address (reserve it via DHCP for stability)
- Default ADCP port: **53595**

---

## Installation

```bash
sudo npm install -g homebridge
sudo npm install -g homebridge-sony-adcp-projector
```

---

## Configuration

Use the Homebridge UI to configure the plugin via the graphical settings editor. The most important fields:

| Field              | Type    | Default | Description |
|--------------------|---------|---------|-------------|
| `ip`               | string  | —       | Projector IP address (required). |
| `adcpPort`         | integer | 53595   | TCP port for ADCP. |
| `useAuth`          | boolean | false   | Whether ADCP authentication is required. |
| `password`         | string  | —       | Password for ADCP authentication (if enabled). |
| `timeout`          | integer | 5       | Timeout in seconds for commands. |
| `inputs`           | array   | HDMI 1, HDMI 2 | Inputs to appear in HomeKit. |

Example JSON config:
```json
{
  "accessories": [
    {
      "accessory": "SonyProjector",
      "name": "Sony Projector",
      "ip": "192.168.1.101",
      "adcpPort": 53595,
      "useAuth": false,
      "timeout": 5,
      "inputs": [
        { "id": 1, "name": "Apple TV", "adcp": "hdmi1" },
        { "id": 2, "name": "PS5", "adcp": "hdmi2" }
      ]
    }
  ]
}
```

---

## Usage

Once added to HomeKit:
- **Single tap** the TV tile to toggle power.
- **Long press** to open remote controls, input selector, and settings.
- Select inputs from the list defined in your config.

---

## Troubleshooting

- **No response / offline** → Verify ADCP is enabled and the IP/port are correct.
- **Authentication errors** → Ensure projector’s ADCP settings match the plugin config.
- **Slow commands** → Increase `timeout` in plugin settings.

---

## Development

Clone the repo and link it to a local Homebridge instance:
```bash
git clone https://github.com/steven-ward/Homebridge-Sony-ADCP-Projector-Plugin.git
cd Homebridge-Sony-ADCP-Projector-Plugin
npm install
npm link
homebridge -D -P .
```

---

## License
[MIT](LICENSE)