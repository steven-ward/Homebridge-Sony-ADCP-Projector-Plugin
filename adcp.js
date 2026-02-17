const net = require("net");
const crypto = require("crypto");
const EventEmitter = require("events");
const { ADCP_COMMANDS } = require("./adcp-commands");

class ADCP extends EventEmitter {
  /**
   * @param {string} ip
   * @param {number} port
   * @param {string|undefined} username  // not used by ADCP, kept for backwards compat
   * @param {string|undefined} password  // ADCP password (if auth enabled)
   * @param {object} log                 // homebridge logger
   * @param {boolean} useAuth            // projector ADCP "Requires Authentication"
   * @param {number} timeout             // base timeout in ms
   */
  constructor(
    ip,
    port = 53595,
    username,
    password,
    log,
    useAuth = false,
    timeout = 5000,
  ) {
    super();
    this.ip = ip;
    this.port = port;
    this.username = username;
    this.password = password || "";
    this.log = log;
    this.useAuth = useAuth;

    this.client = null; // TCP client socket
    this.isAuthenticated = false; // Authentication state
    this.commandQueue = []; // Queue for pending commands
    this.responseBuffer = ""; // Buffer for incoming data
    this.isConnecting = false; // Connection state
    this.connectionTimeout = timeout; // Connection timeout
    this.commandTimeout = timeout; // Per-command timeout

    // Retry controls
    this.maxRetries = 1; // number of automatic retries per command on transient errors
    this.retryDelayMs = 150; // delay between retries

    // Command pacing
    this.debounceMs = 200;
    this.lastCommandTime = 0;
    this._pendingCommand = Promise.resolve();

    // Offline cooldown - prevent hammering a dead projector
    this._lastConnectionFailure = 0;
    this._connectionCooldownMs = 10000; // 10 seconds between retry attempts when offline

    // Debug helper (off by default; can be enabled via setDebug(true))
    this.debugEnabled = false;
    this.debug = () => {};
  }

  // Enable or disable verbose debug logs from this ADCP client
  setDebug(enabled) {
    this.debugEnabled = !!enabled;
    this.debug =
      this.debugEnabled && this.log && this.log.debug
        ? this.log.debug.bind(this.log)
        : () => {};
  }

  // Establish connection and authenticate if necessary
  async connect() {
    if (this.client && !this.client.destroyed) {
      return; // already connected
    }

    // Check if we're in cooldown from a recent connection failure
    const now = Date.now();
    if (
      this._lastConnectionFailure &&
      now - this._lastConnectionFailure < this._connectionCooldownMs
    ) {
      const remaining = Math.ceil(
        (this._connectionCooldownMs - (now - this._lastConnectionFailure)) /
          1000,
      );
      this.debug(
        `Connection in cooldown (${remaining}s remaining), skipping attempt`,
      );
      throw new Error("Connection cooldown active");
    }

    if (this.isConnecting) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!this.isConnecting) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
      return;
    }

    this.isConnecting = true;
    this.client = new net.Socket();

    return new Promise((resolve, reject) => {
      const connectionTimer = setTimeout(() => {
        const err = new Error("Connection timeout");
        this.log.warn(`⚠️ Connection timeout: ${this.ip}:${this.port}`);
        this._lastConnectionFailure = Date.now(); // Start cooldown
        this.disconnect();
        this.isConnecting = false;
        this.emit("error", err);
        reject(err);
      }, this.connectionTimeout);

      // Common handlers
      this.client.on("error", (error) => {
        clearTimeout(connectionTimer);
        this.log.warn(`❌ Socket error: ${error.message}`);
        this._lastConnectionFailure = Date.now(); // Start cooldown
        this.disconnect();
        this.emit("error", error);
        reject(error);
      });

      this.client.on("close", () => {
        this.log.warn("⚠️ Connection closed by the projector.");
        this.disconnect();
        this.emit("disconnected", { ip: this.ip, port: this.port });
      });

      this.client.connect(this.port, this.ip, async () => {
        clearTimeout(connectionTimer);
        try {
          // Attach data handler now; it won't resolve anything until a command is queued
          this.client.removeAllListeners("data");
          this.client.on("data", (data) => this.handleData(data));
          // Improve stability on idling projectors
          try {
            this.client.setKeepAlive(true, 15000);
          } catch (e) {
            /* noop */
          }

          if (this.useAuth) {
            await this.authenticate();
            this.debug("✅ ADCP authentication successful.");
          } else {
            // Drain an initial NOKEY if projector sends it (no-auth mode)
            this.isAuthenticated = true;
          }

          this.debug("ADCP connected");
          this._lastConnectionFailure = 0; // Clear cooldown on success
          this.isConnecting = false;
          this.emit("connected", {
            ip: this.ip,
            port: this.port,
            authenticated: this.isAuthenticated,
          });
          resolve();
        } catch (error) {
          this.log.error(`❌ Authentication failed: ${error.message}`);
          this.disconnect();
          this.isConnecting = false;
          this.emit("error", error);
          reject(error);
        }
      });
    });
  }

  // Disconnect the socket
  disconnect() {
    if (this.client && !this.client.destroyed) {
      try {
        this.client.destroy();
      } catch (e) {
        /* noop */
      }
    }

    this.client = null;
    this.isAuthenticated = false;

    // Reject any in-flight commands
    const pending = this.commandQueue.splice(0);
    for (const item of pending) {
      try {
        item.reject?.(new Error("Disconnected"));
      } catch (_) {
        /* noop */
      }
    }

    this.responseBuffer = "";
    this.isConnecting = false;
  }

  // Handle incoming data (CRLF-delimited lines)
  handleData(data) {
    this.responseBuffer += data.toString("utf8");

    let idx;
    while ((idx = this.responseBuffer.indexOf("\r\n")) !== -1) {
      const line = this.responseBuffer.slice(0, idx).trim();
      this.responseBuffer = this.responseBuffer.slice(idx + 2);

      // Ignore ADCP banner lines that can arrive in the same frame as command responses
      if (line === "NOKEY" || line.length === 0) {
        this.debug("[ADCP] banner ignored:", JSON.stringify(line));
        continue;
      }

      if (this.commandQueue.length > 0) {
        const { resolve } = this.commandQueue.shift();
        resolve(line);
      } else {
        // No pending commands; ignore common keepalive/ok noise, log others
        if (line.toLowerCase() !== "ok") {
          this.debug("[ADCP] unsolicited:", JSON.stringify(line));
        }
      }
    }
  }

  // ADCP authenticate: either NOKEY (no auth) or nonce -> sha256(nonce+password)
  authenticate() {
    return new Promise((resolve, reject) => {
      let nonce = "";
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Authentication timeout"));
      }, this.commandTimeout);

      const onData = (buf) => {
        const chunk = buf.toString("utf8");
        const lines = chunk
          .split(/\r\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const lineRaw of lines) {
          const line = lineRaw.trim();
          if (!line) continue;

          // No-auth mode explicitly tells us NOKEY
          if (line === "NOKEY") {
            cleanup();
            this.isAuthenticated = true;
            this.emit("authenticated", { method: "none" });
            return resolve();
          }

          if (!nonce) {
            // First non-empty line is the nonce
            nonce = line;
            const hash = crypto
              .createHash("sha256")
              .update(nonce + this.password, "utf8")
              .digest("hex");
            this.client.write(hash + "\r\n");
            this.debug("ADCP >> [auth hash]");
            continue;
          }

          // After sending hash, expect 'ok' on success
          const l = line.toLowerCase();
          if (l.startsWith("ok")) {
            cleanup();
            this.isAuthenticated = true;
            return resolve();
          }
          if (l.startsWith("err")) {
            cleanup();
            const err = new Error(`ADCP auth error: ${line}`);
            this.emit("error", err);
            return reject(err);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.client?.removeListener("data", onData);
      };

      // Temporary listener just for auth handshake; handleData will ignore until commands are queued
      this.client.on("data", onData);
    });
  }

  // Send a command and receive a single-line response
  sendCommand(command) {
    const attemptSend = (attempt = 0) => {
      return new Promise((resolve, reject) => {
        if (!this.client || this.client.destroyed) {
          return reject(new Error("Socket is not connected"));
        }

        const commandTimer = setTimeout(() => {
          this.log.error(`⚠️ Command timeout: '${command}'`);
          // Kill the socket so a reconnect happens on next call
          this.disconnect();
          if (attempt < this.maxRetries) {
            return setTimeout(() => {
              this.connect()
                .then(() =>
                  attemptSend(attempt + 1)
                    .then(resolve)
                    .catch(reject),
                )
                .catch(reject);
            }, this.retryDelayMs);
          }
          return reject(new Error("Command timeout"));
        }, this.commandTimeout);

        const done = (fn) => (value) => {
          clearTimeout(commandTimer);
          fn(value);
        };

        this.commandQueue.push({
          resolve: done(resolve),
          reject: done(reject),
        });

        try {
          this.debug(`ADCP >> ${command}`);
          this.client.write(`${command}\r\n`);
        } catch (err) {
          clearTimeout(commandTimer);
          this.log.error(`❌ Write failed: ${err.message}`);
          if (attempt < this.maxRetries) {
            return setTimeout(() => {
              this.connect()
                .then(() =>
                  attemptSend(attempt + 1)
                    .then(resolve)
                    .catch(reject),
                )
                .catch(reject);
            }, this.retryDelayMs);
          }
          return reject(err);
        }
      });
    };

    return attemptSend(0);
  }

  // Execute a command, ensuring connection and authentication
  async executeCommand(command) {
    return this._enqueueCommand(async () => {
      try {
        await this.connect();
        return await this.sendCommand(command);
      } catch (err) {
        this.emit("error", err);
        // One-shot reconnect in case the socket dropped between calls
        this.disconnect();
        await this.connect();
        return await this.sendCommand(command);
      }
    });
  }

  _enqueueCommand(fn) {
    const run = async () => {
      const now = Date.now();
      const elapsed = now - this.lastCommandTime;
      if (elapsed < this.debounceMs) {
        await delay(this.debounceMs - elapsed);
      }
      try {
        return await fn();
      } finally {
        this.lastCommandTime = Date.now();
      }
    };

    const next = this._pendingCommand.then(run, run);
    this._pendingCommand = next.catch(() => {});
    return next;
  }

  // ---- Internal parsers -------------------------------------------------
  _isOk(resp) {
    if (!resp) return false;
    const r = String(resp).trim().toLowerCase();
    return r === "ok" || r.startsWith("ok");
  }
  _toBool01(resp) {
    if (resp === undefined || resp === null) return 0;
    const r = String(resp).trim().toLowerCase();
    if (r === "on" || r === "true") return 1;
    const n = Number(r);
    if (!Number.isNaN(n)) return n ? 1 : 0;
    return r === "ok" ? 1 : 0;
  }
  _toNumber(resp, def = 0) {
    const n = Number(String(resp).trim());
    return Number.isFinite(n) ? n : def;
  }

  // Power Commands
  async getPowerState() {
    try {
      const raw = await this.executeCommand("power_status ?");
      // Response may include quotes, e.g. '"on"' - strip them
      const resp = raw.toLowerCase().replace(/"/g, "").trim();
      this.debug(`getPowerState raw="${raw}" parsed="${resp}"`);
      // Typical returns: 'on', 'standby', 'cooling1', 'cooling2'
      return resp === "on";
    } catch (error) {
      this.log.error("Error getting power state:", error.message);
      throw error;
    }
  }

  async setPowerState(state) {
    try {
      const resp = (
        await this.executeCommand(`power "${state ? "on" : "off"}"`)
      ).toLowerCase();
      if (resp !== "ok") throw new Error(`Power set failed: ${resp}`);
      return true;
    } catch (error) {
      this.log.error("Error setting power state:", error.message);
      throw error;
    }
  }

  // Network Commands
  async getIpAddress() {
    const resp = await this.executeCommand(ADCP_COMMANDS.IPV4_ADDRESS);
    return resp;
  }

  async getNetworkStatus() {
    const resp = await this.executeCommand(ADCP_COMMANDS.IPV4_NETWORK_SETTING);
    return resp;
  }

  // Ping-ish command: perform a no-op query that every unit should accept
  async ping() {
    try {
      await this.executeCommand(ADCP_COMMANDS.POWER_STATUS);
      return true;
    } catch {
      return false;
    }
  }

  // Model name (if supported by firmware)
  async getModelName() {
    try {
      const resp = await this.executeCommand(ADCP_COMMANDS.MODEL_QUERY);
      return String(resp || "")
        .replace(/"/g, "")
        .trim();
    } catch {
      return "";
    }
  }

  // Serial number
  async getSerialNumber() {
    try {
      const resp = await this.executeCommand(ADCP_COMMANDS.SERIAL_QUERY);
      return String(resp || "")
        .replace(/"/g, "")
        .trim();
    } catch {
      return "";
    }
  }

  // Firmware version - returns JSON like [{"main":"1.104"},{"laser":"21/00/00/00/00"}]
  async getFirmwareVersion() {
    try {
      const resp = await this.executeCommand(ADCP_COMMANDS.FIRMWARE_QUERY);
      const str = String(resp || "").trim();
      // Try to parse JSON response
      if (str.startsWith("[")) {
        const arr = JSON.parse(str);
        const main = arr.find((item) => item.main);
        if (main?.main) return main.main;
      }
      // Fallback: return raw response without quotes
      return str.replace(/"/g, "").trim();
    } catch {
      return "";
    }
  }

  // Error and Warning Status
  async getErrorStatus() {
    const resp = await this.executeCommand(ADCP_COMMANDS.ERROR_STATUS);
    if (resp && resp.startsWith("{")) {
      try {
        return JSON.parse(resp);
      } catch {
        return { raw: resp };
      }
    }
    return { raw: resp };
  }

  async getWarningStatus() {
    const resp = await this.executeCommand(ADCP_COMMANDS.WARNING_STATUS);
    return resp;
  }

  // Input Selection
  async setInputSource(source) {
    const resp = (
      await this.executeCommand(ADCP_COMMANDS.INPUT_SET(source))
    ).toLowerCase();
    if (resp !== "ok") throw new Error(`Failed to set input source: ${resp}`);
    return true;
  }

  // Query current input identifier (ADCP input code)
  // VPL-XW5000 returns string like "hdmi1", "hdmi2"
  async getInputIdentifier() {
    try {
      const resp = await this.executeCommand(ADCP_COMMANDS.INPUT_QUERY);
      // Strip quotes if present
      const input = String(resp || "")
        .replace(/"/g, "")
        .trim()
        .toLowerCase();
      return input || "unknown";
    } catch {
      return "unknown";
    }
  }

  // Image Adjustment
  async setBrightness(value) {
    const val = Math.max(0, Math.min(100, Number(value)));
    const resp = (
      await this.executeCommand(ADCP_COMMANDS.BRIGHTNESS_SET(val))
    ).toLowerCase();
    if (resp !== "ok") throw new Error(`Failed to set brightness: ${resp}`);
    return true;
  }

  async setContrast(value) {
    const val = Math.max(0, Math.min(100, Number(value)));
    const resp = (
      await this.executeCommand(ADCP_COMMANDS.CONTRAST_SET(val))
    ).toLowerCase();
    if (resp !== "ok") throw new Error(`Failed to set contrast: ${resp}`);
    return true;
  }

  // ---- Contrast (getter) -----------------------------------------------
  async getContrast() {
    const resp = await this.executeCommand(ADCP_COMMANDS.CONTRAST_QUERY);
    return this._toNumber(resp, 50);
  }

  async setGamma(mode) {
    const resp = (
      await this.executeCommand(ADCP_COMMANDS.GAMMA_SET(mode))
    ).toLowerCase();
    if (resp !== "ok") throw new Error(`Failed to set gamma mode: ${resp}`);
    return true;
  }

  // ---- Video Mute (Blank Screen) ---------------------------------------
  // VPL-XW5000 uses 'blank ?' and returns "on" or "off"
  async getVideoMute() {
    const resp = await this.executeCommand(ADCP_COMMANDS.VIDEO_MUTE_QUERY);
    const val = String(resp || "")
      .replace(/"/g, "")
      .trim()
      .toLowerCase();
    return val === "on" || val === "1";
  }
  async setVideoMute(on) {
    const resp = await this.executeCommand(ADCP_COMMANDS.VIDEO_MUTE_SET(on));
    if (!this._isOk(resp)) throw new Error(`Failed to set video mute: ${resp}`);
    return true;
  }

  // ---- Picture Mode -----------------------------------------------------
  // VPL-XW5000 returns string like "reference", "cinema_film_1", etc.
  async getPictureMode() {
    const resp = await this.executeCommand(ADCP_COMMANDS.PICTURE_MODE_QUERY);
    // Strip quotes and return string
    return String(resp || "")
      .replace(/"/g, "")
      .trim();
  }
  async setPictureMode(mode) {
    // Accept string mode name (e.g., "reference", "cinema_film_1")
    const resp = await this.executeCommand(
      ADCP_COMMANDS.PICTURE_MODE_SET(mode),
    );
    if (!this._isOk(resp))
      throw new Error(`Failed to set picture mode: ${resp}`);
    return true;
  }

  // ---- HDR Mode ---------------------------------------------------------
  // VPL-XW5000 returns string like "auto", "off", "hdr10", "hlg"
  async getHdrMode() {
    const resp = await this.executeCommand(ADCP_COMMANDS.HDR_MODE_QUERY);
    // Strip quotes and return string
    return String(resp || "")
      .replace(/"/g, "")
      .trim();
  }
  async setHdrMode(mode) {
    // Accept string mode name (e.g., "auto", "off", "hdr10", "hlg")
    const resp = await this.executeCommand(ADCP_COMMANDS.HDR_MODE_SET(mode));
    if (!this._isOk(resp)) throw new Error(`Failed to set HDR mode: ${resp}`);
    return true;
  }

  // ---- Brightness (getter) ---------------------------------------------
  async getBrightness() {
    const resp = await this.executeCommand(ADCP_COMMANDS.BRIGHTNESS_QUERY);
    return this._toNumber(resp, 50);
  }

  // ---- Error / Warning (compact) ---------------------------------------
  // VPL-XW5000 returns ["no_err"] or error array
  async getErrorCode() {
    const resp = await this.executeCommand(ADCP_COMMANDS.ERROR_STATUS);
    const str = String(resp || "").trim();
    // Parse JSON array response
    if (str.startsWith("[")) {
      try {
        const arr = JSON.parse(str);
        // Return 0 if no_err, otherwise 1 (has error)
        if (arr.includes("no_err")) return 0;
        return arr.length > 0 ? 1 : 0;
      } catch {}
    }
    // Fallback to numeric parsing
    const n = this._toNumber(resp, 0);
    return Number.isFinite(n) ? n : 0;
  }

  // ---- Lamp / Laser Hours ----------------------------------------------
  // VPL-XW5000 laser info is in version response: [{"main":"1.104"},{"laser":"21/00/00/00/00"}]
  // The first number in laser string appears to be hours
  async getLampHours() {
    try {
      const resp = await this.executeCommand(ADCP_COMMANDS.LAMP_HOURS);
      const str = String(resp || "").trim();
      if (str.startsWith("[")) {
        const arr = JSON.parse(str);
        const laserObj = arr.find((item) => item.laser);
        if (laserObj?.laser) {
          // Parse "21/00/00/00/00" - first number is hours
          const parts = laserObj.laser.split("/");
          return parseInt(parts[0], 10) || 0;
        }
      }
      return this._toNumber(resp, 0);
    } catch {
      return 0;
    }
  }

  // ---- Test Patterns (advanced) ----------------------------------------
  async setTestPattern(pattern) {
    // Accept string pattern name
    const resp = await this.executeCommand(
      ADCP_COMMANDS.TEST_PATTERN_SET(pattern),
    );
    if (!this._isOk(resp))
      throw new Error(`Failed to set test pattern: ${resp}`);
    return true;
  }

  // Shutdown method to clean up resources
  shutdown() {
    this.disconnect();
  }
}

module.exports = ADCP;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
