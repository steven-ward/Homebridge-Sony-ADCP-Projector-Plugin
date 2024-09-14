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

## Installation

1. **Install Homebridge** (if not already installed):

   ```bash
   sudo npm install -g homebridge