const util = require("util");
const EventEmitter = require("events").EventEmitter;

var BrokerDB = (module.exports = function(firebase) {
  this.firebase = firebase;

  this.instances = {};
});

util.inherits(BrokerDB, EventEmitter);


//placeholder replaced by firebase db with the server timestamp
//if new version of firebase changes this placeholder, this value will need to be changed
BrokerDB.ServerValue ={TIMESTAMP: { ".sv": "timestamp" }};

BrokerDB.prototype.resetBrokerGraph = function(template, callback) {
  var promises = [
    this.remove("accounts"),
    this.remove("resources"),
    this.remove("connections"),
    this.remove("pendingConnections")
  ];

  return Promise.all(promises);
};

var parsePath = (BrokerDB.parsePath = function(path) {
  if (!path) {
    throw new Error("invalid path");
  }
  if (typeof path === "string") {
    return path;
  }
  if (Array.isArray(path) && path.length > 0) {
    var result = path[0];
    for (var i = 1; i < path.length; i++) {
      if (!path[i] || typeof path[i] !== "string") {
        throw new Error("invalid path at element " + i + ": " + typeof path[i]);
      }
      result += "/" + path[i];
    }
    return result;
  }

  //Failed to parse path
});

BrokerDB.prototype.set = function(path, data) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }

  var refPath = parsePath(path);
  //check if data is serializable
  if(typeof data === "object" && data.toJson){
    data = data.toJson();
  }
  return this.firebase.ref(refPath).set(data);
};

BrokerDB.prototype.remove = function(path) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  return this.firebase.ref(refPath).remove();
};

BrokerDB.prototype.transaction = function(path, update) {
  var self = this;

  var refPath = parsePath(path);
  return this.firebase.ref(refPath).transaction(update);
};

var UpdateBuilder = function(db) {
  this._db = db;
  this._updateData = {};
};

UpdateBuilder.prototype.add = function(path, data) {
  var self = this;
  var parsedPath = BrokerDB.parsePath(path);
  if (!parsedPath) {
    throw new Error("BrokerDB UpdateBuilder - illegal path:", path);
  }
  self._updateData[parsedPath] = data;
  return self;
};

UpdateBuilder.prototype.update = function() {
  var self = this;
  return self._db.update(self._updateData);
};

BrokerDB.prototype.UpdateBuilder = function() {
  var self = this;
  return new UpdateBuilder(self);
};

BrokerDB.prototype.update = function(data) {
  if (this.firebase) {
    if (!data) {
      return Promise.reject("Illegal update argument");
    }

    return this.firebase.ref().update(data);
  }
  return Promise.reject("Firebase instance not initialized");
};

BrokerDB.prototype.get = function(path, classConstructor) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  var snapshotPromise = this.firebase.ref(refPath).once("value");
  return snapshotPromise.then(function(snapshot) {
    if (classConstructor) {
      //
      return new classConstructor(snapshot.val());
    }
    return snapshot.val();
  });
};

//note the on[Event] functions return a different callback then what is passed to them as an argument.
//This means that off will not work on callbacks used as arguments, only the return value.
//This is a tradeoff of returning snapshot.val() and not snapshot.
BrokerDB.prototype.off = function(path, callback) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  return this.firebase.ref(refPath).off(callback);
};

BrokerDB.prototype.onValue = function(path, callback, cancel) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  return this.firebase.ref(refPath).on(
    "value",
    function(snapshot) {
      callback(snapshot.val());
    },
    cancel
  );
};

BrokerDB.prototype.onChildAdded = function(path, callback, cancel) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  return this.firebase.ref(refPath).on(
    "child_added",
    function(snapshot) {
      callback(snapshot.val());
    },
    cancel
  );
};

BrokerDB.prototype.onChildChanged = function(path, callback, cancel) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  return this.firebase.ref(refPath).on(
    "child_changed",
    function(snapshot) {
      callback(snapshot.val());
    },
    cancel
  );
};

BrokerDB.prototype.onChildRemoved = function(path, callback, cancel) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  return this.firebase.ref(refPath).on(
    "child_removed",
    function(snapshot) {
      callback(snapshot.val());
    },
    cancel
  );
};

//convenience class that sends all child events to the same callback listener
//callback(update_type, [value])
BrokerDB.prototype.onChildUpdated = function(path, callback, cancel) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  this.firebase.ref(refPath).on(
    "child_added",
    function(snapshot) {
      callback("added", snapshot.val());
    },
    cancel
  );
  this.firebase.ref(refPath).on(
    "child_changed",
    function(snapshot) {
      callback("changed", snapshot.val());
    },
    cancel
  );
  this.firebase.ref(refPath).on(
    "child_removed",
    function(snapshot) {
      callback("removed", snapshot.val());
    },
    cancel
  );
  return callback;
};

//convenience class for removing child events
BrokerDB.prototype.offChildUpdated = function(path, callback) {
  if (!this.firebase) {
    return Promise.reject("Firebase instance not initialized");
  }
  var refPath = parsePath(path);
  this.firebase.ref(refPath).off("child_added", callback);
  this.firebase.ref(refPath).off("child_changed", callback);
  this.firebase.ref(refPath).off("child_removed", callback);
  return callback;
};

BrokerDB.prototype.addInstance = function(accountId, instanceId) {
  if (accountId in this.instances) {
    var accountInstances = this.instances[accountId];
    accountInstances[instanceId] = true;
  } else {
    this.instances[accountId] = {};
    this.instances[accountId][instanceId] = true;
  }
  this.emit("instanceEvent", {
    accountId: accountId,
    added: instanceId,
    instances: this.instances[accountId]
  });
};

BrokerDB.prototype.removeInstance = function(accountId, instanceId) {
  if (accountId in this.instances) {
    var accountInstances = this.instances[accountId];
    if (instanceId in accountInstances) {
      delete accountInstances[instanceId];
      this.emit("instanceEvent", {
        accountId: accountId,
        removed: instanceId,
        instances: this.instances[accountId]
      });
    }
  }
};

BrokerDB.prototype.applyOps = function(ops, target) {
  var operationPromises = [];
  target = target ? target : this.firebase.ref();

  for (var i = 0; i < ops.length; i--) {
    var op = ops[i];
    var p = op.p.join("/");
    if (op.od) {
      operationPromises.push(target.ref(p).remove());
    } else if (op.oi) {
      operationPromises.push(target.ref(p).set(op.oi));
    }
  }
  return Promise.all(operationPromises);
};

var arraysEqual = function(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length != b.length) return false;

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

