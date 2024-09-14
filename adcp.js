// adcp.js

const net = require('net');

class ADCP {
  constructor(ip, port, username, password, log, useAuth = true) {
    this.ip = ip;
    this.port = port;
    this.username = username;
    this.password = password;
    this.log = log;
    this.useAuth = useAuth;

    this.client = null;            // TCP client socket
    this.isAuthenticated = false;  // Authentication state
    this.commandQueue = [];        // Queue for pending commands
    this.responseBuffer = '';      // Buffer for incoming data
    this.isConnecting = false;     // Connection state
  }

  // Establish connection and authenticate if necessary
  async connect() {
    if (this.client && !this.client.destroyed) {
      return; // Already connected
    }

    if (this.isConnecting) {
      // Wait until the connection is established
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.isConnecting) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.client = new net.Socket();

      this.client.connect(this.port, this.ip, async () => {
        this.log.debug('Connected to projector');
        try {
          if (this.useAuth) {
            await this.authenticate();
            this.isAuthenticated = true;
          }
          this.isConnecting = false;
          resolve();
        } catch (error) {
          this.log.error('Authentication failed:', error);
          this.disconnect();
          this.isConnecting = false;
          reject(error);
        }
      });

      this.client.on('data', (data) => this.handleData(data));

      this.client.on('error', (error) => {
        this.log.error('Socket error:', error);
        this.disconnect();
      });

      this.client.on('close', () => {
        this.log.debug('Connection closed');
        this.isAuthenticated = false;
        this.client = null;
      });
    });
  }

  // Disconnect the socket
  disconnect() {
    if (this.client && !this.client.destroyed) {
      this.client.destroy();
    }
    this.client = null;
    this.isAuthenticated = false;
  }

  // Handle incoming data
  handleData(data) {
    this.responseBuffer += data.toString();

    // Check for command completion (e.g., newline character)
    if (this.responseBuffer.endsWith('\r\n') || this.responseBuffer.endsWith('> ')) {
      const response = this.responseBuffer.trim();
      this.responseBuffer = '';

      if (this.commandQueue.length > 0) {
        const { resolve } = this.commandQueue.shift();
        resolve(response);
      }
    }
  }

  // Authenticate with the projector
  authenticate() {
    return new Promise((resolve, reject) => {
      const onData = (data) => {
        const message = data.toString();

        if (message.includes('Password:')) {
          this.log.debug('Password requested');
          this.client.write(`${this.password}\r\n`);
        } else if (message.includes('Login successful') || message.includes('> ')) {
          this.log.debug('Authenticated successfully');
          this.client.removeListener('data', onData);
          resolve();
        } else if (message.includes('Login incorrect')) {
          this.log.error('Authentication failed');
          this.client.removeListener('data', onData);
          reject(new Error('Authentication failed'));
        } else {
          // Handle any other authentication messages
          this.log.debug('Authentication response:', message);
        }
      };

      this.client.on('data', onData);

      // Send username
      this.client.write(`${this.username}\r\n`);
    });
  }

  // Send a command and receive the response
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.client || this.client.destroyed) {
        reject(new Error('Socket is not connected'));
        return;
      }

      this.commandQueue.push({ resolve, reject });

      // Send command with proper line ending
      this.client.write(`${command}\r\n`);
    });
  }

  // Execute a command, ensuring connection and authentication
  async executeCommand(command) {
    try {
      await this.connect();
      const response = await this.sendCommand(command);
      this.log.debug(`Command executed: ${command}, Response: ${response}`);
      return response;
    } catch (error) {
      this.log.error('Failed to execute command:', error);
      throw error;
    }
  }

  // Power Commands
  async getPowerState() {
    const command = 'power_status ?';
    const response = await this.executeCommand(command);
    // Parse the response according to the projector's protocol
    return response.toLowerCase().includes('on');
  }

  async setPowerState(state) {
    const command = `power ${state ? 'on' : 'off'}`;
    const response = await this.executeCommand(command);
    return response;
  }

  // Network Settings
  async startNetworkSettings() {
    const command = 'ipv4_network_setting start';
    await this.executeCommand(command);
  }

  async applyNetworkSettings() {
    const command = 'ipv4_network_setting apply';
    await this.executeCommand(command);
  }

  async setIPv4Address(ipAddress, subnetMask, gateway) {
    await this.executeCommand(`ipv4_ip_address ${ipAddress}`);
    await this.executeCommand(`ipv4_sub_net_mask ${subnetMask}`);
    await this.executeCommand(`ipv4_default_gateway ${gateway}`);
    await this.applyNetworkSettings();
  }

  // Input Selection
  async setInput(input) {
    const command = `input ${input}`;
    await this.executeCommand(command);
  }

  // Volume and Mute
  async muteAudio(state) {
    const command = `muting ${state ? 'on' : 'off'}`;
    await this.executeCommand(command);
  }

  async setVolume(level) {
    const command = `volume ${level}`;
    await this.executeCommand(command);
  }

  // Image Quality Settings
  async setBrightness(level) {
    const command = `brightness ${level}`;
    await this.executeCommand(command);
  }

  async setContrast(level) {
    const command = `contrast ${level}`;
    await this.executeCommand(command);
  }

  async setPictureMode(mode) {
    const command = `picture_mode ${mode}`;
    await this.executeCommand(command);
  }

  // Display Settings
  async setAspectRatio(aspectRatio) {
    const command = `aspect ${aspectRatio}`;
    await this.executeCommand(command);
  }

  async setScreenPosition(position) {
    const command = `v_center ${position}`;
    await this.executeCommand(command);
  }

  async setScreenSize(size) {
    const command = `v_size ${size}`;
    await this.executeCommand(command);
  }

  async setOverscan(state) {
    const command = `overscan ${state ? 'on' : 'off'}`;
    await this.executeCommand(command);
  }

  // Freeze Command
  async freeze(state) {
    const command = `freeze ${state ? 'on' : 'off'}`;
    await this.executeCommand(command);
  }

  // Split Screen
  async setImageSplit(mode) {
    const command = `image_split ${mode}`;
    await this.executeCommand(command);
  }

  // Shutdown method to clean up resources
  shutdown() {
    this.disconnect();
  }
}

module.exports = ADCP;