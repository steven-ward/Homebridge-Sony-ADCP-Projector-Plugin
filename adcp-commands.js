/**
 * Centralized ADCP command catalog for Sony projectors.
 * Reference: Sony Protocol Manual – Supported Command List.
 */
const ADCP_COMMANDS = {
  // Power
  POWER_ON: 'power "on"',
  POWER_OFF: 'power "off"',
  POWER_STATUS: "power_status ?",

  // Device info
  MODEL_NAME: "modelname ?",
  MODEL_QUERY: "modelname ?",
  SERIAL_NUMBER: "serialnum ?",
  SERIAL_QUERY: "serialnum ?",
  FIRMWARE_QUERY: "version ?",

  // Network info
  IPV4_ADDRESS: "ip_address ?",
  IPV4_NETWORK_SETTING: "network_setting ?",

  // Errors / warnings
  ERROR_STATUS: "error ?",
  WARNING_STATUS: "warning ?",
  ERROR_CODE: "error ?",

  // Inputs
  INPUT_QUERY: "input ?",
  INPUT_SET: (source) => `input "${source}"`,

  // Picture / brightness
  BRIGHTNESS_QUERY: "brightness ?",
  BRIGHTNESS_SET: (val) => `brightness ${val}`,
  CONTRAST_QUERY: "contrast ?",
  CONTRAST_SET: (val) => `contrast ${val}`,
  GAMMA_SET: (mode) => `gamma_correction "${mode}"`,

  // Picture modes
  PICTURE_MODE_QUERY: "picture_mode ?",
  PICTURE_MODE_SET: (mode) => `picture_mode "${mode}"`,

  // HDR
  HDR_MODE_QUERY: "hdr ?",
  HDR_MODE_SET: (mode) => `hdr "${mode}"`,

  // Video mute / blank
  VIDEO_MUTE_QUERY: "blank ?",
  VIDEO_MUTE_SET: (flag) => `blank "${flag ? "on" : "off"}"`,

  // Test patterns
  TEST_PATTERN_SET: (code) => `test_pattern "${code}"`,

  // Lamp/Laser hours
  LAMP_HOURS: "version ?",
};

module.exports = { ADCP_COMMANDS };
