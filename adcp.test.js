"use strict";

const { MockSocket } = require("./tests/helpers/mockNet");
const { makeMockLog } = require("./tests/helpers/mockLog");

// ── Mock net before requiring ADCP ────────────────────────────────────────────
let mockSocket;
jest.mock("net", () => ({
  Socket: jest.fn(() => mockSocket),
}));

const ADCP = require("./adcp");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdcp(overrides = {}) {
  const log = makeMockLog();
  const adcp = new ADCP(
    overrides.ip ?? "192.168.1.100",
    overrides.port ?? 53595,
    undefined, // username (unused)
    overrides.password ?? "",
    log,
    overrides.useAuth ?? false,
    overrides.timeout ?? 500,
  );
  adcp.debounceMs = 0; // disable pacing in unit tests
  return { adcp, log };
}

/**
 * Connect the ADCP client and let the mock socket confirm connection.
 * Returns a promise that resolves once ADCP considers itself connected.
 */
async function connectAdcp(adcp) {
  const p = adcp.connect();
  // setImmediate inside MockSocket.connect fires the "connected" callback
  await new Promise((r) => setImmediate(r));
  return p;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockSocket = new MockSocket();
  jest.useFakeTimers({ doNotFake: ["setImmediate", "Promise"] });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Connection cooldown
// ─────────────────────────────────────────────────────────────────────────────
describe("connection cooldown", () => {
  test("blocks reconnect while cooldown is active", async () => {
    const { adcp } = makeAdcp();
    // Simulate a recent failure
    adcp._lastConnectionFailure = Date.now();
    await expect(adcp.connect()).rejects.toThrow("Connection cooldown active");
  });

  test("allows reconnect after cooldown expires", async () => {
    const { adcp } = makeAdcp();
    adcp._lastConnectionFailure = Date.now() - adcp._connectionCooldownMs - 1;
    // Should not throw — socket.connect will be called
    const p = adcp.connect();
    await new Promise((r) => setImmediate(r)); // let socket.connect fire callback
    await p;
    expect(adcp.isAuthenticated).toBe(true); // no-auth mode
  });

  test("sets cooldown on socket error", async () => {
    const { adcp } = makeAdcp();
    adcp.on("error", () => {}); // prevent unhandled-error crash
    const p = adcp.connect();
    // Emit error synchronously before the setImmediate connect-callback fires
    mockSocket.emit("error", new Error("ECONNREFUSED"));
    await expect(p).rejects.toThrow();
    expect(adcp._lastConnectionFailure).toBeGreaterThan(0);
  });

  test("clears cooldown on successful connect", async () => {
    const { adcp } = makeAdcp();
    adcp._lastConnectionFailure = 1; // pretend there was an old failure
    await connectAdcp(adcp);
    expect(adcp._lastConnectionFailure).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. handleData — line parsing
// ─────────────────────────────────────────────────────────────────────────────
describe("handleData", () => {
  test("resolves queued command with single response line", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const cmdPromise = adcp.sendCommand("power_status ?");
    mockSocket.respond('"on"');
    await expect(cmdPromise).resolves.toBe('"on"');
  });

  test("handles response split across multiple data chunks", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const cmdPromise = adcp.sendCommand("power_status ?");
    mockSocket.respondRaw('"on'); // first chunk — no newline
    mockSocket.respondRaw('"\r\n'); // second chunk completes the line
    await expect(cmdPromise).resolves.toBe('"on"');
  });

  test("ignores NOKEY banner lines", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const cmdPromise = adcp.sendCommand("power_status ?");
    // NOKEY arrives before the real response
    mockSocket.respond("NOKEY");
    mockSocket.respond('"on"');
    await expect(cmdPromise).resolves.toBe('"on"');
  });

  test("ignores blank lines", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const cmdPromise = adcp.sendCommand("power_status ?");
    mockSocket.respondRaw("\r\n"); // blank line
    mockSocket.respond('"on"');
    await expect(cmdPromise).resolves.toBe('"on"');
  });

  test("handles multiple responses for sequential commands", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const p1 = adcp.sendCommand("power_status ?");
    const p2 = adcp.sendCommand("modelname ?");
    mockSocket.respond("ok");
    mockSocket.respond('"VPL-XW5000"');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("ok");
    expect(r2).toBe('"VPL-XW5000"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Internal parsers
// ─────────────────────────────────────────────────────────────────────────────
describe("parsers", () => {
  let adcp;
  beforeEach(() => {
    ({ adcp } = makeAdcp());
  });

  describe("_isOk", () => {
    test.each([
      ["ok", true],
      ["OK", true],
      ["ok with extra", true],
      ["error", false],
      ["", false],
      [null, false],
      [undefined, false],
    ])("_isOk(%p) === %p", (input, expected) => {
      expect(adcp._isOk(input)).toBe(expected);
    });
  });

  describe("_toBool01", () => {
    test.each([
      ["on", 1],
      ["ON", 1],
      ["true", 1],
      ["off", 0],
      ["0", 0],
      ["1", 1],
      ["ok", 1],
      [null, 0],
      [undefined, 0],
    ])("_toBool01(%p) === %p", (input, expected) => {
      expect(adcp._toBool01(input)).toBe(expected);
    });
  });

  describe("_toNumber", () => {
    test.each([
      ["42", 42],
      [" 10 ", 10],
      ["0", 0],
      ["not-a-number", 0],
      ["", 0],
    ])("_toNumber(%p) === %p", (input, expected) => {
      expect(adcp._toNumber(input)).toBe(expected);
    });

    test("uses custom default for NaN", () => {
      expect(adcp._toNumber("bad", 99)).toBe(99);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Disconnect behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("disconnect", () => {
  test("rejects all queued commands immediately", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    // Queue a command but don't respond
    const cmdPromise = adcp.sendCommand("power_status ?");
    adcp.disconnect();
    await expect(cmdPromise).rejects.toThrow("Disconnected");
  });

  test("clears responseBuffer on disconnect", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    adcp.responseBuffer = "partial";
    adcp.disconnect();
    expect(adcp.responseBuffer).toBe("");
  });

  test("sets isAuthenticated to false on disconnect", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    expect(adcp.isAuthenticated).toBe(true);
    adcp.disconnect();
    expect(adcp.isAuthenticated).toBe(false);
  });

  test("emits disconnected event when socket closes", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const spy = jest.fn();
    adcp.on("disconnected", spy);
    mockSocket.destroy(); // triggers 'close' → adcp.disconnect() → emit('disconnected')
    expect(spy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Auth flow (useAuth = true)
// ─────────────────────────────────────────────────────────────────────────────
describe("authenticate", () => {
  test("sends sha256(nonce+password) and resolves on ok", async () => {
    const crypto = require("crypto");
    const password = "secret";
    const nonce = "abc123nonce";
    const { adcp } = makeAdcp({ useAuth: true, password });

    const connectP = adcp.connect();
    // Let socket.connect fire callback
    await new Promise((r) => setImmediate(r));
    // Projector sends nonce
    mockSocket.respond(nonce);
    // Projector confirms auth
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("ok");
    await connectP;

    const expectedHash = crypto
      .createHash("sha256")
      .update(nonce + password, "utf8")
      .digest("hex");

    expect(mockSocket.written).toContain(expectedHash + "\r\n");
    expect(adcp.isAuthenticated).toBe(true);
  });

  test("rejects on auth error response", async () => {
    const { adcp } = makeAdcp({ useAuth: true, password: "wrong" });
    adcp.on("error", () => {}); // prevent unhandled-error crash

    const connectP = adcp.connect();
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("somenonce");
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("err:auth_failed");
    await expect(connectP).rejects.toThrow();
  });

  test("resolves immediately when projector sends NOKEY in auth mode", async () => {
    const { adcp } = makeAdcp({ useAuth: true });

    const connectP = adcp.connect();
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("NOKEY");
    await connectP;
    expect(adcp.isAuthenticated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Command queue serialization
// ─────────────────────────────────────────────────────────────────────────────
describe("command queue (_enqueueCommand)", () => {
  test("commands execute sequentially, not concurrently", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const order = [];

    // Fire 3 commands in parallel
    const p1 = adcp.executeCommand("cmd1").then((r) => {
      order.push("cmd1:" + r);
      return r;
    });
    const p2 = adcp.executeCommand("cmd2").then((r) => {
      order.push("cmd2:" + r);
      return r;
    });
    const p3 = adcp.executeCommand("cmd3").then((r) => {
      order.push("cmd3:" + r);
      return r;
    });

    // Respond to each in sequence — they must not interleave
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("r1");
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("r2");
    await new Promise((r) => setImmediate(r));
    mockSocket.respond("r3");

    await Promise.all([p1, p2, p3]);

    // Commands were queued, so written order should be cmd1, cmd2, cmd3
    const written = mockSocket.written.filter((w) => w.startsWith("cmd"));
    expect(written).toEqual(["cmd1\r\n", "cmd2\r\n", "cmd3\r\n"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. High-level API methods
// ─────────────────────────────────────────────────────────────────────────────
// Helper: let the _enqueueCommand promise chain reach sendCommand before
// we respond. executeCommand schedules via Promise.then chains, so we need
// a few event-loop ticks after calling the high-level method.
async function flushQueue() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("getPowerState", () => {
  test('returns true when projector responds with "on"', async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const p = adcp.getPowerState();
    await flushQueue();
    mockSocket.respond('"on"');
    await expect(p).resolves.toBe(true);
  });

  test('returns false when projector responds with "standby"', async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const p = adcp.getPowerState();
    await flushQueue();
    mockSocket.respond('"standby"');
    await expect(p).resolves.toBe(false);
  });
});

describe("setPowerState", () => {
  test('sends power "on" command', async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const p = adcp.setPowerState(true);
    await flushQueue();
    mockSocket.respond("ok");
    await p;
    expect(mockSocket.written).toContain('power "on"\r\n');
  });

  test('sends power "off" command', async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const p = adcp.setPowerState(false);
    await flushQueue();
    mockSocket.respond("ok");
    await p;
    expect(mockSocket.written).toContain('power "off"\r\n');
  });

  test("throws when projector returns non-ok", async () => {
    const { adcp } = makeAdcp();
    await connectAdcp(adcp);

    const p = adcp.setPowerState(true);
    await flushQueue();
    mockSocket.respond("err");
    await expect(p).rejects.toThrow("Power set failed");
  });
});
