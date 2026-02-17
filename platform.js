// platform.js - Platform wrapper for Sony ADCP Projector
// Publishes TV accessories as external accessories with proper TELEVISION category

const ADCP = require("./adcp");

const PLUGIN_NAME = "homebridge-sony-adcp-projector";

class SonyProjectorPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    // Validate required config
    if (!this.config.ip) {
      this.log.error(
        "No projector IP address configured. Plugin will not start.",
      );
      return;
    }

    this.accessories = [];

    this.api.on("didFinishLaunching", () => {
      this.log.debug("didFinishLaunching");
      this.discoverDevices();
    });
  }

  /**
   * Called by Homebridge to restore cached accessories.
   * For external TV accessories, we typically don't restore - we recreate fresh.
   */
  configureAccessory(accessory) {
    this.log.info("Loading accessory from cache:", accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Discover and publish the projector as an external TV accessory.
   */
  discoverDevices() {
    const uuid = this.api.hap.uuid.generate(
      `${PLUGIN_NAME}-${this.config.ip}-${this.config.name || "SonyProjector"}`,
    );

    // Check if accessory already exists in cache
    const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);

    if (existingAccessory) {
      this.log.info(
        "Restoring existing accessory from cache:",
        existingAccessory.displayName,
      );
      // Update accessory context with latest config
      existingAccessory.context.config = this.config;
      this.setupAccessory(existingAccessory);
    } else {
      this.log.info(
        "Adding new accessory:",
        this.config.name || "Sony Projector",
      );
      const accessory = new this.api.platformAccessory(
        this.config.name || "Sony Projector",
        uuid,
        this.api.hap.Categories.TELEVISION, // This is the key - sets TV category!
      );
      accessory.context.config = this.config;
      this.setupAccessory(accessory);

      // Publish as external accessory (required for TV accessories)
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    }
  }

  /**
   * Set up all services on the accessory.
   */
  setupAccessory(accessory) {
    const { Service, Characteristic } = this.api.hap;
    const config = accessory.context.config;

    // Store references for handlers
    this.accessory = accessory;
    this.Service = Service;
    this.Characteristic = Characteristic;

    // Config
    this.name = config.name || "Sony Projector";
    this.ip = config.ip;
    const port = Number.parseInt(config.adcpPort, 10);
    this.adcpPort = Number.isInteger(port) ? port : 53595;
    this.password = config.password;
    this.useAuth = config.useAuth ?? false;
    this.timeout = (config.timeout || 5) * 1000;

    // Logging
    this.logging = config.logging || "standard";
    this.debug =
      this.logging === "debug" && this.log && this.log.debug
        ? this.log.debug.bind(this.log)
        : () => {};

    // Input mapping
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

    // Feature flags
    this.enablePolling = config.enablePolling ?? true;
    const intervalSec = Number(config.pollingInterval) || 30;
    this.pollingIntervalMs = Math.min(300, Math.max(10, intervalSec)) * 1000;
    this._pollingTimer = null;

    // Optional feature flags (match config.schema.json field names)
    this.enableBlankScreen = config.enableBlankScreen ?? true;
    this.enableBrightness = config.enableBrightness ?? true;
    this.enableContrast = config.enableContrast ?? false;
    this.enableLampHours = config.enableLampHoursSensor ?? true;
    this.enablePictureModes = config.enablePictureModes ?? false;
    this.enableHdrModes = config.enableHdrSelector ?? true;
    this.enableErrorSensor = config.enableErrorSensor ?? false;
    this.enableTestPatterns = config.enableTestPatterns ?? false;
    this.testPatterns = Array.isArray(config.testPatterns)
      ? config.testPatterns
      : [
          { name: "Off", code: "off" },
          { name: "Grid", code: "grid" },
          { name: "Color Bars", code: "color_bars" },
        ];

    // Picture modes from config - VPL-XW5000 uses string codes
    this.pictureModes = Array.isArray(config.pictureModes)
      ? config.pictureModes
      : [
          { name: "Reference", code: "reference" },
          { name: "Cinema Film 1", code: "cinema_film_1" },
          { name: "Cinema Film 2", code: "cinema_film_2" },
          { name: "Game", code: "game" },
          { name: "IMAX", code: "imax" },
        ];

    // HDR modes from config - VPL-XW5000 uses string codes
    this.hdrModes = Array.isArray(config.hdrModes)
      ? config.hdrModes
      : [
          { name: "HDR Auto", code: "auto" },
          { name: "HDR10", code: "hdr10" },
          { name: "HLG", code: "hlg" },
          { name: "HDR Off", code: "off" },
        ];

    // State caches
    this.powerState = false;
    this.currentInput = this.inputs[0]?.id ?? 1;
    this.blankScreenState = false;
    this.brightnessValue = 50;
    this.contrastValue = 50;
    this.lampHours = 0;
    this.currentPictureMode = "reference"; // String for VPL-XW5000
    this.currentHdrMode = "auto"; // String for VPL-XW5000
    this.hasError = false;
    this._stateCache = new Map();

    // ADCP client
    this.adcpClient = new ADCP(
      this.ip,
      this.adcpPort,
      undefined,
      this.password,
      this.log,
      this.useAuth,
      this.timeout,
    );
    this.adcpClient.setDebug(this.logging === "debug");
    this.adcpClient.on("connected", ({ authenticated }) => {
      this.debug(`ADCP connected (auth=${authenticated})`);
    });
    this.adcpClient.on("disconnected", ({ reason }) => {
      this.log.warn(
        `[SonyProjector] ADCP disconnected${reason ? ` (${reason})` : ""}`,
      );
      this.powerState = false;
      this.tvService?.updateCharacteristic(this.Characteristic.Active, 0);
      this._completePowerTransition(false);
    });
    this.adcpClient.on("error", (error) => {
      this.log.warn(`[SonyProjector] ADCP error: ${error?.message || error}`);
    });

    // Setup services
    this.setupInformationService(accessory);
    this.setupTelevisionService(accessory);
    this.setupTelevisionSpeaker(accessory);
    this.setupInputSources(accessory);

    // Optional services
    if (this.enableBlankScreen) this.setupBlankScreenSwitch(accessory);
    if (this.enableBrightness) this.setupBrightnessControl(accessory);
    if (this.enableContrast) this.setupContrastControl(accessory);
    if (this.enableLampHours) this.setupLampHoursSensor(accessory);
    if (this.enablePictureModes) this.setupPictureModeSwitches(accessory);
    if (this.enableHdrModes) this.setupHdrModeSwitches(accessory);
    if (this.enableTestPatterns) this.setupTestPatternSwitches(accessory);
    if (this.enableErrorSensor) this.setupErrorSensor(accessory);

    // Start polling
    if (this.enablePolling) {
      this._startPolling();
    }

    // Graceful shutdown
    this.api.on("shutdown", () => {
      this._stopPolling();
      try {
        this.adcpClient.shutdown();
      } catch {}
    });
  }

  setupInformationService(accessory) {
    this.infoService =
      accessory.getService(this.Service.AccessoryInformation) ||
      accessory.addService(this.Service.AccessoryInformation);

    // Set defaults initially
    this.infoService
      .setCharacteristic(this.Characteristic.Manufacturer, "Sony")
      .setCharacteristic(
        this.Characteristic.Model,
        this.config.staticModel || "Sony Projector",
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        this.config.staticSerial || "Unknown",
      )
      .setCharacteristic(this.Characteristic.FirmwareRevision, "Unknown");

    // Query real values from projector asynchronously
    this._updateDeviceInfo();
  }

  async _updateDeviceInfo() {
    try {
      const [model, serial, firmware] = await Promise.all([
        this.adcpClient.getModelName(),
        this.adcpClient.getSerialNumber(),
        this.adcpClient.getFirmwareVersion(),
      ]);

      if (model) {
        this.infoService.updateCharacteristic(this.Characteristic.Model, model);
        this.debug(`Model: ${model}`);
      }
      if (serial) {
        this.infoService.updateCharacteristic(
          this.Characteristic.SerialNumber,
          serial,
        );
        this.debug(`Serial: ${serial}`);
      }
      if (firmware) {
        this.infoService.updateCharacteristic(
          this.Characteristic.FirmwareRevision,
          firmware,
        );
        this.debug(`Firmware: ${firmware}`);
      }
    } catch (e) {
      this.debug("Failed to get device info:", e?.message);
    }
  }

  setupTelevisionService(accessory) {
    this.tvService =
      accessory.getService(this.Service.Television) ||
      accessory.addService(this.Service.Television, this.name, "television");

    this.tvService
      .setCharacteristic(this.Characteristic.ConfiguredName, this.name)
      .setCharacteristic(
        this.Characteristic.SleepDiscoveryMode,
        this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      )
      .setCharacteristic(
        this.Characteristic.CurrentMediaState,
        this.Characteristic.CurrentMediaState.STOP,
      )
      .setCharacteristic(
        this.Characteristic.TargetMediaState,
        this.Characteristic.TargetMediaState.STOP,
      );

    // Power (Active) - return cached value immediately, polling updates it
    this.tvService
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => {
        // Trigger async refresh in background
        this._refreshPowerState();
        return this.powerState ? 1 : 0;
      })
      .onSet(async (value) => {
        const targetOn = value === 1;
        this._beginPowerTransition(targetOn);
        try {
          await this.adcpClient.setPowerState(targetOn);
          this.powerState = targetOn;
          // Poll in background until projector settles (warm-up / cool-down)
          this._postPowerPoll(targetOn).catch(() => {});
        } catch (e) {
          this.log.error("Power set failed:", e?.message);
          this._completePowerTransition(this.powerState);
          throw new this.api.hap.HapStatusError(-70402);
        }
      });

    // ActiveIdentifier (input selection)
    this.tvService
      .getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onGet(() => this.currentInput)
      .onSet(async (id) => {
        const input = this.inputs.find((i) => i.id === id);
        if (!input) {
          throw new this.api.hap.HapStatusError(-70408);
        }
        try {
          await this.adcpClient.setInputSource(input.adcp);
          this.currentInput = id;
        } catch (e) {
          this.log.error("Input change failed:", e?.message);
          throw new this.api.hap.HapStatusError(-70402);
        }
      });

    // RemoteKey
    this.tvService
      .getCharacteristic(this.Characteristic.RemoteKey)
      .onSet(async (key) => {
        const mapping = {
          [this.Characteristic.RemoteKey.ARROW_UP]: 'key "up"',
          [this.Characteristic.RemoteKey.ARROW_DOWN]: 'key "down"',
          [this.Characteristic.RemoteKey.ARROW_LEFT]: 'key "left"',
          [this.Characteristic.RemoteKey.ARROW_RIGHT]: 'key "right"',
          [this.Characteristic.RemoteKey.SELECT]: 'key "enter"',
          [this.Characteristic.RemoteKey.BACK]: 'key "return"',
          [this.Characteristic.RemoteKey.EXIT]: 'key "menu"',
          [this.Characteristic.RemoteKey.PLAY_PAUSE]: 'key "playpause"',
          [this.Characteristic.RemoteKey.REWIND]: 'key "rewind"',
          [this.Characteristic.RemoteKey.FAST_FORWARD]: 'key "fastforward"',
          [this.Characteristic.RemoteKey.NEXT_TRACK]: 'key "next"',
          [this.Characteristic.RemoteKey.PREVIOUS_TRACK]: 'key "prev"',
          [this.Characteristic.RemoteKey.INFORMATION]: 'key "menu"',
        };
        const cmd = mapping[key];
        if (cmd) {
          try {
            await this.adcpClient.executeCommand(cmd);
          } catch (e) {
            this.debug("RemoteKey failed:", e?.message);
          }
        }
      });
  }

  setupTelevisionSpeaker(accessory) {
    this.speakerService =
      accessory.getService(this.Service.TelevisionSpeaker) ||
      accessory.addService(
        this.Service.TelevisionSpeaker,
        "Speaker",
        "speaker",
      );

    this.speakerService
      .setCharacteristic(
        this.Characteristic.Active,
        this.Characteristic.Active.ACTIVE,
      )
      .setCharacteristic(
        this.Characteristic.VolumeControlType,
        this.Characteristic.VolumeControlType.NONE,
      );

    // Link speaker to TV
    this.tvService.addLinkedService(this.speakerService);
  }

  setupInputSources(accessory) {
    this.inputIdToAdcp = {};

    this.inputs.forEach((input) => {
      const subtype = `input-${input.id}`;
      let inputService = accessory.getServiceById(
        this.Service.InputSource,
        subtype,
      );

      if (!inputService) {
        inputService = accessory.addService(
          this.Service.InputSource,
          input.name,
          subtype,
        );
      }

      inputService
        .setCharacteristic(this.Characteristic.Identifier, input.id)
        .setCharacteristic(this.Characteristic.ConfiguredName, input.name)
        .setCharacteristic(
          this.Characteristic.IsConfigured,
          this.Characteristic.IsConfigured.CONFIGURED,
        )
        .setCharacteristic(
          this.Characteristic.InputSourceType,
          this.Characteristic.InputSourceType.HDMI,
        );

      this.tvService.addLinkedService(inputService);
      this.inputIdToAdcp[input.id] = input.adcp;
    });
  }

  // ===== OPTIONAL SERVICES =====

  setupBlankScreenSwitch(accessory) {
    this.blankScreenService =
      accessory.getService("Blank Screen") ||
      accessory.addService(this.Service.Switch, "Blank Screen", "blank-screen");

    this.blankScreenService.setCharacteristic(
      this.Characteristic.Name,
      "Blank Screen",
    );

    // Add ConfiguredName if available (for proper HomeKit labeling)
    if (
      this.blankScreenService.getCharacteristic(
        this.Characteristic.ConfiguredName,
      )
    ) {
      this.blankScreenService.setCharacteristic(
        this.Characteristic.ConfiguredName,
        "Blank Screen",
      );
    }

    this.blankScreenService
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.blankScreenState)
      .onSet(async (value) => {
        try {
          await this.adcpClient.setVideoMute(value);
          this.blankScreenState = value;
        } catch (e) {
          this.log.error("Blank screen set failed:", e?.message);
          throw new this.api.hap.HapStatusError(-70402);
        }
      });

    this.tvService.addLinkedService(this.blankScreenService);
  }

  setupBrightnessControl(accessory) {
    this.brightnessService =
      accessory.getService("Brightness") ||
      accessory.addService(this.Service.Lightbulb, "Brightness", "brightness");

    this.brightnessService.setCharacteristic(
      this.Characteristic.Name,
      "Brightness",
    );

    if (
      this.brightnessService.getCharacteristic(
        this.Characteristic.ConfiguredName,
      )
    ) {
      this.brightnessService.setCharacteristic(
        this.Characteristic.ConfiguredName,
        "Brightness",
      );
    }

    this.brightnessService
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.powerState)
      .onSet(async () => {
        // No-op — tied to power state (controlled via Television Active)
      });

    this.brightnessService
      .getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.brightnessValue)
      .onSet(async (value) => {
        try {
          await this.adcpClient.setBrightness(value);
          this.brightnessValue = value;
        } catch (e) {
          this.log.error("Brightness set failed:", e?.message);
        }
      });

    this.tvService.addLinkedService(this.brightnessService);
  }

  setupContrastControl(accessory) {
    this.contrastService =
      accessory.getService("Contrast") ||
      accessory.addService(this.Service.Lightbulb, "Contrast", "contrast");

    this.contrastService.setCharacteristic(
      this.Characteristic.Name,
      "Contrast",
    );

    if (
      this.contrastService.getCharacteristic(this.Characteristic.ConfiguredName)
    ) {
      this.contrastService.setCharacteristic(
        this.Characteristic.ConfiguredName,
        "Contrast",
      );
    }

    this.contrastService
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.powerState)
      .onSet(async () => {
        // Ignore - just tied to power state
      });

    this.contrastService
      .getCharacteristic(this.Characteristic.Brightness)
      .onGet(() => this.contrastValue)
      .onSet(async (value) => {
        try {
          await this.adcpClient.setContrast(value);
          this.contrastValue = value;
        } catch (e) {
          this.log.error("Contrast set failed:", e?.message);
        }
      });

    this.tvService.addLinkedService(this.contrastService);
  }

  setupLampHoursSensor(accessory) {
    // Use LightSensor to display lamp hours as lux value
    this.lampHoursService =
      accessory.getService("Lamp Hours") ||
      accessory.addService(
        this.Service.LightSensor,
        "Lamp Hours",
        "lamp-hours",
      );

    this.lampHoursService.setCharacteristic(
      this.Characteristic.Name,
      "Lamp Hours",
    );

    if (
      this.lampHoursService.getCharacteristic(
        this.Characteristic.ConfiguredName,
      )
    ) {
      this.lampHoursService.setCharacteristic(
        this.Characteristic.ConfiguredName,
        "Lamp Hours",
      );
    }

    this.lampHoursService
      .getCharacteristic(this.Characteristic.CurrentAmbientLightLevel)
      .setProps({ minValue: 0, maxValue: 100000 })
      .onGet(() => Math.max(0.0001, this.lampHours)); // Min 0.0001 required by HomeKit

    this.tvService.addLinkedService(this.lampHoursService);
  }

  setupPictureModeSwitches(accessory) {
    this.pictureModeServices = [];

    this.pictureModes.forEach((mode) => {
      const subtype = `pmode-${mode.code}`;
      let svc = accessory.getServiceById(this.Service.Switch, subtype);

      if (!svc) {
        svc = accessory.addService(this.Service.Switch, mode.name, subtype);
      }

      svc.setCharacteristic(this.Characteristic.Name, mode.name);
      if (svc.getCharacteristic(this.Characteristic.ConfiguredName)) {
        svc.setCharacteristic(this.Characteristic.ConfiguredName, mode.name);
      }

      svc
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => this.currentPictureMode === mode.code)
        .onSet(async (value) => {
          if (value) {
            try {
              await this.adcpClient.setPictureMode(mode.code);
              this.currentPictureMode = mode.code;
              // Turn off other picture mode switches
              this._updatePictureModeSwitches();
            } catch (e) {
              this.log.error("Picture mode set failed:", e?.message);
            }
          }
        });

      this.tvService.addLinkedService(svc);
      this.pictureModeServices.push({ service: svc, code: mode.code });
    });
  }

  _updatePictureModeSwitches() {
    this.pictureModeServices?.forEach(({ service, code }) => {
      service.updateCharacteristic(
        this.Characteristic.On,
        this.currentPictureMode === code,
      );
    });
  }

  setupHdrModeSwitches(accessory) {
    this.hdrModeServices = [];

    this.hdrModes.forEach((mode) => {
      const subtype = `hdr-${mode.code}`;
      let svc = accessory.getServiceById(this.Service.Switch, subtype);

      if (!svc) {
        svc = accessory.addService(this.Service.Switch, mode.name, subtype);
      }

      svc.setCharacteristic(this.Characteristic.Name, mode.name);
      if (svc.getCharacteristic(this.Characteristic.ConfiguredName)) {
        svc.setCharacteristic(this.Characteristic.ConfiguredName, mode.name);
      }

      svc
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => this.currentHdrMode === mode.code)
        .onSet(async (value) => {
          if (value) {
            try {
              await this.adcpClient.setHdrMode(mode.code);
              this.currentHdrMode = mode.code;
              // Turn off other HDR mode switches
              this._updateHdrModeSwitches();
            } catch (e) {
              this.log.error("HDR mode set failed:", e?.message);
            }
          }
        });

      this.tvService.addLinkedService(svc);
      this.hdrModeServices.push({ service: svc, code: mode.code });
    });
  }

  _updateHdrModeSwitches() {
    this.hdrModeServices?.forEach(({ service, code }) => {
      service.updateCharacteristic(
        this.Characteristic.On,
        this.currentHdrMode === code,
      );
    });
  }

  setupTestPatternSwitches(accessory) {
    this.testPatternServices = [];

    this.testPatterns.forEach((pattern) => {
      const subtype = `tpat-${pattern.code}`;
      let svc = accessory.getServiceById(this.Service.Switch, subtype);

      if (!svc) {
        svc = accessory.addService(this.Service.Switch, pattern.name, subtype);
      }

      svc.setCharacteristic(this.Characteristic.Name, pattern.name);
      if (svc.getCharacteristic(this.Characteristic.ConfiguredName)) {
        svc.setCharacteristic(this.Characteristic.ConfiguredName, pattern.name);
      }

      svc
        .getCharacteristic(this.Characteristic.On)
        .onGet(() => false) // Test patterns are momentary
        .onSet(async (value) => {
          if (value) {
            try {
              await this.adcpClient.setTestPattern(pattern.code);
              // Turn off switch after a moment (test patterns are momentary)
              setTimeout(() => {
                svc.updateCharacteristic(this.Characteristic.On, false);
              }, 500);
            } catch (e) {
              this.log.error("Test pattern set failed:", e?.message);
            }
          }
        });

      this.tvService.addLinkedService(svc);
      this.testPatternServices.push({ service: svc, code: pattern.code });
    });
  }

  setupErrorSensor(accessory) {
    this.errorSensorService =
      accessory.getService("Error Status") ||
      accessory.addService(
        this.Service.ContactSensor,
        "Error Status",
        "error-status",
      );

    this.errorSensorService.setCharacteristic(
      this.Characteristic.Name,
      "Error Status",
    );

    if (
      this.errorSensorService.getCharacteristic(
        this.Characteristic.ConfiguredName,
      )
    ) {
      this.errorSensorService.setCharacteristic(
        this.Characteristic.ConfiguredName,
        "Error Status",
      );
    }

    this.errorSensorService
      .getCharacteristic(this.Characteristic.ContactSensorState)
      .onGet(() =>
        this.hasError
          ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.Characteristic.ContactSensorState.CONTACT_DETECTED,
      );

    this.tvService.addLinkedService(this.errorSensorService);
  }

  // ===== STATE REFRESH =====

  /**
   * Refresh all states asynchronously and update HomeKit
   */
  async _refreshAllStates() {
    await this._refreshPowerState();

    // Only refresh other states if projector is on
    if (this.powerState) {
      await Promise.all([
        this._refreshActiveIdentifier(),
        this._refreshBlankScreen(),
        this._refreshBrightness(),
        this._refreshContrast(),
        this._refreshLampHours(),
        this._refreshPictureMode(),
        this._refreshHdrMode(),
        this._refreshErrorStatus(),
      ]);
    }
  }

  async _refreshPowerState() {
    try {
      const on = await this.adcpClient.getPowerState();
      if (on !== this.powerState) {
        this.powerState = on;
        this.tvService?.updateCharacteristic(
          this.Characteristic.Active,
          on ? 1 : 0,
        );
        this.brightnessService?.updateCharacteristic(
          this.Characteristic.On,
          on,
        );
        this.contrastService?.updateCharacteristic(this.Characteristic.On, on);
        this._completePowerTransition(on);
        this.debug(`Power state updated: ${on ? "on" : "off"}`);
      }
    } catch (e) {
      this.debug("Power refresh error:", e?.message);
    }
  }

  // ── Power transition helpers ────────────────────────────────────────────────

  _beginPowerTransition(targetOn) {
    try {
      this.tvService?.updateCharacteristic(
        this.Characteristic.CurrentMediaState,
        targetOn
          ? this.Characteristic.CurrentMediaState.LOADING
          : this.Characteristic.CurrentMediaState.INTERRUPTED,
      );
    } catch (e) {
      this.debug("beginPowerTransition failed:", e?.message);
    }
  }

  _completePowerTransition(isOn) {
    try {
      this.tvService?.updateCharacteristic(
        this.Characteristic.CurrentMediaState,
        isOn
          ? this.Characteristic.CurrentMediaState.PLAY
          : this.Characteristic.CurrentMediaState.STOP,
      );
    } catch (e) {
      this.debug("completePowerTransition failed:", e?.message);
    }
  }

  async _postPowerPoll(targetOn) {
    const deadline = Date.now() + 30000; // 30s warm-up / cool-down window
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const on = await this.adcpClient.getPowerState();
        if (on === targetOn) {
          this._completePowerTransition(on);
          return;
        }
      } catch {
        // transient; keep polling
      }
    }
    // Timed out — settle on current cached state
    this._completePowerTransition(this.powerState);
  }

  // ────────────────────────────────────────────────────────────────────────────

  async _refreshActiveIdentifier() {
    try {
      const adcpInput = await this.adcpClient.getInputIdentifier();
      if (adcpInput === "unknown") return;
      // Reverse-lookup: find the numeric id whose adcp value matches
      const entry = Object.entries(this.inputIdToAdcp).find(
        ([, v]) => v === adcpInput,
      );
      if (entry === undefined) return;
      const numId = Number(entry[0]);
      if (numId !== this.currentInput) {
        this.currentInput = numId;
        this.tvService?.updateCharacteristic(
          this.Characteristic.ActiveIdentifier,
          numId,
        );
        this.debug(`Active input updated: ${adcpInput} (id ${numId})`);
      }
    } catch (e) {
      this.debug("Input refresh error:", e?.message);
    }
  }

  async _refreshBlankScreen() {
    if (!this.enableBlankScreen) return;
    try {
      const muted = await this.adcpClient.getVideoMute();
      if (muted !== this.blankScreenState) {
        this.blankScreenState = muted;
        this.blankScreenService?.updateCharacteristic(
          this.Characteristic.On,
          muted,
        );
      }
    } catch (e) {
      this.debug("Blank screen refresh error:", e?.message);
    }
  }

  async _refreshBrightness() {
    if (!this.enableBrightness) return;
    try {
      const val = await this.adcpClient.getBrightness();
      if (val !== this.brightnessValue) {
        this.brightnessValue = val;
        this.brightnessService?.updateCharacteristic(
          this.Characteristic.Brightness,
          val,
        );
      }
    } catch (e) {
      this.debug("Brightness refresh error:", e?.message);
    }
  }

  async _refreshContrast() {
    if (!this.enableContrast) return;
    try {
      const val = await this.adcpClient.getContrast();
      if (val !== this.contrastValue) {
        this.contrastValue = val;
        this.contrastService?.updateCharacteristic(
          this.Characteristic.Brightness,
          val,
        );
      }
    } catch (e) {
      this.debug("Contrast refresh error:", e?.message);
    }
  }

  async _refreshLampHours() {
    if (!this.enableLampHours) return;
    try {
      const hours = await this.adcpClient.getLampHours();
      if (hours !== this.lampHours) {
        this.lampHours = hours;
        this.lampHoursService?.updateCharacteristic(
          this.Characteristic.CurrentAmbientLightLevel,
          Math.max(0.0001, hours),
        );
        this.debug(`Lamp hours: ${hours}`);
      }
    } catch (e) {
      this.debug("Lamp hours refresh error:", e?.message);
    }
  }

  async _refreshPictureMode() {
    if (!this.enablePictureModes) return;
    try {
      const mode = await this.adcpClient.getPictureMode();
      if (mode !== this.currentPictureMode) {
        this.currentPictureMode = mode;
        this._updatePictureModeSwitches();
      }
    } catch (e) {
      this.debug("Picture mode refresh error:", e?.message);
    }
  }

  async _refreshHdrMode() {
    if (!this.enableHdrModes) return;
    try {
      const mode = await this.adcpClient.getHdrMode();
      if (mode !== this.currentHdrMode) {
        this.currentHdrMode = mode;
        this._updateHdrModeSwitches();
      }
    } catch (e) {
      this.debug("HDR mode refresh error:", e?.message);
    }
  }

  async _refreshErrorStatus() {
    if (!this.enableErrorSensor) return;
    try {
      const status = await this.adcpClient.getErrorStatus();
      const hasError = status?.raw !== "ok" && status?.raw !== "";
      if (hasError !== this.hasError) {
        this.hasError = hasError;
        this.errorSensorService?.updateCharacteristic(
          this.Characteristic.ContactSensorState,
          hasError
            ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.Characteristic.ContactSensorState.CONTACT_DETECTED,
        );
        if (hasError) this.log.warn("Projector error detected:", status);
      }
    } catch (e) {
      this.debug("Error status refresh error:", e?.message);
    }
  }

  _startPolling() {
    if (this._pollingTimer) return;
    this.debug(`Starting polling every ${this.pollingIntervalMs / 1000}s`);

    // Immediate initial poll to get current state
    this._refreshAllStates();

    this._pollingTimer = setInterval(() => {
      this._refreshAllStates();
    }, this.pollingIntervalMs);
  }

  _stopPolling() {
    if (this._pollingTimer) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = null;
    }
  }
}

module.exports = SonyProjectorPlatform;
