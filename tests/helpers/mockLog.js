"use strict";

function makeMockLog() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

module.exports = { makeMockLog };
