// index.js
const SonyProjectorAccessory = require('./accessory');

module.exports = (api) => {
  api.registerAccessory(
    'homebridge-sony-adcp-projector',
    'SonyProjector',
    SonyProjectorAccessory
  );
};