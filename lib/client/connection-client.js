const RemoteResource = require('./remote-resource');
const Resource = require('../structures/resource');
const Connection = require('../structures/connection');
const PendingConnection = require('../structures/pending-connection');

const util = require('util');
const EventEmitter = require('events').EventEmitter;


/**
 * Object describing a connection to another Broker.
 * @class
 * @memberof client
 * @param {Broker} broker - Parent Broker instance. 
 * @param {String} target - ID of target broker.
 * @param {*} args 
 */
var ConnectionClient = module.exports = function(broker, target, args) {
  var self = this;

  self._broker = broker;
  self.id = target;

  self._data = null;
  self.resources = {};
  self.tags = {};

  self.ready = new Promise(function(resolve, reject) {
    if (self._ready) {
      resolve(self);
      return;
    }
    self._onReady = resolve;
  });
}

util.inherits(ConnectionClient, EventEmitter);

ConnectionClient.connect = ConnectionClient.harmonize = function(broker, props) {
  switch (props.type) {
    case PendingConnection.TYPE_DIRECT:
      var target = props.target;
      if (!target || target.match("[\.\[\#\\]]")) {
        return {
          status: "rejected",
          e: new Error("Illegal target value (contains .[#\\): " + target)
        };
      }

      var connectionClient = new ConnectionClient(broker, target, props);
      broker.connections[target] = connectionClient;
      return broker
        ._send('harmonize', props)
        .then(function(e) {
          if (e) { //failed to harmonize
            connectionClient._remove();
            return {status: "rejected", e: e};
          }
          return connectionClient
            .ready
            .then(function(connection) {
              return {status: "resolved", v: connection};
            });
        });

      break;
    case PendingConnection.TYPE_KEY:
      var key = props.key;
      if (!key || key.match("[\.\[\#\\]]")) {
        return {
          status: "rejected",
          e: new Error("Illegal key value (contains .[#\\): " + key)
        };
      }
      return broker
        ._send('harmonize', props)
        .then(function(e) {
          if (e) { //failed to harmonize
            return {status: "rejected", e: e};
          }
          return ConnectionClient
            .fromKey(broker, key)
            .then(function(connection) {
              return {status: "resolved", v: connection};
            });
        });
      break;
  }

};

ConnectionClient.fromKey = function(broker, key) {
  //TODO: handle multiple callback instead of overwriting
  return new Promise(function(resolve, reject) {
    broker._pendingConnectionCallbacks[key] = function(connection) {
      return resolve(connection);
    }
  });
};

ConnectionClient.init = function(broker, data, args) {
  var target = data.id;
  var connectionClient = new ConnectionClient(broker, target, args);
  broker.connections[target] = connectionClient;
  connectionClient._update(data);
  return connectionClient;
};

ConnectionClient.prototype.hasInfo = function() {
  if (this.resources[Connection.INFO_ID]) {
    return true;
  }
  return false;
}

ConnectionClient.prototype.info = function(key) {
  var self = this;
  var infoResource = this.resources[Connection.INFO_ID];
  if (infoResource) {
    if (key) {
      if (key === "id") {
        return this.id;
      }
      return infoResource
        ._resource
        .arguments[key];
    }
    return Object.assign({
      value: this.id
    }, infoResource._resource.arguments);
  }
  return key
    ? null
    : {
      value: this.id
    };
}

ConnectionClient.prototype.query = function(query) {
  query = query || {};
  query = Object.assign(query, {source: this.id});

  return this
    ._broker
    .query(query);
}

ConnectionClient.prototype.remove = function() {
  return this.deharmonize();
};

ConnectionClient.prototype.disconnect = ConnectionClient.prototype.deharmonize = function() {
  return this
    ._broker
    ._send('deharmonize', {target: this.id});
};

ConnectionClient.prototype._update = function(data) {
  var self = this;
  if (self._data) {
    self._data = new Connection(data);
    self.emit("changed", self);
    self
      ._broker
      .emit("connection_changed", self);
    self
      ._broker
      .emit("connection_updated", {
        type: "changed",
        "value": self
      });
  } else { //first sync
    self._data = new Connection(data);
    self
      ._broker
      ._db
      .onChildUpdated([
        "accounts", self.id, "resources"
      ], onResourceUpdated.bind(self));

    self._ready = true;
    self._onReady(self);
    self.emit("changed", self);
    self
      ._broker
      .emit("connection_added", self);
    self
      ._broker
      .emit("connection_updated", {
        type: "added",
        "value": self
      });
  }
};

ConnectionClient.prototype._remove = function() {
  var self = this;
  delete self
    ._broker
    .connections[self.id];

  for (var pid in self.resources) {
    self
      ._broker
      .emit("resource_updated", {
        type: "removed",
        value: self.resources[pid]
      });
  }
  self
    ._broker
    ._db
    .offChildUpdated([
      "accounts", self.id, "resources"
    ], onResourceUpdated.bind(self));
  self.emit("removed", self);
  self
    ._broker
    .emit("connection_removed", self);
  self
    ._broker
    .emit("connection_updated", {
      type: "removed",
      "value": self
    });
}

ConnectionClient.prototype.onResourceAdded = function(resource) {
  var self = this;
  if (resource.relay && (resource.relay.parent === self._broker.id || (resource.relay.paths && (self._broker.id in resource.relay.paths)))) { //ignore relayed resources
    return;
  }
  var remoteResource = self.resources[resource.id] = new RemoteResource(self._broker, resource);

  if (!(remoteResource.application in self._broker.applications)) {
    self
      ._broker
      .include(remoteResource.application);
  }

  //TODO:hack
  if (remoteResource._data.arguments.application && !(remoteResource._data.arguments.application in self._broker.applications)) { //ignore relayed resources
    self
      ._broker
      .include(remoteResource._data.arguments.application);

  }

  self.emit("resource_added", remoteResource);
}

ConnectionClient.prototype.onResourceChanged = function(resource) {
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
}

ConnectionClient.prototype.onResourceRemoved = function(resource) {
  var self = this;
  if (resource.relay && (resource.relay.parent === self._broker.id || (resource.relay.paths && (self._broker.id in resource.relay.paths)))) { //ignore relayed resources
    return;
  }
  var remoteResource = self.resources[resource.id];
  if (remoteResource) {
    remoteResource._remove();
    delete this.resources[resource.id];

    self.emit("resource_removed", remoteResource);
  }
}

var onResourceUpdated = function(eventType, data) {
  var self = this;
  switch (eventType) {
    case "added":
      self
        ._broker
        .include(data.brl)
        .then(function(res) {
          var tag = res._data.tag;
          if (tag) {
            self.tags[tag] = res;
          }
        });
      break;
    case "changed":
      break;
    case "removed":
      break;
  }
}

var onError = function(e) {
  console.log(e);
}
