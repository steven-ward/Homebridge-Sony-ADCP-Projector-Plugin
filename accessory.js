// accessory.js – Television-style HomeKit accessory for Sony ADCP projectors
const ADCP = require('./adcp');

class SonyProjectorAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.name = config.name || 'Sony Projector';

    // Config
    this.ip = config.ip;
    // Parse and validate ADCP port
    const port = Number.parseInt(config.adcpPort, 10);
    this.adcpPort = Number.isInteger(port) ? port : 53595;
    if (this.adcpPort < 1 || this.adcpPort > 65535) {
      this.log.warn(`[SonyProjector] Invalid ADCP port '${config.adcpPort}', falling back to 53595`);
      this.adcpPort = 53595;
    }
    this.password = config.password;
    this.useAuth = config.useAuth ?? false; // projector ADCP "Requires Authentication"
    this.timeout = (config.timeout || 5) * 1000; // ms (adcp.js already enforces per-command)

    // Optional device info and logging level
    this.staticModel = config.staticModel;
    this.staticSerial = config.staticSerial;
    this.logging = config.logging || 'standard';
    this.debug = (this.logging === 'debug' && this.log && this.log.debug)
      ? this.log.debug.bind(this.log)
      : () => {};

    // Optional input mapping from config
    this.inputs = Array.isArray(config.inputs) ? config.inputs : [
      { id: 1, name: 'HDMI 1', adcp: 'hdmi1' },
      { id: 2, name: 'HDMI 2', adcp: 'hdmi2' },
    ];

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
    this.adcpClient.setDebug(this.logging === 'debug');

    // HAP handles
    const { Service, Characteristic } = this.api.hap;
    this.Service = Service;
    this.Characteristic = Characteristic;

    // ===== Services =====
    // Accessory Information (uses static overrides when provided)
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Sony')
      .setCharacteristic(Characteristic.Model, this.staticModel || 'Sony Projector');

    if (this.staticSerial) {
      this.informationService.setCharacteristic(Characteristic.SerialNumber, this.staticSerial);
    }

    // Television service (drives TV UI & icon)
    this.television = new Service.Television(this.name);
    this.television
      .setCharacteristic(Characteristic.ConfiguredName, this.name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
    // Set HomeKit category hint for TV
    // this.television.setCharacteristic(Characteristic.Category, this.api.hap.Categories.TELEVISION);

    // Power (Active)
    this.television.getCharacteristic(Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    // Inputs: ActiveIdentifier + linked InputSource services
    this.inputIdToAdcp = {};
    this.currentInput = this.inputs[0]?.id ?? 1;

    this.television.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.currentInput)
      .onSet(this.handleActiveIdentifierSet.bind(this));
    // RemoteKey characteristic
    this.television.getCharacteristic(Characteristic.RemoteKey)
      .onSet(this.handleRemoteKeyPress.bind(this));

    // Create & link InputSource services
    this._inputServices = [];
    this.inputs.forEach(({ id, name, adcp }) => {
      const input = new Service.InputSource(`in-${id}`, `in-${id}`);
      input
        .setCharacteristic(Characteristic.Identifier, id)
        .setCharacteristic(Characteristic.ConfiguredName, name)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.HDMI)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
      this.television.addLinkedService(input);
      this._inputServices.push(input);
      this.inputIdToAdcp[id] = adcp;
    });

    // Speaker (mute/volume – can be expanded later)
    this.speaker = new Service.TelevisionSpeaker();
    this.speaker
      .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
      .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
    this.television.addLinkedService(this.speaker);

    // Cache
    this.powerState = false; // boolean ON/OFF

    // Defer async initialization until Homebridge finishes launching
    this.api.on('didFinishLaunching', () => {
      this._initAsync().catch(err => this.debug('initAsync error:', err?.message));
    });

    // Graceful shutdown
    this.api.on('shutdown', () => {
      try { this.adcpClient.shutdown(); } catch {}
    });
  }

  // ===== Information =====
  async getSerialNumber() {
    try {
      const resp = await this.adcpClient.executeCommand('serialnum ?');
      return resp || 'Unknown';
    } catch (error) {
      this.debug('Serial query failed:', error.message);
      return 'Unknown';
    }
  }

  getServices() {
    // Return synchronously per Homebridge Accessory API
    return [
      this.informationService,
      this.television,
      this.speaker,
      ...this._inputServices,
    ];
  }

  // ===== Async initializer (runs after launch) =====
  async _initAsync() {
    try {
      if (this.staticSerial) {
        // User provided serial; no need to query projector on startup
        return;
      }
      const serial = await this.adcpClient.executeCommand('serialnum ?');
      if (serial) {
        this.informationService.updateCharacteristic(this.Characteristic.SerialNumber, serial);
      }
    } catch (error) {
      this.debug('Serial query failed:', error.message);
    }
  }

  // ===== Power handlers =====
  async handleActiveGet() {
    try {
      const on = await this.adcpClient.getPowerState();
      this.powerState = on;
      return on ? 1 : 0;
    } catch (error) {
      // Keep Home UI responsive; return last known
      this.debug('Active get failed, returning cached:', error.message);
      return this.powerState ? 1 : 0;
    }
  }

  async handleActiveSet(value) {
    const targetOn = value === 1;
    try {
      await this.adcpClient.setPowerState(targetOn);
      this.powerState = targetOn;
      // Reflect warm-up / cool-down state to Home within ~30s
      await this._postPowerPoll(targetOn);
    } catch (error) {
      this.log.error('Power change failed:', error.message);
      // Busy / transient error
      throw new this.api.hap.HapStatusError(-70402);
    }
  }

  async _postPowerPoll(targetOn) {
    const deadline = Date.now() + 30000; // 30s
    while (Date.now() < deadline) {
      try {
        const on = await this.adcpClient.getPowerState();
        if (on === targetOn) return;
      } catch { /* ignore transient */ }
      await new Promise(r => setTimeout(r, 2000));
    }
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
      this.log.error('Input change failed:', error.message);
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
      this.log.error('RemoteKey command failed:', error.message);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }
}

module.exports = SonyProjectorAccessory;