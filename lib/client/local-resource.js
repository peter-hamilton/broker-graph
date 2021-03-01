const BaseResource = require('./base-resource.js');

const util = require('util');

/**
 * A resource shared by the local Broker client.
 * @class
 * @memberof client
 * @param {Broker} broker - Parent Broker instance. 
 * @param {*} data 
 */ 
var LocalResource = module.exports = function(broker, data) {

  BaseResource.call(this, broker, "local", data);
  this.parent = broker.id;
  this.brl = this._broker.host + "/brl/resources/" + this._broker._application + "/" + this.id;

  this.application = broker.applications[broker._application];

  this._synchedData = null;

  this._callbacks = {};
  this._callback = null;
  this._allow = broker.PUBLIC;
  this._relay = null;
  this.removed = false;
};

util.inherits(LocalResource, BaseResource);

LocalResource.init = function(broker, args) {
  if (args.id && broker.shared[args.id]) {
    throw new Error("Resource with same ID exists");
  }
  if (args.tag && broker._tags[args.tag]) {
    throw new Error("Resource with same Tag exists");
  }
  if (args.value && args.value in broker._localRelays) {
    throw new Error("Resource already being relayed");
  }
  var resource = new LocalResource(broker, args);
  broker.shared[resource.id] = resource;
  if (resource._data.tag) {
    broker._tags[resource._data.tag] = resource;
  }
  return resource;
}

//TODO
LocalResource.fromTag = function(broker, args) {}

LocalResource.prototype._updateRelay = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    if (self._data) {
      var parsed = self
        ._broker
        .parse(self._data.value);
      if (parsed && parsed.type === "resource") {
        var rrid = parsed.id;
        var raid = parsed.application;
        var target = self
          ._broker
          ._resourceMap[raid] && self
          ._broker
          ._resourceMap[raid][rrid];
        if (target) {
          return resolve(target);
        } else {
          return self
            ._broker
            .include(self._data.value)
            .then(function(result) {
              if (result) {
                return resolve(result);
              }
              return reject("invalid or expired brl");
            })
            .catch(function(e) {
              reject(e);
            });
        }
      }
    }
    return resolve(); //not a brl
  }).then(function(targetResource) {
    if (!targetResource) {
      return Promise.resolve();
    }
    var relay = self._data.relay = {};
    if (targetResource._relay) {
      relay.id = targetResource._relay.id;
      relay.application = targetResource._relay.application;
      relay.paths = targetResource._relay.paths;
    } else {
      var resId = relay.id = targetResource.id;
      var appId = relay.application = targetResource.application.id;
      relay.paths = Object.assign({}, self._broker._remoteRelays[relay.brl] || {});
    }
    relay.brl = self._data.value;
    if (self._broker._localRelays[relay.brl] && self._broker._localRelays[relay.brl] !== self) {
      return Promise.reject("relay already exists");
    }
    self
      ._broker
      ._localRelays[relay.brl] = self;
    return Promise.resolve(targetResource);
  });
};

LocalResource.prototype.sync = function() {
  var self = this;
  var tag = self._data.tag || self._data.id;
  return self
    ._broker
    ._db
    .get(["accounts", self._broker.id, "resources", tag])
    .then(function(result) {
      if (result) { //if exists
        var parsed = self
          ._broker
          .parse(result.brl);
        return self
          ._broker
          ._db
          .get(["resources", parsed.application, parsed.id])
          .then(function(resData) {
            self._synchedData = resData;
            self._data = resData;
            if (resData.id !== self.id) {
              delete self
                ._broker
                .shared[self.id];
              self.id = resData.id;
              self
                ._broker
                .shared[self.id] = self;
              self.brl = self._broker.host + "/brl/resources/" + self._broker._application + "/" + self.id;
            }

          });
      }
      return Promise.resolve(self); //doesn't exist on server
    });
};

LocalResource.prototype.update = function() {
  var self = this;
  return self
    ._broker
    .ready
    .then(function() {
      return self._updateRelay();
    })
    .then(function() {
      var operations = {};
      var updateBuilder = self
        ._broker
        ._db
        .UpdateBuilder();
      if (self._data) { //check if removed
        self._data.timestamp = self._broker.ServerValue.TIMESTAMP;
        self._data.application = self._broker._application;
        self._data.brl = self._broker.host + "/brl/resources/" + self._broker._application + "/" + self.id;
        self._data.meta.type = self._data.meta.type || "url"; //default
        var tag = self._data.tag = self._data.tag || self.id; //keys can't have '/'
        if (/[/]/.test(tag)) {
          throw new Error("illegal tag value: ");
        }

        if (self._callback) {
          if (self._data.relay) {
            return Promise.reject("Callback utility can't be set for a relay");
          }
          var callbackMeta = {
            params: self._callback.params,
            connection: self._broker._socket.io.engine.id,
            application: self._broker._application
          }
          self._data.meta.callback = callbackMeta;
          if (callbackMeta.params) {
            var template;
            Object
              .keys(callbackMeta.params)
              .forEach(function(key, i) {
                if (i === 0) {
                  template = "/?" + key + "={" + key + "}";
                } else {
                  template += "&" + key + "={" + key + "}";
                }
              });
            if (template) {
              self._data.meta.template = template;
            }
          }
        }
        updateBuilder.add([
          "accounts",
          self._broker.id,
          "clients",
          self._broker._socket.io.engine.id,
          "resources",
          self.id
        ], {
          id: self.id,
          tag: self._data.tag
        });

        updateBuilder.add([
          "accounts", self._broker.id, "resources", tag
        ], {"brl": self.brl});
        updateBuilder.add([
          "resources", self._broker._application, self.id
        ], self._data);
        if (self._allow) {
          // operationPromises.push(self._broker._db.set([
          //   "resources", self._broker.id, self._allow, self.id
          // ], self._data));
        }
      } else {
        updateBuilder.add([
          "accounts", self._broker.id, "clients", self._broker._socket.io.engine.id
        ], null);
        updateBuilder.add([
          "accounts", self._broker.id, "resources", self._synchedData.tag
        ], null);
        updateBuilder.add([
          "resources", self._broker._application, self.id
        ], null);
        if (self._allow) {
          // operationPromises.push(self._broker._db.remove(["rules", "resources", self._broker._application, self.id]));
        }
      }

      return updateBuilder
        .update()
        .then(function() {
          self._synchedData = Object.assign({}, self._data);
          self
            ._broker
            .emit("resource_updated", {
              type: "changed",
              value: self
            });
          return Promise.resolve(self);
        });
    });
};

//restores to what is currently stored on the database
LocalResource.prototype.restore = function(data) {
  var self = this;
  if (data) {
    self._data = new Resource(data);
  }
  return this
    ._broker
    ._db
    .get(["resources", this._broker.id, this._broker.id, this.id])
    .then(function(resourceData) {
      self._data = new Resource(resourceData);
      self.setPrivate(true);
      if (self._data.relay) {
        self._relay = self._data.relay;
        // self._broker._localRelays[self._data.relay.key] = self;
      }
      return self;
    });
};

LocalResource.prototype.remove = function() {
  var self = this;
  self
    ._broker
    .removeResource(self);
  self._data = null;
  self.removed = true;

  if (self._synchedData) {
    return self.update();
  }
  //if resource has not been stored on server, just return empty object
  return Promise.resolve(self);
};

LocalResource.prototype.value = function(val) {
  var self = this;
  if (val) {
    self._data.value = val;
    return self;
  }
  return self._data.value;
};

/**
 * Set the relay Action. The Action is a string that provides a generic description of how the developer envisions the relay being employed by other applications. Once set, an Action cannot be changed because while the resource being referenced may change, the purpose of the relay does not. While an Action can be any string, some standardization between applications is expected.
 * @param {String} action
 * @returns {LocalResource}
 * @also
 * Get the relay Action.
 * @returns {String}
 */
LocalResource.prototype.action = function(action) {
  var self = this;
  if (action) {
    self._data.action = action;
    return self;
  }
  return self._data.action;
};

LocalResource.prototype.tag = function(tag) {
  var self = this;
  if (tag) {
    if (tag !== self._data.tag) {
      delete self
        ._broker
        ._tags[self._data.tag];
      self._data.tag = tag;
      self
        ._broker
        ._tags[tag] = self;
    }
    return self;
  }
  return self._data.tag;
};

LocalResource.prototype.meta = function(key, val) {
  var self = this;
  if (val && key) {
    self
      ._data
      .meta[key] =  val;
    return self;
  } else if (key) {
    switch (typeof(key)) {
      case "object":
        Object.assign(self._data.meta, key);
        return self;
      case "string":
        return self
          ._data
          .meta[key];
    }

  }
  return self._data.meta;

};

LocalResource.prototype.set = function(args) {
  // this._data.putArgument(key, val);
  var self = this;
  if (!args || typeof(args) !== "object") {
    throw new Error("resource set failed: invalid input");
  }
  if (args.meta) {
    self.meta(args.meta);
  }
  if (args.value) {
    self.value(args.value);
  }
  if (args.tag) {
    self.tag(args.tag);
  }
  if (args.action) {
    self.action(args.action);
  }

  return this;
};

LocalResource.prototype.get = function(key) {
  if (!this._data) {
    return null;
  }
  if (key) {
    return this
      ._data
      .meta[key];
  }
  return this._data.meta;
};

LocalResource.prototype.setArgs = function(args) {
  return this.meta(args);
};

LocalResource.prototype.clear = function(keys) {
  return Resource.removeMeta(this._data, keys);
};

LocalResource.prototype.hasRelayed = function() {
  return true;
};

LocalResource.prototype.launch = function(args) {
  var self = this;
  return self
    ._broker
    .launch(self, args);
};

LocalResource.prototype.allow = function(rules) {
  this._allow = rules;
  return this;
};

LocalResource.prototype.setPrivate = function(state) {
  var self = this;
  if (state) {
    self._allow = null;
  } else {
    self._allow = self._broker.PUBLIC;
  }
  return self;
};

//TODO: move elsewhere
//({function, functionParams})
//enforced during update()
LocalResource.prototype.callback = function(callback, params) {
  var self = this;
  params = params || {};
  this._callback = {
    params: params,
    callback: callback
  };
  this._data.action = "send";
  return this;
};

LocalResource.prototype.paths = function() {
  var self = this;
  return self
    ._broker
    .paths(self.brl);
};

LocalResource.prototype.call = function(key, args) {
  if (key in this._callbacks) {
    return Promise.resolve(this._callbacks[key](args));
  } else { //TODO: HACK!!!!!! this amounts to broadcasting to all other local instances through the server. yuck
    return this
      ._broker
      ._call(this._data.parent, this._data.id, key, args);
  }
  return Promise.reject();
};
