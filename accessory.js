// accessory.js
const ADCP = require('./adcp');

class SonyProjectorAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.name = config.name || 'Sony Projector';

    // Configuration options
    this.ip = config.ip;
    this.adcpPort = config.adcpPort || 53595; // Default port changed to 53595
    this.username = config.username;
    this.password = config.password;
    this.useAuth = config.useAuth !== undefined ? config.useAuth : true;
    this.timeout = (config.timeout || 60) * 1000; // Convert seconds to milliseconds
    this.logging = config.logging || 'standard';

    // Initialize ADCP client with the timeout setting
    this.adcpClient = new ADCP(
      this.ip,
      this.adcpPort,
      this.username,
      this.password,
      this.log,
      this.useAuth,
      this.timeout
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

    // Cached power state
    this.powerState = false;
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
      // Set a timeout for the getPowerState method
      const powerState = await this.promiseTimeout(
        this.adcpClient.getPowerState(),
        this.timeout,
        'Timeout getting power state'
      );
      this.powerState = powerState;
      return powerState;
    } catch (error) {
      this.log.error('Error getting power state:', error);
      // Return the cached power state to prevent Homebridge from slowing down
      return this.powerState;
    }
  }

  // Handle setting the power state
  async handleOnSet(value) {
    try {
      await this.adcpClient.setPowerState(value);
      this.powerState = value;
      this.log.info(`Projector turned ${value ? 'on' : 'off'}`);
    } catch (error) {
      this.log.error('Error setting power state:', error);
      throw new this.api.hap.HapStatusError(-70402);
    }
  }

  // Helper method to add a timeout to a promise
  promiseTimeout(promise, ms, timeoutError) {
    // Create a promise that rejects in <ms> milliseconds
    const timeout = new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(timeoutError));
      }, ms);
    });
    // Returns a race between timeout and the passed promise
    return Promise.race([promise, timeout]);
  }
}

module.exports = SonyProjectorAccessory;