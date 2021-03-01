const RemoteResource = require('./remote-resource');
const Resource = require('../structures/resource');
const Connection = require('../structures/connection');
const Application = require('../structures/application');
const StaticResource = require('./static-resource');

const util = require('util');
const EventEmitter = require('events').EventEmitter;

var ApplicationClient = module.exports = function(broker, id, options) {
  var self = this;

  self._broker = broker;
  self.id = id;
  self._data = {};

  self.connections = {};
  self.resources = {};
  self._resourcesById = {};

  self.ready = new Promise(function(resolve, reject) {
    if (self._ready) {
      resolve(self);
      return;
    }
    self._onReady = resolve;
  });

  self.onConnectionUpdated = self
    .onConnectionUpdated
    .bind(self);
}

util.inherits(ApplicationClient, EventEmitter);

ApplicationClient.init = function(broker, id, options) {
  var self = this;

  if (id in broker.applications) {
    console.warn("application already included");
    return broker.applications[id]; //already included
  }
  var app = new ApplicationClient(broker, id, options);
  broker
    ._db
    .get(["applications", id])
    .then(function(value) {
      if (value) {
        app._update(value);
      } else {
        console.warn("invalid application id", id);
      }
    });
  broker.applications[id] = app;
  return app;
};

ApplicationClient.prototype.info = ApplicationClient.prototype.get = function(key) {
  if (key) {
    return this
      ._data
      .arguments[key];
  }
  return this._data.arguments;
};

ApplicationClient.prototype.query = function(query) {
  query = query || {};
  query = Object.assign({}, query, {
    $or: [
      {
        application: this.id
      }, {
        $and: [
          {
            relay: {
              $exist: true
            }
          }, {
            "relay.application": this.id
          }
        ]
      }
    ]
  });
  return this
    ._broker
    .query(query, {includeDefaultResources: true});
}

ApplicationClient.prototype.remove = function() {
  return this._remove();
};

ApplicationClient.prototype._update = function(data) {
  var self = this;

  if (self._ready) {
    //overwriting
    self._data = new Application(data);
  } else { //first sync
    self._data = new Application(data);
    // self._broker.on("connection_updated", self.onConnectionUpdated.bind(self));
    self._ready = true;
    self._onReady(self);
  }
  for (var tag in self._data.resources) {
    var resData = self
      ._data
      .resources[tag];
    StaticResource
      .init(self._broker, {
        application: self.id,
        id: resData.id
      })
      .then(function(res) {
        if (res) {
          self.resources[tag] = res;
          self._resourcesById[res.id] = res;
        }
      });
  }
  self.emit("changed", self);
  self
    ._broker
    .emit("application_changed", self);
  self
    ._broker
    .emit("application_updated", {
      type: "changed",
      "value": self
    });
};

ApplicationClient.prototype._remove = function() {
  var self = this;
  delete self
    ._broker
    .applications[self.id];

  self.emit("removed", self);
  self
    ._broker
    .emit("application_removed", self);
  self
    ._broker
    .emit("application_updated", {
      type: "removed",
      "value": self
    });
}

ApplicationClient.prototype.addConnection = function(connection) {
  var self = this;
  if (connection.id in self.connections) {
    return;
  }
  self.connections[connection.id] = connection;
  connection.on("changed", self.onConnectionUpdated);
}

ApplicationClient.prototype.onConnectionUpdated = function(type, broker) {
  switch (type) {
    case "added":
      break;
    case "removed":

      break;
    default:

  }
}
ApplicationClient.prototype.onBrokerAdded = function(broker) {
  var self = this;
  if (resource.relay && (resource.relay.parent === self._broker.id || (resource.relay.paths && (self._broker.id in resource.relay.paths)))) { //ignore relayed resources
    return;
  }
  var remoteResource = self.resources[resource.id] = new RemoteResource(self._broker, resource);
  self.emit("connection_added", remoteResource);
  self
    ._broker
    .emit("connection_added", remoteResource);
  self
    ._broker
    .emit("connection_updated", {
      type: "added",
      "value": remoteResource
    });
}

ApplicationClient.prototype.onBrokerChanged = function(resource) {
  var self = this;
  if (resource.relay && (resource.relay.parent === self._broker.id || (resource.relay.paths && (self._broker.id in resource.relay.paths)))) { //ignore relayed resources
    return;
  }

  var remoteResource = self.resources[resource.id];
  if (!remoteResource) {
    throw new Error("Can't update a resource that hasn't yet been added to the ensemble");
  }
  remoteResource._update(resource);
  self.emit("resource_changed", remoteResource);
  self
    ._broker
    .emit("resource_changed", remoteResource);
  self
    ._broker
    .emit("resource_updated", {
      type: "changed",
      "value": remoteResource
    });
}

ApplicationClient.prototype.onBrokerRemoved = function(resource) {
  var self = this;
  if (resource.relay && (resource.relay.parent === self._broker.id || (resource.relay.paths && (self._broker.id in resource.relay.paths)))) { //ignore relayed resources
    return;
  }
  var remoteResource = self.resources[resource.id];
  if (remoteResource) {
    remoteResource._remove();
    delete this.resources[resource.id];

    self.emit("resource_removed", remoteResource);
    self
      ._broker
      .emit("resource_removed", remoteResource);
    self
      ._broker
      .emit("resource_updated", {
        type: "removed",
        "value": remoteResource
      });
  }
}

var onResourceUpdated = function(eventType, data) {
  var self = this;
  // console.log("resource " + eventType, data);
  var resource = new Resource(data);
  switch (eventType) {
    case "added":
      self.onResourceAdded(resource);
      break;
    case "changed":
      self.onResourceChanged(resource);
      break;
    case "removed":
      self.onResourceRemoved(resource);
      break;
  }
  if (resource.id === Connection.INFO_ID) {

    self
      ._broker
      .emit("connection_updated", {
        type: "changed",
        value: self
      });
  }
}

var onError = function(e) {
  console.log(e);
}
