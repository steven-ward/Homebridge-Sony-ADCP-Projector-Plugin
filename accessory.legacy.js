// accessory.js – Television-style HomeKit accessory for Sony ADCP projectors
/**
 * v2 pragmatic features implemented in this file
 * -------------------------------------------------
 * 1) Blank Screen switch (ADCP video mute)
 * 2) Picture Modes as a virtual InputSource bank
 * 3) HDR Mode selector as a virtual InputSource bank
 * 4) Brightness slider via Lightbulb service
 * 5) Error state sensor (ContactSensor) + optional Lamp Hours read-out
 * 6) Test Patterns as an (optional) virtual InputSource bank (advanced)
 *
 * UI Layout Toggle (config.uiLayout)
 * ----------------------------------
 * - "mixed_virtual" (legacy): HDMI + Picture Modes + HDR + Test Patterns are all
 *   exposed as InputSource items inside the TV input list.
 * - "inputs_only" (default): TV input list shows only real HDMI inputs. Picture
 *   Modes / HDR / Test Patterns are exposed as EXCLUSIVE switch groups outside the
 *   TV input list (cleaner Home UI). This file builds the proper services based on
 *   the selected layout at startup.
 *
 * Identifier scheme for InputSource.ActiveIdentifier routing:
 * - Real HDMI inputs use whatever IDs are provided by config (e.g., 1, 2, 3)
 * - Picture Modes occupy IDs starting at 1000 (PM_BASE)
 * - HDR Modes occupy IDs starting at 2000 (HDR_BASE)
 * - Test Patterns occupy IDs starting at 3000 (TP_BASE)
 *
 * ActiveIdentifier onSet routes by range to the correct ADCP call.
 * This keeps Home UI slick (single selector) while supporting advanced controls.
 *
 * NOTE: adcp.js should provide methods used here (e.g., getVideoMute, setPictureMode, etc.).
 * If not yet present, they can be temporarily shimmed using executeCommand() until adcp.js is updated.
 */
const fs = require("fs");
const path = require("path");
const ADCP = require("./adcp");
const { ADCP_COMMANDS } = require("./adcp-commands");

class SonyProjectorAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.name = config.name || "Sony Projector";

    // Config
    this.ip = config.ip;
    // Parse and validate ADCP port
    const port = Number.parseInt(config.adcpPort, 10);
    this.adcpPort = Number.isInteger(port) ? port : 53595;
    if (this.adcpPort < 1 || this.adcpPort > 65535) {
      this.log.warn(
        `[SonyProjector] Invalid ADCP port '${config.adcpPort}', falling back to 53595`,
      );
      this.adcpPort = 53595;
    }
    this.password = config.password;
    this.useAuth = config.useAuth ?? false; // projector ADCP "Requires Authentication"
    this.timeout = (config.timeout || 5) * 1000; // ms (adcp.js already enforces per-command)

    // Optional device info and logging level
    this.staticModel = config.staticModel;
    this.staticSerial = config.staticSerial;
    this._persistedSerial = null;
    this._persistedModel = null;
    this._persistPath = this.api.user?.storagePath?.() || null;
    this._persistFile = this._persistPath
      ? path.join(
          this._persistPath,
          "persist",
          `sony-projector-${String(this.ip || "unknown").replace(/[^a-z0-9]/gi, "-")}.json`,
        )
      : null;
    this._persistCache = null;
    if (this._persistFile) {
      this._loadPersistedMetadata();
    }
    this._stateCache = new Map();
    this._stateRefreshMeta = new Map();
    this.logging = config.logging || "standard";
    this.debug =
      this.logging === "debug" && this.log && this.log.debug
        ? this.log.debug.bind(this.log)
        : () => {};

    // Optional input mapping from config
    this.inputs = (
      Array.isArray(config.inputs) && config.inputs.length
        ? config.inputs
        : [
            { id: 1, name: "HDMI 1", adcp: "hdmi1" },
            { id: 2, name: "HDMI 2", adcp: "hdmi2" },
          ]
    ).map((input, idx) => ({
      id: Number(input?.id ?? idx + 1),
      name: input?.name || `Input ${idx + 1}`,
      adcp: input?.adcp || `hdmi${idx + 1}`,
    }));
    this.inputs = this._dedupeByKey(this.inputs, "id", "Input Identifier");

    // ----- v2 feature config -----
    this.enableBrightness = config.enableBrightness ?? true;
    this.enableHdrSelector = config.enableHdrSelector ?? true;
    this.enableTestPatterns = config.enableTestPatterns ?? false; // advanced
    this.enableLampHoursSensor = config.enableLampHoursSensor ?? true;
    this.enablePolling = config.enablePolling ?? true;
    const intervalSec = Number(config.pollingInterval) || 30;
    const clampedInterval = Math.min(300, Math.max(10, intervalSec));
    this.pollingIntervalMs = clampedInterval * 1000;
    this._pollingTimer = null;
    this._lastLampHours = null;
    this._lastErrorCode = 0;

    // Layout: "inputs_only" (default clean layout) or "mixed_virtual" (legacy behavior)
    this.uiLayout =
      config.uiLayout === "mixed_virtual" ? "mixed_virtual" : "inputs_only";

    // runtime state caches for exclusive switch groups
    this._statePictureModeCode = null; // unknown until first query
    this._stateHdrModeCode = null; // unknown until first query
    this._stateTestPatternCode = null; // unknown until first query

    // Picture modes virtual bank (name + ADCP code)
    this.pictureModes = this._dedupeByKey(
      Array.isArray(config.pictureModes)
        ? config.pictureModes
        : [
            { name: "Cinema", code: 1 },
            { name: "Reference", code: 2 },
            { name: "Game", code: 3 },
            { name: "Bright", code: 4 },
          ],
      "code",
      "Picture Mode code",
    );

    // HDR modes virtual bank (name + ADCP code)
    this.hdrModes = this._dedupeByKey(
      Array.isArray(config.hdrModes)
        ? config.hdrModes
        : [
            { name: "HDR Auto", code: 0 },
            { name: "HDR10", code: 1 },
            { name: "HLG", code: 2 },
            { name: "HDR Off", code: 3 },
          ],
      "code",
      "HDR Mode code",
    );

    // Test patterns virtual bank (advanced)
    this.testPatterns = this._dedupeByKey(
      Array.isArray(config.testPatterns)
        ? config.testPatterns
        : [
            { name: "Grid", code: 1 },
            { name: "Color Bars", code: 2 },
          ],
      "code",
      "Test Pattern code",
    );

    // Virtual identifier ranges
    this.PM_BASE = 1000;
    this.HDR_BASE = 2000;
    this.TP_BASE = 3000;

    // ADCP client
    this.adcpClient = new ADCP(
      this.ip,
      this.adcpPort,
      undefined, // username not used by ADCP
      this.password,
      this.log,
      this.useAuth,
      this.timeout,
    );
    // Sync ADCP debug with plugin logging level
    this.adcpClient.setDebug(this.logging === "debug");
    this.adcpClient.on("connected", ({ authenticated }) => {
      this.debug(`ADCP connected (auth=${authenticated})`);
    });
    this.adcpClient.on("authenticated", ({ method }) => {
      this.debug(`ADCP authenticated via ${method}`);
    });
    this.adcpClient.on("disconnected", ({ reason }) => {
      this.log.warn(
        `[SonyProjector] ADCP disconnected${reason ? ` (${reason})` : ""}`,
      );
    });
    this.adcpClient.on("error", (error) => {
      this.log.warn(`[SonyProjector] ADCP error: ${error?.message || error}`);
    });

    // HAP handles
    const { Service, Characteristic } = this.api.hap;
    this.Service = Service;
    this.Characteristic = Characteristic;

    // ===== Services =====
    // Accessory Information (uses static overrides when provided)
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, "Sony")
      .setCharacteristic(
        Characteristic.Model,
        this.staticModel || this._persistedModel || "Sony Projector",
      );

    if (this.staticSerial) {
      this.informationService.setCharacteristic(
        Characteristic.SerialNumber,
        this.staticSerial,
      );
    } else if (this._persistedSerial) {
      this.informationService.setCharacteristic(
        Characteristic.SerialNumber,
        this._persistedSerial,
      );
    }

    // Television service (drives TV UI & icon)
    this.television = new Service.Television(this.name);
    this.television.setPrimaryService(true);
    this.television
      .setCharacteristic(Characteristic.ConfiguredName, this.name)
      .setCharacteristic(
        Characteristic.SleepDiscoveryMode,
        Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      )
      .setCharacteristic(
        Characteristic.CurrentMediaState,
        Characteristic.CurrentMediaState.STOP,
      )
      .setCharacteristic(
        Characteristic.TargetMediaState,
        Characteristic.TargetMediaState.STOP,
      );
    // Set HomeKit category hint for TV
    // this.television.setCharacteristic(Characteristic.Category, this.api.hap.Categories.TELEVISION);

    // Power (Active)
    this.television
      .getCharacteristic(Characteristic.Active)
      .onGet(() => {
        this._refreshStateAsync(
          "power",
          async () => {
            const on = await this.adcpClient.getPowerState();
            this.powerState = on;
            return on;
          },
          10000,
          (value) => {
            this.powerState = !!value;
          },
        );
        return this._getCachedState("power", this.powerState) ? 1 : 0;
      })
      .onSet(this.handleActiveSet.bind(this));

    // Inputs: ActiveIdentifier + linked InputSource services
    this.inputIdToAdcp = {};
    this.currentInput = this.inputs[0]?.id ?? 1;

    this.television
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this._activeIdentifierGet())
      .onSet(async (id) => this._activeIdentifierSet(id));

    // RemoteKey characteristic
    this.television
      .getCharacteristic(Characteristic.RemoteKey)
      .onSet(this.handleRemoteKeyPress.bind(this));

    // Create & link InputSource services
    this._inputServices = [];
    this.inputs.forEach(({ id, name, adcp }) => {
      const input = new Service.InputSource(`in-${id}`, `in-${id}`);
      input
        .setCharacteristic(Characteristic.Identifier, id)
        .setCharacteristic(Characteristic.ConfiguredName, name)
        .setCharacteristic(
          Characteristic.InputSourceType,
          Characteristic.InputSourceType.HDMI,
        )
        .setCharacteristic(
          Characteristic.IsConfigured,
          Characteristic.IsConfigured.CONFIGURED,
        );
      this.television.addLinkedService(input);
      this._inputServices.push(input);
      this.inputIdToAdcp[id] = adcp;
    });
    this._setCachedState("activeIdentifier", this.currentInput);

    this._auxServices = [];
    this._errorSensor = null;
    this._lampHoursSensor = null;

    // Create controls per selected UI layout
    if (this.uiLayout === "mixed_virtual") {
      // Legacy: add modes into the TV input list as virtual InputSource items
      this._setupPictureModesVirtualInputs();
      this._setupHdrVirtualInputs();
      this._setupTestPatternVirtualInputs();
    } else {
      // Clean layout: only real HDMI inputs live in the TV selector; build exclusive switch groups
      this._setupPictureModeSwitches();
      this._setupHdrSwitches();
      this._setupTestPatternSwitches();
    }

    // Create auxiliary controls
    this._setupBlankScreenSwitch();
    this._setupBrightnessLightbulb();
    this._setupErrorSensor();
    this._setupLampHoursSensor();

    // Speaker (HomeKit requires a TelevisionSpeaker linked service for TV accessories).
    // Currently not bound to AVR volume; left as ABSOLUTE placeholder for future expansion.
    this.speaker = new Service.TelevisionSpeaker();
    this.speaker
      .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
      .setCharacteristic(
        Characteristic.VolumeControlType,
        Characteristic.VolumeControlType.ABSOLUTE,
      );
    this.television.addLinkedService(this.speaker);

    // Cache
    this.powerState = false; // boolean ON/OFF
    this._setCachedState("power", this.powerState);
    this._setCachedState("brightness", 50);
    this._setCachedState("videoMute", false);
    this._setCachedState("errorCode", 0);
    this._setCachedState("lampHours", 0);
    this._setCachedState("pictureMode", this._statePictureModeCode);
    this._setCachedState("hdrMode", this._stateHdrModeCode);
    this._setCachedState("testPattern", this._stateTestPatternCode);

    // Defer async initialization until Homebridge finishes launching
    this.api.on("didFinishLaunching", () => {
      this._initAsync().catch((err) =>
        this.debug("initAsync error:", err?.message),
      );
      this._startPolling();
    });

    // Graceful shutdown
    this.api.on("shutdown", () => {
      this._stopPolling();
      try {
        this.adcpClient.shutdown();
      } catch {}
    });
  }

  // ===== Information =====
  async getSerialNumber() {
    try {
      const resp = await this.adcpClient.executeCommand("serialnum ?");
      return resp || "Unknown";
    } catch (error) {
      this.debug("Serial query failed:", error.message);
      return "Unknown";
    }
  }

  getServices() {
    // Return synchronously per Homebridge Accessory API
    return [
      this.informationService,
      this.television,
      this.speaker,
      ...this._inputServices,
      ...this._auxServices,
    ];
  }

  // ===== Async initializer (runs after launch) =====
  async _initAsync() {
    try {
      if (this.staticSerial) {
        // User provided serial; no need to query projector on startup
        return;
      }
      await this._refreshSerialNumber();
      await this._refreshModelNumber();
    } catch (error) {
      this.debug("Serial query failed:", error.message);
    }
  }

  async _refreshSerialNumber() {
    try {
      const serial = await this.adcpClient.executeCommand("serialnum ?");
      if (serial) {
        this.informationService.updateCharacteristic(
          this.Characteristic.SerialNumber,
          serial,
        );
        this._persistedSerial = serial;
        this._writePersistedMetadata();
        return serial;
      }
    } catch (error) {
      this.debug("Serial refresh failed:", error.message);
    }

    if (this._persistedSerial) {
      this.informationService.updateCharacteristic(
        this.Characteristic.SerialNumber,
        this._persistedSerial,
      );
    }

    return this._persistedSerial || "Unknown";
  }

  async _refreshModelNumber() {
    if (this.staticModel) return;
    try {
      const model = await this.adcpClient.getModelName();
      if (model) {
        this.informationService.updateCharacteristic(
          this.Characteristic.Model,
          model,
        );
        this._persistedModel = model;
        this._writePersistedMetadata();
        return model;
      }
    } catch (error) {
      this.debug("Model refresh failed:", error.message);
    }

    if (this._persistedModel) {
      this.informationService.updateCharacteristic(
        this.Characteristic.Model,
        this._persistedModel,
      );
    }
    return this._persistedModel || this.staticModel || "Sony Projector";
  }

  _loadPersistedMetadata() {
    if (!this._persistFile) {
      return;
    }

    try {
      if (fs.existsSync(this._persistFile)) {
        const raw = fs.readFileSync(this._persistFile, "utf8");
        this._persistCache = JSON.parse(raw);
        this._persistedSerial = this._persistCache?.serial || null;
        this._persistedModel = this._persistCache?.model || null;
        this.debug(`Loaded persisted metadata from ${this._persistFile}`);
      }
    } catch (error) {
      this.log.warn(
        `[SonyProjector] Failed to read persisted metadata: ${error.message}`,
      );
    }
  }

  _writePersistedMetadata() {
    if (!this._persistFile) {
      return;
    }

    try {
      const dir = path.dirname(this._persistFile);
      fs.mkdirSync(dir, { recursive: true });
      this._persistCache = {
        serial: this._persistedSerial,
        model: this._persistedModel,
      };
      fs.writeFileSync(
        this._persistFile,
        JSON.stringify(this._persistCache, null, 2),
        "utf8",
      );
      this.debug(`Persisted metadata to ${this._persistFile}`);
    } catch (error) {
      this.log.warn(
        `[SonyProjector] Failed to write persisted metadata: ${error.message}`,
      );
    }
  }

  _getCachedState(key, fallback) {
    if (!this._stateCache) {
      this._stateCache = new Map();
    }
    return this._stateCache.has(key) ? this._stateCache.get(key) : fallback;
  }

  _setCachedState(key, value) {
    if (!this._stateCache) {
      this._stateCache = new Map();
    }
    this._stateCache.set(key, value);
  }

  _refreshStateAsync(key, fetchFn, minIntervalMs = 5000, onValue) {
    if (!this._stateRefreshMeta) {
      this._stateRefreshMeta = new Map();
    }
    const meta = this._stateRefreshMeta.get(key) || {
      lastFetch: 0,
      inFlight: null,
    };
    const now = Date.now();

    if (meta.inFlight) {
      return;
    }

    if (now - meta.lastFetch < minIntervalMs) {
      return;
    }

    meta.inFlight = (async () => {
      try {
        const value = await fetchFn();
        this._setCachedState(key, value);
        if (onValue) {
          onValue(value);
        }
      } catch (error) {
        this.debug(`State refresh '${key}' failed:`, error?.message || error);
      } finally {
        meta.lastFetch = Date.now();
        meta.inFlight = null;
        this._stateRefreshMeta.set(key, meta);
      }
    })();

    this._stateRefreshMeta.set(key, meta);
  }

  _dedupeByKey(list, key, label) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter((item) => {
      const value = item?.[key];
      if (value === undefined || value === null) {
        this.log.warn(
          `[SonyProjector] ${label}: entry missing ${key}, dropping`,
          item,
        );
        return false;
      }
      if (seen.has(value)) {
        this.log.warn(
          `[SonyProjector] ${label}: duplicate ${key}=${value}, dropping`,
        );
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  _startPolling() {
    if (!this.enablePolling || this._pollingTimer) return;
    this.debug(`Starting polling every ${this.pollingIntervalMs / 1000}s`);
    this._pollingTimer = setInterval(async () => {
      try {
        await this._pollProjectorState();
      } catch (err) {
        this.debug("Polling error:", err?.message);
      }
    }, this.pollingIntervalMs);
  }

  _stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
      this.debug("Stopped polling");
    }
  }

  // Power transition helpers - update HomeKit media state during warm-up/cool-down
  _beginPowerTransition(targetOn) {
    // Signal to HomeKit that the projector is transitioning (warming up or cooling down)
    try {
      this.television.updateCharacteristic(
        this.Characteristic.CurrentMediaState,
        targetOn
          ? this.Characteristic.CurrentMediaState.LOADING
          : this.Characteristic.CurrentMediaState.INTERRUPTED,
      );
    } catch (e) {
      this.debug("beginPowerTransition update failed:", e?.message);
    }
  }

  _completePowerTransition(isOn) {
    // Signal to HomeKit that the projector has finished transitioning
    try {
      this.television.updateCharacteristic(
        this.Characteristic.CurrentMediaState,
        isOn
          ? this.Characteristic.CurrentMediaState.PLAY
          : this.Characteristic.CurrentMediaState.STOP,
      );
      this._setCachedState("power", isOn);
      this.powerState = isOn;
    } catch (e) {
      this.debug("completePowerTransition update failed:", e?.message);
    }
  }

  async _pollProjectorState() {
    const powerOn = await this.adcpClient
      .getPowerState()
      .catch(() => this.powerState);
    if (typeof powerOn === "boolean" && powerOn !== this.powerState) {
      this.powerState = powerOn;
      this._setCachedState("power", powerOn);
      this.television.updateCharacteristic(
        this.Characteristic.Active,
        powerOn ? 1 : 0,
      );
      this._completePowerTransition(powerOn);
    }

    if (powerOn) {
      const identifier = await this.adcpClient
        .getInputIdentifier()
        .catch(() => NaN);
      if (Number.isFinite(identifier) && identifier !== this.currentInput) {
        this.currentInput = identifier;
        this.television.updateCharacteristic(
          this.Characteristic.ActiveIdentifier,
          identifier,
        );
      }

      if (this.enableBrightness) {
        const brightness = await this._adcpGetBrightness().catch(() => null);
        if (brightness !== null) {
          this._lastBrightness = brightness;
          this._setCachedState("brightness", brightness);
          const svc = this._auxServices.find(
            (s) => s.displayName === "Picture Brightness",
          );
          svc?.updateCharacteristic(this.Characteristic.Brightness, brightness);
        }
      }

      await Promise.all([
        this._refreshErrorSensor(),
        this._refreshLampHoursSensor(),
      ]);
    }
  }

  // ===== Power handlers =====
  async handleActiveGet() {
    this._refreshStateAsync(
      "power",
      async () => {
        const on = await this.adcpClient.getPowerState();
        this.powerState = on;
        return on;
      },
      10000,
      (value) => {
        this.powerState = !!value;
      },
    );
    return this._getCachedState("power", this.powerState) ? 1 : 0;
  }

  async handleActiveSet(value) {
    const targetOn = value === 1;
    this._beginPowerTransition(targetOn);
    try {
      await this.adcpClient.setPowerState(targetOn);
      this.powerState = targetOn;
      // Reflect warm-up / cool-down state to Home within ~30s
      await this._postPowerPoll(targetOn);
    } catch (error) {
      this.log.error("Power change failed:", error.message);
      // Busy / transient error
      this._completePowerTransition(this.powerState);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }

  async _postPowerPoll(targetOn) {
    const deadline = Date.now() + 30000; // 30s
    while (Date.now() < deadline) {
      try {
        const on = await this.adcpClient.getPowerState();
        if (on === targetOn) {
          this._completePowerTransition(on);
          return;
        }
      } catch {
        /* ignore transient */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    this._completePowerTransition(this.powerState);
  }

  // ===== Input handlers =====
  async handleActiveIdentifierSet(id) {
    const adcp = this.inputIdToAdcp[id];
    if (!adcp) {
      // resource does not exist / invalid
      throw new this.api.hap.HapStatusError(-70408);
    }

    try {
      await this.adcpClient.setInputSource(adcp);
      this.currentInput = id;
    } catch (error) {
      this.log.error("Input change failed:", error.message);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }

  // ===== Remote Key handlers =====
  async handleRemoteKeyPress(key) {
    // Map HomeKit RemoteKey to ADCP key commands
    const Characteristic = this.Characteristic;
    const mapping = {
      [Characteristic.RemoteKey.REWIND]: 'key "rewind"',
      [Characteristic.RemoteKey.FAST_FORWARD]: 'key "fastforward"',
      [Characteristic.RemoteKey.NEXT_TRACK]: 'key "next"',
      [Characteristic.RemoteKey.PREVIOUS_TRACK]: 'key "prev"',
      [Characteristic.RemoteKey.ARROW_UP]: 'key "up"',
      [Characteristic.RemoteKey.ARROW_DOWN]: 'key "down"',
      [Characteristic.RemoteKey.ARROW_LEFT]: 'key "left"',
      [Characteristic.RemoteKey.ARROW_RIGHT]: 'key "right"',
      [Characteristic.RemoteKey.SELECT]: 'key "enter"',
      [Characteristic.RemoteKey.BACK]: 'key "return"',
      [Characteristic.RemoteKey.EXIT]: 'key "menu"',
      [Characteristic.RemoteKey.PLAY_PAUSE]: 'key "playpause"',
    };
    const cmd = mapping[key];
    if (!cmd) return;
    try {
      await this.adcpClient.executeCommand(cmd);
    } catch (error) {
      this.log.error("RemoteKey command failed:", error.message);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }

  // ===== ActiveIdentifier router (real inputs + virtual banks) =====
  _activeIdentifierGet() {
    this._refreshStateAsync(
      "activeIdentifier",
      async () => {
        const identifier = await this.adcpClient
          .getInputIdentifier()
          .catch(() => this.currentInput);
        if (Number.isFinite(identifier)) {
          this.currentInput = identifier;
          return identifier;
        }
        return this.currentInput;
      },
      10000,
      (value) => {
        this.currentInput = value;
        this.television.updateCharacteristic(
          this.Characteristic.ActiveIdentifier,
          value,
        );
      },
    );
    return this._getCachedState(
      "activeIdentifier",
      this._lastActiveIdentifier ?? this.currentInput,
    );
  }

  async _activeIdentifierSet(id) {
    try {
      if (this.uiLayout === "inputs_only") {
        // Only real HDMI inputs are valid in this mode
        await this.handleActiveIdentifierSet(id);
        this._lastActiveIdentifier = id;
        this.television.updateCharacteristic(
          this.Characteristic.ActiveIdentifier,
          id,
        );
        return;
      }
      if (id >= this.TP_BASE) {
        // Test Pattern bank
        const code = id - this.TP_BASE;
        await this._adcpSetTestPattern(code);
      } else if (id >= this.HDR_BASE) {
        // HDR bank
        const code = id - this.HDR_BASE;
        await this._adcpSetHdrMode(code);
      } else if (id >= this.PM_BASE) {
        // Picture Mode bank
        const code = id - this.PM_BASE;
        await this._adcpSetPictureMode(code);
      } else {
        // Real input (HDMI)
        await this.handleActiveIdentifierSet(id);
      }

      // Remember what we last told HomeKit to display
      this._lastActiveIdentifier = id;
      this.television.updateCharacteristic(
        this.Characteristic.ActiveIdentifier,
        id,
      );
    } catch (error) {
      this.log.error("ActiveIdentifier routing failed:", error.message);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }

  // ===== Service builders =====
  _setupPictureModesVirtualInputs() {
    if (!this.pictureModes?.length) return;
    this.pictureModes.forEach((mode, idx) => {
      const id = this.PM_BASE + (mode.code ?? idx);
      const src = new this.Service.InputSource(`pm-${id}`, `pm-${id}`);
      src
        .setCharacteristic(this.Characteristic.Identifier, id)
        .setCharacteristic(this.Characteristic.ConfiguredName, mode.name)
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType.OTHER,
        )
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED,
        );
      this.television.addLinkedService(src);
      this._inputServices.push(src); // keep visible in TV inputs list
    });
  }

  _setupHdrVirtualInputs() {
    if (!this.enableHdrSelector || !this.hdrModes?.length) return;
    this.hdrModes.forEach((mode, idx) => {
      const id = this.HDR_BASE + (mode.code ?? idx);
      const src = new this.Service.InputSource(`hdr-${id}`, `hdr-${id}`);
      src
        .setCharacteristic(this.Characteristic.Identifier, id)
        .setCharacteristic(this.Characteristic.ConfiguredName, mode.name)
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType.OTHER,
        )
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED,
        );
      this.television.addLinkedService(src);
      this._inputServices.push(src);
    });
  }

  _setupTestPatternVirtualInputs() {
    if (!this.enableTestPatterns || !this.testPatterns?.length) return;
    this.testPatterns.forEach((pat, idx) => {
      const id = this.TP_BASE + (pat.code ?? idx);
      const src = new this.Service.InputSource(`tp-${id}`, `tp-${id}`);
      src
        .setCharacteristic(this.Characteristic.Identifier, id)
        .setCharacteristic(this.Characteristic.ConfiguredName, pat.name)
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType.OTHER,
        )
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED,
        );
      this.television.addLinkedService(src);
      this._inputServices.push(src);
    });
  }

  // ===== Exclusive switch groups (inputs_only layout) =====
  _setupPictureModeSwitches() {
    if (!this.pictureModes?.length) return;
    this._createExclusiveSwitchGroup(
      "Picture Mode",
      "pictureMode",
      this.pictureModes,
      async (code) => {
        // onSet -> apply mode
        await this._adcpSetPictureMode(code);
        this._statePictureModeCode = code;
      },
      async () => {
        // onGet -> query current
        try {
          if (typeof this.adcpClient.getPictureMode === "function") {
            this._statePictureModeCode = await this.adcpClient.getPictureMode();
          }
        } catch {}
        return this._statePictureModeCode;
      },
    );
  }

  _setupHdrSwitches() {
    if (!this.enableHdrSelector || !this.hdrModes?.length) return;
    this._createExclusiveSwitchGroup(
      "HDR",
      "hdrMode",
      this.hdrModes,
      async (code) => {
        await this._adcpSetHdrMode(code);
        this._stateHdrModeCode = code;
      },
      async () => {
        try {
          if (typeof this.adcpClient.getHdrMode === "function") {
            this._stateHdrModeCode = await this.adcpClient.getHdrMode();
          }
        } catch {}
        return this._stateHdrModeCode;
      },
    );
  }

  _setupTestPatternSwitches() {
    if (!this.enableTestPatterns || !this.testPatterns?.length) return;
    this._createExclusiveSwitchGroup(
      "Test Pattern",
      "testPattern",
      this.testPatterns,
      async (code) => {
        await this._adcpSetTestPattern(code);
        this._stateTestPatternCode = code;
      },
      async () => {
        // No standard query; reflect cached code only
        return this._stateTestPatternCode;
      },
    );
  }

  /**
   * Create an exclusive group of Switch services where exactly one item can be ON at a time.
   * @param {string} groupName - Label prefix shown in Home app (each switch gets its own tile under the accessory)
   * @param {Array<{name:string, code:number}>} items
   * @param {(code:number)=>Promise<void>} onSetCode - called when a switch is turned ON
   * @param {()=>Promise<number|null|undefined>} onGetCurrentCode - returns currently active code (or null)
   */
  _createExclusiveSwitchGroup(
    groupName,
    cacheKey,
    items,
    onSetCode,
    onGetCurrentCode,
  ) {
    const services = [];

    items.forEach((item) => {
      const subtype = `${groupName.toLowerCase().replace(/\s+/g, "-")}-${item.code}`;
      const svc = new this.Service.Switch(
        `${groupName}: ${item.name}`,
        subtype,
      );
      svc.__exclusiveCode = item.code;
      // GET returns true if this item's code matches current
      svc
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => {
          this._refreshStateAsync(
            cacheKey,
            async () => {
              const current = await onGetCurrentCode();
              return current;
            },
            10000,
            (value) => {
              if (cacheKey === "pictureMode")
                this._statePictureModeCode = value;
              if (cacheKey === "hdrMode") this._stateHdrModeCode = value;
              if (cacheKey === "testPattern")
                this._stateTestPatternCode = value;
              services.forEach((peer) => {
                const isActive = value === peer.__exclusiveCode;
                peer.updateCharacteristic(this.Characteristic.On, !!isActive);
              });
            },
          );
          const cached = this._getCachedState(cacheKey, null);
          return cached === item.code;
        })
        .onSet(async (v) => {
          try {
            if (v) {
              await onSetCode(item.code);
              this._setCachedState(cacheKey, item.code);
              services.forEach((peer) =>
                peer.updateCharacteristic(
                  this.Characteristic.On,
                  peer.__exclusiveCode === item.code,
                ),
              );
            } else {
              // Ignore attempts to turn OFF the active item; Home app sometimes toggles
              // off before toggling the next one on. We'll reflect actual state via onGet.
              const current = this._getCachedState(cacheKey, null);
              svc.updateCharacteristic(
                this.Characteristic.On,
                current === item.code,
              );
            }
          } catch (e) {
            const msg = String(e?.message || "");
            if (msg.includes("err_cmd")) {
              this.debug(`${groupName} not supported; ignoring set.`);
              return;
            }
            this.log.error(`${groupName} set failed:`, e?.message);
            throw new this.api.hap.HapStatusError(-70402);
          }
        });
      // Ensure each switch has a clear label, is linked to the TV service, and hidden from the main grid
      svc.setCharacteristic(
        this.Characteristic.Name,
        `${groupName}: ${item.name}`,
      );
      this.television.addLinkedService(svc);
      if (typeof svc.setHiddenService === "function") {
        svc.setHiddenService(true);
      }
      this._auxServices.push(svc);
      services.push(svc);
    });
  }

  _setupBlankScreenSwitch() {
    // Video mute switch ("Blank Screen")
    const svc = new this.Service.Switch("Blank Screen", "blank-screen");
    svc
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        // Return cached value immediately; refresh async in background
        this._refreshStateAsync(
          "videoMute",
          async () => {
            const muted = await this._adcpGetVideoMute();
            return muted;
          },
          10000,
          (value) => {
            svc.updateCharacteristic(this.Characteristic.On, !!value);
          },
        );
        return !!this._getCachedState("videoMute", false);
      })
      .onSet(async (v) => {
        try {
          await this._adcpSetVideoMute(!!v);
        } catch (e) {
          const msg = String(e?.message || "");
          if (msg.includes("err_cmd")) {
            this.debug("Blank Screen not supported on this model/firmware.");
            // Reflect to OFF so Home app doesn't stick
            this._auxServices
              .find((s) => s.displayName === "Blank Screen")
              ?.updateCharacteristic(this.Characteristic.On, false);
            return; // swallow unsupported
          }
          this.log.error("Blank Screen set failed:", e?.message);
          throw new this.api.hap.HapStatusError(-70402);
        }
      });
    // Label, link, and hide from main grid
    svc.setCharacteristic(this.Characteristic.Name, "Blank Screen");
    this.television.addLinkedService(svc);
    if (typeof svc.setHiddenService === "function") {
      svc.setHiddenService(true);
    }
    this._auxServices.push(svc);
  }

  async _refreshErrorSensor() {
    if (!this._errorSensor) return;
    try {
      const code = await this._adcpGetErrorCode();
      if (code !== this._lastErrorCode) {
        this._lastErrorCode = code;
        this._errorSensor.updateCharacteristic(
          this.Characteristic.ContactSensorState,
          code
            ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.Characteristic.ContactSensorState.CONTACT_DETECTED,
        );
      }
    } catch (error) {
      this.debug("Error sensor poll failed:", error?.message);
    }
  }

  async _refreshLampHoursSensor() {
    if (!this._lampHoursSensor) return;
    try {
      const hours = await this._adcpGetLampHours();
      if (hours !== this._lastLampHours && Number.isFinite(hours)) {
        this._lastLampHours = hours;
        this._lampHoursSensor.updateCharacteristic(
          this.Characteristic.CurrentAmbientLightLevel,
          Math.max(0.0001, Number(hours) || 0.0001),
        );
      }
    } catch (error) {
      this.debug("Lamp hours poll failed:", error?.message);
    }
  }

  _setupBrightnessLightbulb() {
    if (!this.enableBrightness) return;
    const svc = new this.Service.Lightbulb("Picture Brightness");
    // Optional: tie Lightbulb.On to projector power state (read-only semantics)
    svc
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        this._refreshStateAsync(
          "power",
          async () => {
            const on = await this.adcpClient.getPowerState();
            this.powerState = on;
            return on;
          },
          10000,
          (value) => {
            this.powerState = !!value;
          },
        );
        return !!this._getCachedState("power", this.powerState);
      })
      .onSet(async (v) => {
        // Turning off could power the projector down (optional). Keep it no-op for safety.
        if (!v) return;
      });

    svc
      .getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => {
        this._refreshStateAsync(
          "brightness",
          async () => {
            const val = await this._adcpGetBrightness();
            this._lastBrightness = val;
            return val;
          },
          15000,
          (value) => {
            this._lastBrightness = value;
          },
        );
        const val = this._getCachedState(
          "brightness",
          this._lastBrightness ?? 50,
        );
        return Math.max(0, Math.min(100, Number(val ?? 50)));
      })
      .onSet(async (val) => {
        try {
          await this._adcpSetBrightness(
            Math.max(0, Math.min(100, Number(val))),
          );
        } catch (e) {
          const msg = String(e?.message || "");
          if (msg.includes("err_cmd")) {
            this.debug("Brightness control not supported; ignoring set.");
            return; // swallow unsupported
          }
          this.log.error("Brightness set failed:", e?.message);
          throw new this.api.hap.HapStatusError(-70402);
        }
      });
    // Label, link, and hide from main grid
    svc.setCharacteristic(this.Characteristic.Name, "Picture Brightness");
    this.television.addLinkedService(svc);
    if (typeof svc.setHiddenService === "function") {
      svc.setHiddenService(true);
    }
    this._auxServices.push(svc);
  }

  _setupErrorSensor() {
    const svc = new this.Service.ContactSensor("Projector Error");
    this._errorSensor = svc;
    svc.getCharacteristic(this.Characteristic.ContactSensorState).onGet(() => {
      this._refreshStateAsync(
        "errorCode",
        async () => {
          const code = await this._adcpGetErrorCode();
          this._lastErrorCode = code || 0;
          return this._lastErrorCode;
        },
        30000,
        (value) => {
          this._lastErrorCode = value || 0;
        },
      );
      const code = this._getCachedState("errorCode", this._lastErrorCode || 0);
      return code
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
    });
    // Label, link, and hide from main grid
    svc.setCharacteristic(this.Characteristic.Name, "Projector Error");
    this.television.addLinkedService(svc);
    if (typeof svc.setHiddenService === "function") {
      svc.setHiddenService(true);
    }
    this._auxServices.push(svc);
  }

  _setupLampHoursSensor() {
    if (!this.enableLampHoursSensor) return;
    // Use LightSensor to display a numeric value (Home app will show "lx" unit but value equals hours)
    const svc = new this.Service.LightSensor("Lamp Hours");
    this._lampHoursSensor = svc;
    svc
      .getCharacteristic(this.Characteristic.CurrentAmbientLightLevel)
      .onGet(() => {
        this._refreshStateAsync(
          "lampHours",
          async () => {
            const hours = await this._adcpGetLampHours();
            this._lastLampHours = hours;
            return hours;
          },
          60000,
          (value) => {
            this._lastLampHours = value || 0;
          },
        );
        const hours = this._getCachedState(
          "lampHours",
          this._lastLampHours || 0,
        );
        return Math.max(0.0001, Number(hours) || 0.0001);
      });
    // Label, link, and hide from main grid
    svc.setCharacteristic(this.Characteristic.Name, "Lamp Hours");
    this.television.addLinkedService(svc);
    if (typeof svc.setHiddenService === "function") {
      svc.setHiddenService(true);
    }
    this._auxServices.push(svc);
  }

  // ===== ADCP helper wrappers (tolerate missing methods in adcp.js) =====
  async _adcpGetVideoMute() {
    if (typeof this.adcpClient.getVideoMute === "function")
      return !!(await this.adcpClient.getVideoMute());
    const res = await this.adcpClient.executeCommand(
      ADCP_COMMANDS.VIDEO_MUTE_QUERY,
    );
    const s = String(res).trim().toLowerCase();
    if (s === "err_cmd") return false;
    return String(res).toLowerCase().includes("1");
  }
  async _adcpSetVideoMute(on) {
    if (typeof this.adcpClient.setVideoMute === "function")
      return this.adcpClient.setVideoMute(on);
    return this.adcpClient.executeCommand(ADCP_COMMANDS.VIDEO_MUTE_SET(on));
  }

  async _adcpSetPictureMode(code) {
    if (typeof this.adcpClient.setPictureMode === "function")
      return this.adcpClient.setPictureMode(code);
    return this.adcpClient.executeCommand(ADCP_COMMANDS.PICTURE_MODE_SET(code));
  }

  async _adcpSetHdrMode(code) {
    if (typeof this.adcpClient.setHdrMode === "function")
      return this.adcpClient.setHdrMode(code);
    return this.adcpClient.executeCommand(ADCP_COMMANDS.HDR_MODE_SET(code));
  }

  async _adcpGetBrightness() {
    try {
      if (typeof this.adcpClient.getBrightness === "function")
        return this.adcpClient.getBrightness();
      const res = await this.adcpClient.executeCommand(
        ADCP_COMMANDS.BRIGHTNESS_QUERY,
      );
      const s = String(res).trim().toLowerCase();
      if (s === "err_cmd") return 50;
      return Number(res);
    } catch {
      return 50;
    }
  }
  async _adcpSetBrightness(val) {
    if (typeof this.adcpClient.setBrightness === "function")
      return this.adcpClient.setBrightness(val);
    return this.adcpClient.executeCommand(ADCP_COMMANDS.BRIGHTNESS_SET(val));
  }

  async _adcpGetErrorCode() {
    try {
      if (typeof this.adcpClient.getErrorCode === "function")
        return this.adcpClient.getErrorCode();
      const res = await this.adcpClient.executeCommand(
        ADCP_COMMANDS.ERROR_CODE,
      );
      const s = String(res).trim().toLowerCase();
      if (s === "err_cmd") return 0;
      return Number(res) || 0;
    } catch {
      return 0;
    }
  }

  async _adcpGetLampHours() {
    try {
      if (typeof this.adcpClient.getLampHours === "function")
        return this.adcpClient.getLampHours();
      const res = await this.adcpClient.executeCommand(
        ADCP_COMMANDS.LAMP_HOURS,
      );
      const s = String(res).trim().toLowerCase();
      if (s === "err_cmd") return 0;
      return Number(res) || 0;
    } catch {
      return 0;
    }
  }

  async _adcpSetTestPattern(code) {
    if (typeof this.adcpClient.setTestPattern === "function")
      return this.adcpClient.setTestPattern(code);
    return this.adcpClient.executeCommand(ADCP_COMMANDS.TEST_PATTERN_SET(code));
  }
  // Hint Homebridge/HomeKit that this accessory is a Television (affects icon/category)
  getCategory() {
    return this.api.hap.Categories.TELEVISION;
  }
}

module.exports = SonyProjectorAccessory;
