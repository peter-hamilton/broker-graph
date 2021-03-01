const BaseResource = require('./base-resource.js');
const util = require('util');


/**
 * A static resource associated with an application.
 * @class
 * @memberof client
 * @param {Broker} broker - Parent Broker instance. 
 * @param {*} data 
 */ 
var StaticResource = module.exports = function(broker, data) {
  BaseResource.call(this, broker, "static", data);

  this.application = broker.applications[data.application];
};

util.inherits(StaticResource, BaseResource);

StaticResource.init = function(broker, params) {
  var aid = params.application;
  var rid = params.id;
  var resource = broker._resourceMap[aid] && broker._resourceMap[aid][rid];
  if (resource) { //check for existing
    return Promise.resolve(broker._resourceMap[aid][rid]);
  }

  //use cache value, while loading from database
  if (broker._cache) {
    var cachedData = broker._cache[broker.host + "/brl/resources/" + aid + "/" + rid];
    if (cachedData) {
      resource = new StaticResource(broker, cachedData);
      broker._updateRes(resource);
      broker.emit("resource_updated", {
        type: "added",
        value: resource
      });
    }
  }

  var db = broker._db;
  var path = ["resources", aid, rid];

  return db
    .get(path)
    .then(function(data) {
      if (!data) {
        return Promise.reject("Invalid resource: doesn't exist at: " + path);
      }
      if (!resource) {
        resource = new StaticResource(broker, data);
        broker._addResource(resource);
        broker.emit("resource_updated", {
          type: "added",
          value: resource
        });
      }

      return Promise.resolve(resource);
    });
}

StaticResource.prototype.get = function(key) {
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

StaticResource.prototype.hasRelayed = function() {
  var self = this;
  return self.brl in self._broker._tags;
};

StaticResource.prototype.createRelay = function(props) {
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

StaticResource.prototype.paths = function() {
  var self = this;
  return self
    ._broker
    .paths(self.brl);
};

StaticResource.prototype.applicationPaths = function() {
  var self = this;
  return self
    ._broker
    .applicationPaths(self.brl);
};

StaticResource.prototype.launch = function(args) {
  var self = this;
  return self
    ._broker
    .launch(self, args);
};

StaticResource.prototype._remove = function() {
  var self = this;
  delete self
    ._broker
    ._resourceMap[self.application.id][self.id] //HACK:bad idea...
  self.emit("removed", self);
  self.emit("updated", {
    type: "removed",
    value: self
  });
  //TODO: move out

  self
    ._broker
    .emit("resource_updated", {
      type: "removed",
      value: self
    });
};
