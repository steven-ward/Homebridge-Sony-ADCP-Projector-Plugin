// index.js
const SonyProjectorPlatform = require("./platform");

const PLUGIN_NAME = "homebridge-sony-adcp-projector";
const PLATFORM_NAME = "SonyProjector";

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SonyProjectorPlatform);
};
