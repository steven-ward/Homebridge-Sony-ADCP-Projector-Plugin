"use strict";

const EventEmitter = require("events");

/**
 * A minimal mock of net.Socket that captures writes and lets tests
 * simulate server responses by emitting 'data' events.
 */
class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.written = []; // all data passed to write()
  }

  connect(_port, _host, cb) {
    // Simulate async connect
    setImmediate(cb);
    return this;
  }

  write(data) {
    if (this.destroyed) return false;
    this.written.push(data);
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }

  setKeepAlive() {}

  // Helper: simulate projector sending a response line
  respond(line) {
    this.emit("data", Buffer.from(line + "\r\n"));
  }

  // Helper: simulate raw data (no newline appended)
  respondRaw(data) {
    this.emit("data", Buffer.from(data));
  }
}

module.exports = { MockSocket };
