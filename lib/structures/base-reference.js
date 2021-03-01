/**
 * Base class for all Broker Graph references.
 * @class
 * @memberof client
 * @param {Object} params - Object containing properties of reference object.
 * @param {String} params.brl - Broker Resource Locator (BRL) = [hostname] + [path/to/resource].
 * @param {String} params.id - Unique identifier. Randomly generated if not provided.
 * @param {String} params.application - The source application BRL.
 * @param {String} params.type - The type of resource.
 * @param {Object} params.meta - Object containing metadata describing the resource and how to use it.
 */
class BaseReference {
  constructor(params = {}) {
    /**
     * Unique identifier.
     * @type {String}
     */
    this.id = params.id || BaseReference.generateID();
    /**
     * URL of host Broker Graph server.
     * @type {String}
     */
    this.host = params.host || null;
    /**
     * The source application BRL.
     * @type {String}
     */
    this.application = params.application || null;
    /**
     * Type of Broker Graph reference.
     * @type {String}
     */
    this.type = params.type || null;
    /**
     * Broker Resource Locator (BRL) = [hostname] + [path/to/resource].
     * @type {String}
     */
    this.brl = params.brl || null;

    /**
     * Object containing metadata describing the resource and how to use it.
     * @type {Object}
     */
    this.meta = params.meta || params.arguments || {};
    this.arguments = this.meta; //TODO: arguments deprecated
  }

  static parseArgs(args) {
    if (!args) {
      args = {};
    } else if (typeof args === "string") {
      args = JSON.parse(args);
    }
    return args;
  }

  static fromJson(json) {
    var args = JSON.parse(json);
    return new this(args);
  }

  static generateID() {
    return require("uuid/v4")().slice(0, 8); //TODO: remove slice. uuid shortened for debugging
  }

  static toJson(ref) {
    return JSON.stringify(ref);
  }

  /**
   * Set the value for a metadata field.
   * @param {*} ref 
   * @param {*} key 
   * @param {*} value 
   */
  static setMeta(ref, key, value) {
    if (arguments.length !== 3) {
      throw new Error("Illegal Input");
    } else {
      ref.meta[key] = value;
    }
    return ref;
  }

  static assignMeta(ref, values) {
    if (arguments.length !== 2 || typeof values === "object") {
      throw new Error("Illegal Input");
    } else {
      Object.assign(ref.meta, values);
    }
    return ref;
  }

  static removeMeta(ref, key) {
    //TODO: check valid
    if (key && typeof key === "string") {
      delete ref.meta[key];
    } else {
      ref.meta = {};
    }
    return ref;
  }
}

module.exports = BaseReference;
