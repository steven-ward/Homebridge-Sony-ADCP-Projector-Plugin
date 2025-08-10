const net = require('net');
const os = require('os');

const ADCP_PORT = 53484;
const TIMEOUT = 1000;
const CMD = 'POWR?\r\n';

function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ipParts = iface.address.split('.');
        ipParts[3] = '0';
        return ipParts.join('.') + '/24';
      }
    }
  }
  throw new Error('No valid IPv4 interface found.');
}

function getIPsInRange(subnet) {
  const [base, mask] = subnet.split('/');
  const baseParts = base.split('.').map(Number);
  const ips = [];
  for (let i = 1; i < 255; i++) {
    ips.push(`${baseParts[0]}.${baseParts[1]}.${baseParts[2]}.${i}`);
  }
  return ips;
}

function tryProjector(ip) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let found = false;

    socket.setTimeout(TIMEOUT);
    socket.connect(ADCP_PORT, ip, () => {
      socket.write(CMD);
    });

    socket.on('data', (data) => {
      const response = data.toString().trim();
      if (response.startsWith('POWR=')) {
        found = true;
        resolve({ ip, response });
      }
      socket.destroy();
    });

    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => resolve(null));
    socket.on('close', () => {
      if (!found) resolve(null);
    });
  });
}

(async () => {
  const subnet = getLocalSubnet();
  const ips = getIPsInRange(subnet);

  console.log(`Scanning subnet ${subnet} for Sony projectors...`);

  const checks = ips.map(tryProjector);
  const results = await Promise.all(checks);

  const devices = results.filter(Boolean);
  if (devices.length) {
    console.log('Found projector(s):');
    devices.forEach(({ ip, response }) => {
      console.log(` - ${ip}: ${response}`);
    });
  } else {
    console.log('No Sony projectors found.');
  }
})();