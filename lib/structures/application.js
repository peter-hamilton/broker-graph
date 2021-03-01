var BaseReference = require("./base-reference.js");

class Application extends BaseReference {
  constructor(args={}) {
    super(args);
    this.type = "application";
    this.application = this.id;
    this.resources = args.resources || [];
  }
}

module.exports = Application; 