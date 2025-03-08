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