"use strict";

const { ADCP_COMMANDS } = require("./adcp-commands");

describe("ADCP_COMMANDS catalog", () => {
  describe("string constants", () => {
    const stringConstants = [
      ["POWER_ON", 'power "on"'],
      ["POWER_OFF", 'power "off"'],
      ["POWER_STATUS", "power_status ?"],
      ["MODEL_NAME", "modelname ?"],
      ["MODEL_QUERY", "modelname ?"],
      ["SERIAL_NUMBER", "serialnum ?"],
      ["SERIAL_QUERY", "serialnum ?"],
      ["FIRMWARE_QUERY", "version ?"],
      ["LAMP_HOURS", "version ?"],
      ["ERROR_STATUS", "error ?"],
      ["ERROR_CODE", "error ?"],
      ["WARNING_STATUS", "warning ?"],
      ["INPUT_QUERY", "input ?"],
      ["BRIGHTNESS_QUERY", "brightness ?"],
      ["CONTRAST_QUERY", "contrast ?"],
      ["PICTURE_MODE_QUERY", "picture_mode ?"],
      ["HDR_MODE_QUERY", "hdr ?"],
      ["VIDEO_MUTE_QUERY", "blank ?"],
      ["IPV4_ADDRESS", "ip_address ?"],
      ["IPV4_NETWORK_SETTING", "network_setting ?"],
    ];

    test.each(stringConstants)(
      "%s is defined and is a string",
      (key, expected) => {
        expect(ADCP_COMMANDS[key]).toBe(expected);
      },
    );
  });

  describe("factory functions", () => {
    test("INPUT_SET generates correct command", () => {
      expect(ADCP_COMMANDS.INPUT_SET("hdmi1")).toBe('input "hdmi1"');
      expect(ADCP_COMMANDS.INPUT_SET("hdmi2")).toBe('input "hdmi2"');
    });

    test("BRIGHTNESS_SET generates correct command", () => {
      expect(ADCP_COMMANDS.BRIGHTNESS_SET(50)).toBe("brightness 50");
      expect(ADCP_COMMANDS.BRIGHTNESS_SET(0)).toBe("brightness 0");
      expect(ADCP_COMMANDS.BRIGHTNESS_SET(100)).toBe("brightness 100");
    });

    test("CONTRAST_SET generates correct command", () => {
      expect(ADCP_COMMANDS.CONTRAST_SET(75)).toBe("contrast 75");
    });

    test("GAMMA_SET generates correct command", () => {
      expect(ADCP_COMMANDS.GAMMA_SET("2.2")).toBe('gamma_correction "2.2"');
    });

    test("PICTURE_MODE_SET generates correct command", () => {
      expect(ADCP_COMMANDS.PICTURE_MODE_SET("cinema_film_1")).toBe(
        'picture_mode "cinema_film_1"',
      );
    });

    test("HDR_MODE_SET generates correct command", () => {
      expect(ADCP_COMMANDS.HDR_MODE_SET("auto")).toBe('hdr "auto"');
    });

    test("VIDEO_MUTE_SET generates blank on for truthy", () => {
      expect(ADCP_COMMANDS.VIDEO_MUTE_SET(true)).toBe('blank "on"');
      expect(ADCP_COMMANDS.VIDEO_MUTE_SET(1)).toBe('blank "on"');
    });

    test("VIDEO_MUTE_SET generates blank off for falsy", () => {
      expect(ADCP_COMMANDS.VIDEO_MUTE_SET(false)).toBe('blank "off"');
      expect(ADCP_COMMANDS.VIDEO_MUTE_SET(0)).toBe('blank "off"');
    });

    test("TEST_PATTERN_SET generates correct command", () => {
      expect(ADCP_COMMANDS.TEST_PATTERN_SET("grid")).toBe(
        'test_pattern "grid"',
      );
      expect(ADCP_COMMANDS.TEST_PATTERN_SET("off")).toBe('test_pattern "off"');
    });
  });

  describe("no undefined constants", () => {
    test("all catalog values are defined (no missing keys)", () => {
      for (const [, value] of Object.entries(ADCP_COMMANDS)) {
        expect(value).toBeDefined();
        expect(typeof value === "string" || typeof value === "function").toBe(
          true,
        );
      }
    });
  });
});
