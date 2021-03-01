const BaseResource = require('./base-resource.js');
const util = require('util');


/**
 * A relay shared by another Broker, accessible through a Broker Connection.
 * @class
 * @memberof client
 * @param {Broker} broker - Parent Broker instance.
 * @param {Object} data
 */
var RemoteResource = module.exports = function(broker, data) {
  BaseResource.call(this, broker, "remote", data);
  this.application = this
    ._broker
    .applications[data.application];
  this._callbacks = {};
  this._update(data);

};

util.inherits(RemoteResource, BaseResource);

RemoteResource.fromBRL = RemoteResource.init = function(broker, aid, rid) {
  if (broker._resourceMap[aid] && broker._resourceMap[aid][rid]) { //check for existing
    return Promise.resolve(broker._resourceMap[aid][rid]);
  }

  return broker
    .ready
    .then(function() {
      var db = broker._db;
      var path = ["resources", aid, rid];
      var initRes = db
        .get(path)
        .then(function(data) {
          if (!data) {
            return Promise.reject("Invalid resource");
          }

          var resource = new RemoteResource(broker, data);
          db.onValue(path, resource._update.bind(resource));
          broker._addResource(resource);
          return Promise.resolve(resource)
        });
      //include parent application resources
      var initApp = broker._includeApp(aid);
      return Promise
        .all([initRes, initApp])
        .then(function(results) {
          var resource = results[0];
          resource
            .application
            .resources[resource.id] = resource;

          broker.emit("resource_updated", {
            type: "added",
            value: resource
          });
          resource.emit("added", resource);
          resource.emit("updated", {
            type: "added",
            value: resource
          });
          return resource; //return resource
        });
    });
}

var _initRemoteResource = function(broker) {}

RemoteResource.fromCachedData = function(broker, data) {
  if (!data) {
    throw new Error("data argument must be object");
  }
  if (!data.brl) {
    throw new Error("data argument must have brl value");
  }

  var resource = broker._brlMap[data];
  if (resource) { //already exists
    return resource
  }

  resource = new RemoteResource(broker, data);
  resource.state = "cached";
  broker._addResource(resource);

  broker
    .ready
    .then(function() {
      var db = broker._db;
      var path = ["resources", aid, rid];
      var initRes = db
        .get(path)
        .then(function(data) {
          if (!data) {
            return Promise.reject("Invalid resource");
          }

          var resource = new RemoteResource(broker, data);
          db.onValue(path, resource._update.bind(resource));
          return Promise.resolve(resource)
        });
      //include parent application resources
      var initApp = broker._includeApp(aid);

      return Promise
        .all([initRes, initApp])
        .then(function(results) {
          var resource = results[0];
          resource
            .application
            .resources[resource.id] = resource;

          broker.emit("resource_updated", {
            type: "added",
            value: resource
          });
          resource.emit("added", resource);
          resource.emit("updated", {
            type: "added",
            value: resource
          });
          return resource; //return resource
        });
    });
  return resource;
}

RemoteResource.prototype.getId = function() {
  return this._data.id;
};

RemoteResource.prototype.getAction = function() {
  return this._data.action;
};

RemoteResource.prototype._update = function(data) {
  var self = this;

  if (data) {
    self._data = data;
    self.action = data.action;
    self.parent = data.parent;

    if (data.relay) {
      self.relay = Object.assign({}, data.relay);
      self
        ._broker
        ._remoteRelays[self.relay.brl] = self
        ._broker
        ._remoteRelays[self.relay.brl] || {};
      self
        ._broker
        ._remoteRelays[self.relay.brl][self.brl] = self._data.meta;
      var target = self
        ._broker
        ._resourceMap[data.relay.application] && self
        ._broker
        ._resourceMap[data.relay.application][data.relay.id]

      if (target) {
        self.relay.source = target;
      } else {
        self
          ._broker
          .include(data.relay.brl)
          .then(function(result) {
            if (result) {
              self.relay.source = result;
            }
          })
          .catch(function(e) {
            //TODO:
          });
      }
    }

    //TODO: hack
    var val = data.relay
      ? data.relay.value
      : data.value;
    if (val) {
      //TODO: handle changing values
      var valueResources = self
        ._broker
        ._values[val];
      if (!valueResources) {
        valueResources = self
          ._broker
          ._values[val] = {};
      }
      valueResources[self.brl] = self._data.meta;
    }

    self
      ._broker
      .emit("resource_updated", {
        type: "changed",
        value: self
      });
    self.emit("changed", self);
    self.emit("updated", {
      type: "changed",
      value: self
    });
  } else {
    self._remove();
  }
};

RemoteResource.prototype._remove = function() {
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

RemoteResource.prototype.get = function(key) {
  if (key) {
    return this
      ._data
      .arguments[key];
  }
  return this._data.arguments;
};

RemoteResource.prototype.isApplicationDefault = function() {
  var self = this;
  return !!self
    .application
    ._resourcesById[self.id];
};

RemoteResource.prototype.call = function(key, args) {
  if (!key in this._data.callbacks) {
    console.warn("This callback key (" + key + ") isn't exposed by this resource");
  }
  return this
    ._broker
    ._call(this._data.parent, this._data.id, key, args);
};

RemoteResource.prototype.launch = function(args) {
  var self = this;
  return self
    ._broker
    .launch(self, args);
};

RemoteResource.prototype.callbackParams = function(key) {
  var self = this;
  return self
    ._data
    .callbacks[key];
}

RemoteResource.prototype.callback = function(key) {
  var self = this;
  return {
    params: self
      ._data
      .callbacks[key],
    call: function(args) {
      return self.call(key, args);
    }
  };
}

RemoteResource.prototype.callbacks = function(query) {
  var self = this;
  var result = {};
  var params;
  for (var key in self._data.callbacks) {
    callback = self.callback(key);
    //filter based on query and params

    result[key] = callback;
  }
  return result;
};

RemoteResource.prototype.relayOf = function() {
  var self = this;
  if (self._data.relay) {
    return self._data.relay.key;
  }
  return null;
}

RemoteResource.prototype.relayingApplications = function() {

  return null;
};

RemoteResource.prototype.createRelay = function(props) {
  var self = this;

  if (self._data.relay) {
    if (self._data.relay.application === broker._application) {
      var localResource = broker.shared[self._data.relay.id];
      if (localResource) {
        return Promise.reject("can't relay local resource");
      }
    }
  }

  var relayResource = self
    ._broker
    .share()
    .value(self.brl);
  if (props) {
    relayResource.meta(props);
  }
  var rid = relayResource.id;

  //TODO: move
  self.on("removed", function() {
    var relayed = self
      ._broker
      .shared[rid];
    if (relayed) {
      relayed.remove();
    }
  });

  return relayResource.update();
};
