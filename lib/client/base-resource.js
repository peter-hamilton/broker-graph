const Resource = require('../structures/resource');
const EventEmitter = require('events').EventEmitter;
const util = require('util');

/**
 * Abstract class for wrapped resources used by broker client
 * @param  {} broker
 * @param  {} resourceType
 * @param  {} data
 */
var BaseResource = module.exports = function(broker, resourceType, data) {
  if (!broker) {
    throw new Error("Broker instance must be passed as an argument")
  }

  this._broker = broker;
  this.resourceType = resourceType;

  this._data = new Resource(data);
  this.id = this._data.id;
  this.brl = this._data.brl;
  this.key = this._data.key;
  this.static = this._data.static || false;
}

util.inherits(BaseResource, EventEmitter);

//DEPRECATED: use meta
BaseResource.prototype.get = function(key) {
  if (!this._data) {
    return null;
  }
  if (key) {
    return this
      ._data
      .arguments[key];
  }
  return this._data.arguments;
};

BaseResource.prototype.hasRelayed = function() {
  var self = this;
  var brl = self.relay
    ? self.relay.brl
    : self.brl;
  return (self.resourceType === "static") || (brl in self._broker._localRelays);
};

BaseResource.prototype.createRelay = function(props) {
  var self = this;

  var relayResource = self
    ._broker
    .share()
    .value(self.brl);
  if (props) {
    relayResource.meta(props);
  }

  return relayResource.update();
};

BaseResource.prototype.paths = function() {
  var self = this;
  var brl = self.relay
    ? self.relay.brl
    : self.brl;
  return self
    ._broker
    .paths(brl);
};

BaseResource.prototype.applicationPaths = function() {
  var self = this;
  return self
    ._broker
    .applicationPaths(self.brl);
};

BaseResource.prototype.launch = function(args) {
  var self = this;
  return self
    ._broker
    .launch(self, args);
};

BaseResource.prototype.expand = function(options) {
  var self = this;
  return self
    ._broker
    .expand(self, options);
};

BaseResource.prototype.meta = function(keys) {
  var self = this;
  if (Array.isArray(keys)) {
    var result = {};
    keys.forEach(function(key) {
      result[key] = self
        ._data
        .meta[key];
    })
    return result;
  } else if (typeof(keys) === "string") {
    return self
      ._data
      .meta[keys];
  }

  return self._data.meta;
};

BaseResource.prototype.ignore = function() {
  var self = this;
  //HACK:bad idea...
  delete self
    ._broker
    ._resourceMap[self.application.id][self.id]
  self.emit("removed", self);
  self.emit("updated", {
    type: "removed",
    value: self
  });

  self
    ._broker
    .emit("resource_updated", {
      type: "removed",
      value: self
    });
};
