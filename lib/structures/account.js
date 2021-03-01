var BaseReference = require("./base-reference.js");

class Account extends BaseReference {
  constructor(args) {
    args = BaseReference.parseArgs(args);
    super(args);

    this.type = "account";
    this.requireLogin = args.requireLogin || false;
    this.persistent = args.persistent || args.identified || false;

    this.clients = args.clients || {};
    this.info = args.info || {};

  }
}

module.exports = Account;