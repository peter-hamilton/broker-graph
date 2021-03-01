const Connection = require('../structures/connection');

const util = require('util');
const EventEmitter = require('events').EventEmitter;

var BrokerConnection = module.exports = function(broker, sourceId, targetId, parentId, pendingConnectionKey) {
  var self = this;
  self._broker = broker;
  self.db = broker.db;
  this.sourceId = sourceId;
  this.targetId = targetId;
  this.parentId = parentId;
  this.pendingConnectionKey = pendingConnectionKey || null;

  if (sourceId === targetId) {
    throw new Error("can't harmonize with self");
  }

  var parentConnections = self
    ._broker
    .instanceConnectionsMap[sourceId];
  var parentAccount = self
    ._broker
    .instances[sourceId];

  var targetConnections = self
    ._broker
    .instanceConnectionsMap[targetId];
  var targetAccount = self
    ._broker
    .instances[targetId];

  if (!parentConnections || parentConnections.size === 0) {
    throw new Error("parent account doesn't exist");
  }
  if (!targetConnections || targetConnections.size === 0) {
    throw new Error("target account doesn't exist");
  }
  self.id = Connection.generateKey(sourceId, targetId);

  self.parentConnection = new Connection({
    "id": targetId,
    "source": sourceId,
    "target": targetId,
    "parent": parentId,
    "application": targetAccount.application,
    "pendingConnectionKey": this.pendingConnectionKey,
    "timestamp": this._broker.ServerValue.TIMESTAMP
  });

  self.targetConnection = new Connection({
    "id": sourceId,
    "source": targetId,
    "target": sourceId,
    "parent": parentId,
    "application": parentAccount.application,
    "pendingConnectionKey": this.pendingConnectionKey,
    "timestamp": this._broker.ServerValue.TIMESTAMP
  });

  self.ready = Promise
    .all([
      self
        .db
        .set([
          "connections", targetId, sourceId
        ], self.targetConnection),
      self
        .db
        .set([
          "connections", sourceId, targetId
        ], self.parentConnection)
    ])
    .then(function() {});
}

BrokerConnection.harmonize = function(broker, parentId, targetId, pendingConnectionKey) {
  return new Promise(function(resolve, reject) {
    try {
      var sourceId = parentId;
      var connection = new BrokerConnection(broker, sourceId, targetId, parentId, pendingConnectionKey);
      resolve(connection);
    } catch (e) {
      reject(e);
    }
  })
}

BrokerConnection.prototype.remove = function() {
  var self = this;

  return Promise.all([
    self
      .db
      .remove(["connections", self.targetId, self.sourceId]),
    self
      .db
      .remove(["connections", self.sourceId, self.targetId])
  ]);
}

var onError = function(e) {
  console.log(e);
}
