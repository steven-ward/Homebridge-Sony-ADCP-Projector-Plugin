const net = require('net');

const PROJECTOR_IP = '192.168.1.101';
const ADCP_PORT = 53595;
const TIMEOUT = 1000;
const CMD = 'POWR?\r\n';

function tryProjector(ip) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responseData = '';

    socket.setTimeout(TIMEOUT);
    socket.connect(ADCP_PORT, ip, () => {
      socket.write(CMD);
    });

    socket.on('data', (data) => {
      responseData += data.toString();
      socket.destroy();
    });

    socket.on('timeout', () => socket.destroy());
    socket.on('error', (err) => {
      resolve({ ip, error: err.message });
    });
    socket.on('close', () => {
      if (responseData.trim()) {
        resolve({ ip, response: responseData.trim() });
      } else {
        resolve({ ip, response: null });
      }
    });
  });
}

(async () => {
  console.log(`Validating ADCP connection to projector at ${PROJECTOR_IP}...`);

  const result = await tryProjector(PROJECTOR_IP);

  if (result.response) {
    console.log(`✅ Success: ${result.ip} responded with "${result.response}"`);
  } else if (result.error) {
    console.log(`❌ Error connecting to ${result.ip}: ${result.error}`);
  } else {
    console.log(`⚠️ No valid response from ${result.ip}.`);
  }
})();