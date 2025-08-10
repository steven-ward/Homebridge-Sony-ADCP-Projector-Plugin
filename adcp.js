const net = require('net');
const crypto = require('crypto');

class ADCP {
  /**
   * @param {string} ip
   * @param {number} port
   * @param {string|undefined} username  // not used by ADCP, kept for backwards compat
   * @param {string|undefined} password  // ADCP password (if auth enabled)
   * @param {object} log                 // homebridge logger
   * @param {boolean} useAuth            // projector ADCP "Requires Authentication"
   * @param {number} timeout             // base timeout in ms
   */
  constructor(ip, port = 53595, username, password, log, useAuth = false, timeout = 5000) {
    this.ip = ip;
    this.port = port;
    this.username = username;
    this.password = password || '';
    this.log = log;
    this.useAuth = useAuth;

    this.client = null;            // TCP client socket
    this.isAuthenticated = false;  // Authentication state
    this.commandQueue = [];        // Queue for pending commands
    this.responseBuffer = '';      // Buffer for incoming data
    this.isConnecting = false;     // Connection state
    this.connectionTimeout = timeout; // Connection timeout
    this.commandTimeout = timeout;    // Per-command timeout

    // Debug helper (off by default; can be enabled via setDebug(true))
    this.debugEnabled = false;
    this.debug = () => {};
  }

  // Enable or disable verbose debug logs from this ADCP client
  setDebug(enabled) {
    this.debugEnabled = !!enabled;
    this.debug = (this.debugEnabled && this.log && this.log.debug)
      ? this.log.debug.bind(this.log)
      : () => {};
  }

  // Establish connection and authenticate if necessary
  async connect() {
    if (this.client && !this.client.destroyed) {
      return; // already connected
    }

    if (this.isConnecting) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!this.isConnecting) { clearInterval(check); resolve(); }
        }, 50);
      });
      return;
    }

    this.isConnecting = true;
    this.client = new net.Socket();

    return new Promise((resolve, reject) => {
      const connectionTimer = setTimeout(() => {
        this.log.error(`⚠️ Connection timeout: ${this.ip}:${this.port}`);
        this.disconnect();
        this.isConnecting = false;
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      // Common handlers
      this.client.on('error', (error) => {
        clearTimeout(connectionTimer);
        this.log.error(`❌ Socket error: ${error.message}`);
        this.disconnect();
        reject(error);
      });

      this.client.on('close', () => {
        this.log.warn('⚠️ Connection closed by the projector.');
        this.isAuthenticated = false;
        this.client = null;
      });

      this.client.connect(this.port, this.ip, async () => {
        clearTimeout(connectionTimer);
        try {
          // Attach data handler now; it won't resolve anything until a command is queued
          this.client.on('data', (data) => this.handleData(data));
          // Improve stability on idling projectors
          try { this.client.setKeepAlive(true, 15000); } catch (e) { /* noop */ }

          if (this.useAuth) {
            await this.authenticate();
            this.debug('✅ ADCP authentication successful.');
          } else {
            // Drain an initial NOKEY if projector sends it (no-auth mode)
            this.isAuthenticated = true;
          }

          this.debug('ADCP connected');
          this.isConnecting = false;
          resolve();
        } catch (error) {
          this.log.error(`❌ Authentication failed: ${error.message}`);
          this.disconnect();
          this.isConnecting = false;
          reject(error);
        }
      });
    });
  }

  // Disconnect the socket
  disconnect() {
    if (this.client && !this.client.destroyed) {
      try { this.client.destroy(); } catch (e) { /* noop */ }
    }
    this.client = null;
    this.isAuthenticated = false;
    this.commandQueue = [];
    this.responseBuffer = '';
    this.isConnecting = false;
  }

  // Handle incoming data (CRLF-delimited lines)
  handleData(data) {
    this.responseBuffer += data.toString('utf8');

    let idx;
    while ((idx = this.responseBuffer.indexOf('\r\n')) !== -1) {
      const line = this.responseBuffer.slice(0, idx).trim();
      this.responseBuffer = this.responseBuffer.slice(idx + 2);

      // Ignore ADCP banner lines that can arrive in the same frame as command responses
      if (line === 'NOKEY' || line.length === 0) {
        this.debug('[ADCP] banner ignored:', JSON.stringify(line));
        continue;
      }

      if (this.commandQueue.length > 0) {
        const { resolve } = this.commandQueue.shift();
        resolve(line);
      } else {
        // No pending commands; treat as informational only
        this.debug('[ADCP] unsolicited:', JSON.stringify(line));
      }
    }
  }

  // ADCP authenticate: either NOKEY (no auth) or nonce -> sha256(nonce+password)
  authenticate() {
    return new Promise((resolve, reject) => {
      let nonce = '';
      const timer = setTimeout(() => { cleanup(); reject(new Error('Authentication timeout')); }, this.commandTimeout);

      const onData = (buf) => {
        const chunk = buf.toString('utf8');
        const lines = chunk.split(/\r\n/).map(l => l.trim()).filter(Boolean);
        for (const lineRaw of lines) {
          const line = lineRaw.trim();
          if (!line) continue;

          // No-auth mode explicitly tells us NOKEY
          if (line === 'NOKEY') { cleanup(); this.isAuthenticated = true; return resolve(); }

          if (!nonce) {
            // First non-empty line is the nonce
            nonce = line;
            const hash = crypto.createHash('sha256').update(nonce + this.password, 'utf8').digest('hex');
            this.client.write(hash + '\r\n');
            this.debug('ADCP >> [auth hash]');
            continue;
          }

          // After sending hash, expect 'ok' on success
          const l = line.toLowerCase();
          if (l.startsWith('ok')) { cleanup(); this.isAuthenticated = true; return resolve(); }
          if (l.startsWith('err')) { cleanup(); return reject(new Error(`ADCP auth error: ${line}`)); }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.client?.removeListener('data', onData);
      };

      // Temporary listener just for auth handshake; handleData will ignore until commands are queued
      this.client.on('data', onData);
    });
  }

  // Send a command and receive a single-line response
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.client || this.client.destroyed) {
        return reject(new Error('Socket is not connected'));
      }

      const commandTimer = setTimeout(() => {
        this.log.error(`⚠️ Command timeout: '${command}'`);
        this.disconnect();
        reject(new Error('Command timeout'));
      }, this.commandTimeout);

      this.commandQueue.push({
        resolve: (response) => {
          clearTimeout(commandTimer);
          this.debug(`ADCP << ${response}`);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(commandTimer);
          reject(error);
        },
      });

      this.debug(`ADCP >> ${command}`);
      this.client.write(`${command}\r\n`);
    });
  }

  // Execute a command, ensuring connection and authentication
  async executeCommand(command) {
    await this.connect();
    const response = await this.sendCommand(command);
    return response;
  }

  // Power Commands
  async getPowerState() {
    try {
      const resp = (await this.executeCommand('power_status ?')).toLowerCase();
      // Typical returns: 'on', 'standby', 'cooling1', 'cooling2'
      return resp === 'on';
    } catch (error) {
      this.log.error('Error getting power state:', error.message);
      throw error;
    }
  }

  async setPowerState(state) {
    try {
      const resp = (await this.executeCommand(`power "${state ? 'on' : 'off'}"`)).toLowerCase();
      if (resp !== 'ok') throw new Error(`Power set failed: ${resp}`);
      return true;
    } catch (error) {
      this.log.error('Error setting power state:', error.message);
      throw error;
    }
  }

  // Network Commands
  async getIpAddress() {
    const resp = await this.executeCommand('ipv4_ip_address ?');
    return resp;
  }

  async getNetworkStatus() {
    const resp = await this.executeCommand('ipv4_network_setting ?');
    return resp;
  }

  // Error and Warning Status
  async getErrorStatus() {
    const resp = await this.executeCommand('error ?');
    if (resp && resp.startsWith('{')) {
      try { return JSON.parse(resp); } catch {
        return { raw: resp };
      }
    }
    return { raw: resp };
  }

  async getWarningStatus() {
    const resp = await this.executeCommand('warning ?');
    return resp;
  }

  // Input Selection
  async setInputSource(source) {
    const resp = (await this.executeCommand(`input "${source}"`)).toLowerCase();
    if (resp !== 'ok') throw new Error(`Failed to set input source: ${resp}`);
    return true;
  }

  // Image Adjustment
  async setBrightness(value) {
    const resp = (await this.executeCommand(`brightness ${value}`)).toLowerCase();
    if (resp !== 'ok') throw new Error(`Failed to set brightness: ${resp}`);
    return true;
  }

  async setContrast(value) {
    const resp = (await this.executeCommand(`contrast ${value}`)).toLowerCase();
    if (resp !== 'ok') throw new Error(`Failed to set contrast: ${resp}`);
    return true;
  }

  async setGamma(mode) {
    const resp = (await this.executeCommand(`gamma_correction "${mode}"`)).toLowerCase();
    if (resp !== 'ok') throw new Error(`Failed to set gamma mode: ${resp}`);
    return true;
  }

  // Shutdown method to clean up resources
  shutdown() {
    this.disconnect();
  }
}

module.exports = ADCP;