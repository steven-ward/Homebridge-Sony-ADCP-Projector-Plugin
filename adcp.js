// adcp.js

const net = require('net');

class ADCP {
  constructor(ip, port, username, password, log, useAuth = true, timeout = 60000) {
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
    this.connectionTimeout = timeout; // Use the configurable timeout for connection
    this.commandTimeout = timeout;    // Use the configurable timeout for commands
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

      const connectionTimer = setTimeout(() => {
        this.log.error('Connection timeout');
        this.disconnect();
        this.isConnecting = false;
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      this.client.connect(this.port, this.ip, async () => {
        clearTimeout(connectionTimer);
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
        clearTimeout(connectionTimer);
        this.log.error('Socket error:', error);
        this.disconnect();
        reject(error);
      });

      this.client.on('close', () => {
        clearTimeout(connectionTimer);
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
      const authTimer = setTimeout(() => {
        this.log.error('Authentication timeout');
        this.disconnect();
        reject(new Error('Authentication timeout'));
      }, this.commandTimeout);

      const onData = (data) => {
        const message = data.toString();

        if (message.includes('Password:')) {
          this.log.debug('Password requested');
          this.client.write(`${this.password}\r\n`);
        } else if (message.includes('Login successful') || message.includes('> ')) {
          this.log.debug('Authenticated successfully');
          this.client.removeListener('data', onData);
          clearTimeout(authTimer);
          resolve();
        } else if (message.includes('Login incorrect')) {
          this.log.error('Authentication failed');
          this.client.removeListener('data', onData);
          clearTimeout(authTimer);
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

      const commandTimer = setTimeout(() => {
        this.log.error('Command timeout');
        this.disconnect();
        reject(new Error('Command timeout'));
      }, this.commandTimeout);

      this.commandQueue.push({
        resolve: (response) => {
          clearTimeout(commandTimer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(commandTimer);
          reject(error);
        },
      });

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
    try {
      const command = 'power_status ?';
      const response = await this.executeCommand(command);
      // Parse the response according to the projector's protocol
      return response.toLowerCase().includes('on');
    } catch (error) {
      this.log.error('Error getting power state:', error);
      throw error;
    }
  }

  async setPowerState(state) {
    try {
      const command = `power ${state ? 'on' : 'off'}`;
      const response = await this.executeCommand(command);
      return response;
    } catch (error) {
      this.log.error('Error setting power state:', error);
      throw error;
    }
  }

  // Shutdown method to clean up resources
  shutdown() {
    this.disconnect();
  }
}

module.exports = ADCP;