var BaseReference = require("./base-reference.js");

class Connection extends BaseReference {
  constructor(args) {
    if (!args) {
      args = {};
    } else if (typeof args === "string") {
      args = JSON.parse(args);
    }
    super(args);
    this.type = "connection";
    this.parent = args.parent || null;
    this.source = args.source || null;
    this.target = args.target || null;
    this.key = Connection.generateKey(this.source, this.target);
    this.pendingConnectionKey = args.pendingConnectionKey || null;
    this.timestamp = args.timestamp || null;

    this.active = args.active || true;
  }

  //(a,b) == (b,a) == key
  static generateKey(a, b) {
    if (a.localeCompare(b) === -1) {
      return a + b;
    }
    return b + a;
  }
}

Connection.INFO_ID = "info";

module.exports = Connection; 