// accessory.js
const ADCP = require('./adcp');

class SonyProjectorAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.name = config.name || 'Sony Projector';

    // Configuration options
    this.ip = config.ip;
    this.adcpPort = config.adcpPort || 53484;
    this.username = config.username;
    this.password = config.password;
    this.useAuth = config.useAuth !== undefined ? config.useAuth : true;
    this.logging = config.logging || 'standard';

    // Initialize ADCP client
    this.adcpClient = new ADCP(
      this.ip,
      this.adcpPort,
      this.username,
      this.password,
      this.log,
      this.useAuth
    );

    // Homebridge Service and Characteristic
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // Create a new Switch service
    this.service = new this.Service.Switch(this.name);

    // Handle on/off events
    this.service
      .getCharacteristic(this.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));
  }

  getServices() {
    // Information Service
    const informationService = new this.Service.AccessoryInformation()
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sony')
      .setCharacteristic(this.Characteristic.Model, 'VPL-XW5000ES')
      .setCharacteristic(this.Characteristic.SerialNumber, 'Unknown');

    return [informationService, this.service];
  }

  // Handle getting the current power state
  async handleOnGet() {
    try {
      const powerState = await this.adcpClient.getPowerState();
      return powerState;
    } catch (error) {
      this.log.error('Error getting power state:', error);
      throw new this.api.hap.HapStatusError(-70402); // Service communication failure
    }
  }

  // Handle setting the power state
  async handleOnSet(value) {
    try {
      await this.adcpClient.setPowerState(value);
      this.log.info(`Projector turned ${value ? 'on' : 'off'}`);
    } catch (error) {
      this.log.error('Error setting power state:', error);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }
}

module.exports = SonyProjectorAccessory;