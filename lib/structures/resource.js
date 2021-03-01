var BaseReference = require("./base-reference.js");

  /**
 * Broker Graph representation of a digital resource.
 * @class
 * @extends BaseReference
 * @param {String} brl - Broker Resource Locator (BRL) = [hostname] + [path/to/resource].
 * @param {String} application - The source application BRL.
 * @param {String} type - The type of resource.
 * @param {} meta - Object containing metadata describing the resource and how to use it.
 */
class Resource extends BaseReference {
  constructor(args) {
    args = BaseReference.parseArgs(args);
    super(args);
    this.type = "resource";
    this.parent = args.parent || null;
    this.path = this.key = "/brl/resources/" + this.application + "/" + this.id; //'/' is an illegal character for id and applications

    this.static = args.static || false;
    this.timestamp = args.timestamp || null;

    this.value = args.value || null;
    this.tag = args.tag || null;
    this.action = args.action || "get";
    this.callbacks = args.callbacks || {};
    this.relay = args.relay || null;
  }

  // key() {
  //   if (!this.parent) {
  //     throw new Error("No parent");
  //   }

  //   return this.parent + "/brl/resources/" + this.action + "/" + this.type;
  // }
}

module.exports = Resource;