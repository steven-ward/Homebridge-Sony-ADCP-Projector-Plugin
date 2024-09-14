// index.js
const SonyProjectorAccessory = require('./accessory');

module.exports = (homebridge) => {
  homebridge.registerAccessory(
    'homebridge-sony-adcp-projector',
    'SonyProjector',
    SonyProjectorAccessory
  );

  // Listen for the shutdown event
  homebridge.on('shutdown', () => {
    if (SonyProjectorAccessory.prototype.shutdown) {
      SonyProjectorAccessory.prototype.shutdown();
    }
  });
};