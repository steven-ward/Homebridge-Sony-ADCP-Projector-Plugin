// snmp.js
const snmp = require('net-snmp');

class SNMP {
  constructor(ip, port, community, log) {
    this.ip = ip;
    this.port = port;
    this.community = community;
    this.log = log;

    this.session = snmp.createSession(this.ip, this.community, {
      port: this.port,
    });
  }

  // Get status information from the projector
  getStatus() {
    return new Promise((resolve, reject) => {
      const oids = [
        '1.3.6.1.4.1.x.x.x.x', // Replace with actual OIDs
        // Add more OIDs as needed
      ];

      this.session.get(oids, (error, varbinds) => {
        if (error) {
          this.log.error('SNMP error:', error);
          reject(error);
        } else {
          const status = {};
          varbinds.forEach((vb) => {
            if (snmp.isVarbindError(vb)) {
              this.log.error('SNMP varbind error:', snmp.varbindError(vb));
            } else {
              status[vb.oid] = vb.value.toString();
            }
          });
          resolve(status);
        }
      });
    });
  }
}

module.exports = SNMP;