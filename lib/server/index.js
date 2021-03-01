const Firebase = require("firebase-admin");

const ClientConnection = require("./client-connection");
const BrokerConnection = require("./broker-connection");

const BrokerDB = require("..//database/broker-db");
const Account = require("../structures/account");
const Application = require("../structures/application");
const Resource = require("../structures/resource");
const Connection = require("../structures/connection");
const PendingConnection = require("../structures/pending-connection");

const Path = require("path");
const URL = require("url");
const UriTemplate = require("uri-template");

var isCreated = false;

var BrokerServer = (module.exports = function(io, expressApp, config) {
  var self = this;

  if (!io) {
    throw new Error("invalid socket argument");
  }

  if (!config) {
    throw new Error("config argument not provided");
  }

  if (!config.host) {
    throw new Error("invalid host argument");
  }

  self.io = io;
  self.expressApp = expressApp;
  self.host = config.host;

  if (!config.firebaseConfig) {
    throw new Error("invalid firebase configuration");
  }

  self.firebaseConfig = config.firebaseConfig;

  self.applications = {};
  self.instances = {};
  self.connections = {}; //connections and instances will eventually be 1:1
  self.instanceConnectionsMap = {};
  self.pendingConnections = {};

  var credential = {
    credential: Firebase.credential.cert(config.firebaseAdminKey)
  };
  self.firebase = Firebase.initializeApp(
    Object.assign(credential, self.firebaseConfig)
  );
  self.db = new BrokerDB(Firebase.database());

  self.ready = self.db
    .resetBrokerGraph()
    .then(self.registerApplications(config.applications))
    //initialize socket event listeners
    .then(function() {
      self.io.on(
        "connection",
        function(socket) {
          var sConnection = new ClientConnection(socket, self.db);
          sConnection.on("register", onRegister.bind(self));
          sConnection.on("disconnect", onLeave.bind(self));
          sConnection.on("leave", onLeave.bind(self));
          sConnection.on("close", onLeave.bind(self));
          sConnection.on("harmonize", onHarmonize.bind(self));
          sConnection.on("deharmonize", onDeharmonize.bind(self));
          sConnection.on("call", onCall.bind(self));
          sConnection.on("login", onLogin.bind(self));
          sConnection.on("message", onMessage.bind(self));
          self.addConnection(sConnection);
          socket.emit("registrationParams", { firebase: self.firebaseConfig });
        }.bind(self)
      );
    })
    .then(function() {
      if (self.expressApp) {
        self.expressApp.get("/brl/*", self.handleGetRequest.bind(self));
      }
      if (config.applications) {
        return self.registerApplications(config.applications);
      }
      return Promise.resolve();
    })
    .catch(function(e) {
      console.error("Initialization Error", e);
    });
});

BrokerServer.prototype.ServerValue = Firebase.database.ServerValue;

BrokerServer.prototype.addConnection = function(sConnection) {
  if (!(sConnection.id in this.connections)) {
    this.connections[sConnection.id] = sConnection;
  }
};

//add object of applications {appId: data,...}
BrokerServer.prototype.registerApplications = function(applications) {
  var self = this;
  if (!applications) {
    //nothing to register
    return Promise.resolve();
  }

  var operations = [];
  Object.keys(applications).forEach(function(appId) {
    var data = applications[appId];
    operations.push(self.registerApplication(data));
  });

  return Promise.all(operations);
};

//register application, create resources, add resource ids to application entry
BrokerServer.prototype.registerApplication = function(data) {
  var self = this;
  //TODO: real validity check
  if (!data || !data.id) {
    return Promise.reject("invalid application params");
  }

  var app = new Application({
    id: data.id,
    brl: self.host + "/brl/applications/" + data.id,
    meta: data.meta
  });
  self.applications[data.id] = app;

  return self.db
    .set(["applications", app.id], app)
    .then(function() {
      var resourceOperations = [];
      Object.keys(data.resources).forEach(function(tag) {
        var resourceData = data.resources[tag];
        resourceData.application = app.id;
        resourceData.static = true;
        resourceOperations.push(self.updateResource(resourceData));
      });
      return Promise.all(resourceOperations);
    })
    .then(function(results) {
      results.forEach(function(resource) {
        app.resources[resource.tag] = {
          id: resource.id
        };
      });
      return self.db.set(["applications", app.id, "resources"], app.resources);
    });
};

BrokerServer.prototype.updateResource = function(data) {
  var self = this;

  var resource = new Resource(data);
  if (!resource.brl) {
    resource.brl =
      self.host + "/brl/resources/" + data.application + "/" + resource.id;
  }

  if (!(resource.application in self.applications)) {
    return Promise.reject("parent application not registered");
  }

  return self.db
    .set(["resources", resource.application, resource.id], resource)
    .then(function(e) {
      if (e) {
        return Promise.reject(e);
      }
      return resource;
    });
};

//TODO: temporary synchronized broker technique
var onLogin = function(args, connection, ack) {
  if (!args || !args.uid) {
    return;
  }
  var uid = args.uid;
  Firebase.auth()
    .createCustomToken(uid)
    .then(function(customToken) {
      ack(customToken);
    })
    .catch(function(error) {
      console.log("Error creating custom token:", error);
    });
};

//TODO: check valid (e.g. package name match)
var onRegister = function(args, connection, ack) {
  var self = this;
  var operations = [];
  if ("application" in args) {
    operations.push(self.registerApplication(args.application));
  }
  if ("applications" in args) {
    //batch
    var applications = args.applications;
    if (Array.isArray(applications)) {
      applications.forEach(function(app) {
        operations.push(self.registerApplication(app));
      });
    }
  }

  if ("account" in args) {
    var registerAccountOp;

    var account = self.instances[args.account.id];
    if (account) {
      var connectionOptions = (account.clients[connection.client.id] = {
        id: connection.client.id
      });
      connection.account = account;
      registerAccountOp = self.db.set(
        ["accounts", account.id, "clients", connection.client.id],
        connectionOptions
      );

      operations.push(registerAccountOp);
    } else {
      account = connection.account = new Account(args.account);
      account.clients[connection.client.id] = {
        id: connection.client.id
      };
      //get application and apply meta data
      registerAccountOp = self.db
        .get(["applications", account.application])
        .then(function(appData) {
          if (!appData) {
            return Promise.reject("application not registered");
          }
          if (appData.meta) {
            account.meta = Object.assign(appData.meta, account.meta);
          }
          return account;
        })
        .then(function(result) {
          return self.db.set(["accounts", account.id], account);
        })
        .then(function() {
          // console.log("setting instance", account.id);
          self.instances[account.id] = account;
        });
      operations.push(registerAccountOp);
    }

    var connections = self.instanceConnectionsMap[account.id];
    if (!connections) {
      connections = self.instanceConnectionsMap[account.id] = new Set();
    }
    connections.add(connection.client.id);
  }

  Promise.all(operations)
    .then(function() {
      ack(account);
    })
    .catch(function(e) {
      console.error("Registration error: ", e.message);
      ack(e);
    });
};

var onInfoListener = function(accountId) {
  var self = this;
  return function(value) {
    self.info[accountId] = value;
  };
};

var onLeave = function(args, connection) {
  var self = this;

  console.log("-- " + connection.client.id + " left --");
  //clear all records of connection and account

  delete self.connections[connection.client.id];
  if (connection.account) {
    delete self.instances[connection.account.id];
    var connections = self.instanceConnectionsMap[connection.account.id];
    if (connections) {
      connections.delete(connection.client.id);
      if (connections.size === 0) {
        self.db
          .get(["accounts", connection.account.id])
          .then(function(data) {
            var operations = [];

            if (data) {
              var connectionData = data.clients[connection.client.id];
              if (connectionData && connectionData.resources) {
                //TODO: flawed, does not inform other instances managing the same tag
                Object.keys(connectionData.resources).forEach(function(rid) {
                  var resourceRules = connectionData.resources[rid];
                  operations.push(
                    self.db.remove([
                      "accounts",
                      data.id,
                      "resources",
                      resourceRules.tag
                    ])
                  );
                  operations.push(
                    self.db.remove([
                      "resources",
                      data.application,
                      resourceRules.id
                    ])
                  );
                });
              }
              if (!data.persistent && Object.keys(data.clients).length <= 1) {
                console.log(`removing account ${connection.account.id}`);
                operations.push(
                  self.db.remove(["accounts", connection.account.id])
                );
                operations.push(
                  self.disharmonizeAccount(connection.account.id)
                );
              } else {
                console.log(`removing client ${connection.client.id}`);
                operations.push(
                  self.db.remove([
                    "accounts",
                    connection.account.id,
                    "clients",
                    connection.client.id
                  ])
                );
              }
            }
            return Promise.all(operations);
          })
          .then(function() {
            // Firebase.auth().deleteUser(connection.account.id)
            //     .catch(function(error) {
            //         console.log("Error deleting user:", error);
            //     });
          })
          .catch(function(e) {
            console.log("Disconnect Error", e.message);
          });
      }
    }
  }
};

BrokerServer.prototype.disharmonizeAccount = function(accountId) {
  var self = this;
  self.db
    .get(["connections", accountId])
    .then(function(connections) {
      for (var harmonizedAccountId in connections) {
        self.db.remove(["connections", harmonizedAccountId, accountId]);
      }
    })
    .then(function() {
      self.db.remove(["connections", accountId]);
    });
};

BrokerServer.prototype.getAccount = function(id) {
  if (id in this.instanceConnectionsMap) {
    return this.connections[this.instanceConnectionsMap[id]].account;
  }
  return null;
};

var onHarmonize = function(props, connection, ack) {
  var self = this;
  var createConnectionPromise;

  if (!connection.account) {
    //TODO: handle not registered
    console.log("Connection failed: socket not registered");
    ack("Connection failed: socket not registered");
    return;
  }

  var parentId = connection.account.id;

  var type = props.type;

  switch (type) {
    case PendingConnection.TYPE_KEY:
      var pendingConnection;
      var key = props.key;
      var oneShot = props.oneShot !== undefined ? props.oneShot : true; //onetime use
      if (key) {
        connectionPromise = self.db
          .transaction(["pendingConnections", key], function(val) {
            if (val) {
              pendingConnection = new PendingConnection(val);
              if (props.target) {
                //set target to provided string or use the connection id
                var target =
                  typeof props.target === "string" ? props.target : parentId;
                if (pendingConnection.source) {
                  //source saved, initialize connection
                  createConnectionPromise = BrokerConnection.harmonize(
                    self,
                    target,
                    pendingConnection.source,
                    key
                  );
                  if (oneShot) {
                    return null;
                  }
                  return;
                } else {
                  //no source, set target
                  pendingConnection.target = target;
                  return pendingConnection;
                }
              } else {
                //source (provided or associated with client)
                var source = props.source || parentId;
                //if target set, create connection
                if (pendingConnection.target) {
                  createConnectionPromise = BrokerConnection.harmonize(
                    self,
                    source,
                    pendingConnection.target,
                    key
                  );
                  if (oneShot) {
                    return null;
                  }
                  return;
                  //no target, set source
                } else {
                  pendingConnection.source = source;
                  return pendingConnection;
                }
              }
            } else {
              //pending connection does not exist at key, create
              pendingConnection = new PendingConnection({
                timestamp: BrokerDB.ServerValue.TIMESTAMP
              });
              //set either source or target
              if (props.target) {
                pendingConnection.target =
                  typeof props.target === "string" ? props.target : parentId;
              } else {
                pendingConnection.source = props.source || parentId;
              }
              return pendingConnection;
            }
          })
          .then(function() {});
      } else {
        //no key provided
      }
      break;
    case PendingConnection.TYPE_DIRECT:
    default:
      var targetId = props.target;
      createConnectionPromise = BrokerConnection.harmonize(
        self,
        parentId,
        targetId,
        props.arguments
      );
  }

  //inform client
  if (createConnectionPromise) {
    createConnectionPromise
      .then(function(connection) {
        self.connections[connection.id] = connection;
        return connection.ready;
      })
      .then(() => {
        if (ack) {
          ack();
        }
      })
      .catch(function(e) {
        if (e && e.message) {
          console.log("failed to connect: ", e.message);
        }
        if (ack) {
          ack(e);
        }
      });
  } else {
    ack();
  }
};

//TODO: validate props
var onDeharmonize = function(args, connection, ack) {
  var self = this;
  if (!connection.account) {
    //TODO: handle not registered
    return;
  }
  var parent = connection.account.id;
  var target = args.target;

  var connection = self.connections[Connection.generateKey(parent, target)];
  if (connection) {
    connection
      .remove()
      .then(function() {
        if (ack) {
          ack();
        }
      })
      .catch(function(e) {
        onError(e);
        if (ack) {
          ack(e);
        }
      });
  } else {
    ack("Connection doesn't exist");
  }
};

var onCall = function(args, connection, response) {
  var self = this;
  var targetConnection, source;
  //TODO: (demo hack) check valid / catch
  // console.log("calling " + args.key + " on target " + args.iid);
  if (
    args.iid in self.instanceConnectionsMap &&
    self.connections[connection.id].account
  ) {
    source = self.connections[connection.id].account.id;
    args.src = source;
    //TODO check permissions
    self.instanceConnectionsMap[args.iid].forEach(function(targetConnection) {
      self.connections[targetConnection].socket.emit("call", args, response);
    });
  }
};

var onMessage = function(args, connection, response) {
  var self = this;
  if (!args || typeof args !== "object") {
    console.log("invalid message", args);
    return;
  }

  var source =
    self.connections[connection.client.id] &&
    self.connections[connection.client.id].account &&
    self.connections[connection.client.id].account.id;

  if (source in self.instanceConnectionsMap) {
    args.source = connection.client.id;
    self.instanceConnectionsMap[source].forEach(function(targetConnectionId) {
      if (targetConnectionId !== connection.client.id) {
        var targetConnection = self.connections[targetConnectionId];
        if (targetConnection) {
          console.log("sending to ", targetConnectionId);
          targetConnection.socket.send(args, response);
        } else {
          //TODO: send failed to send message
        }
      }
    });
  }
};

var handleInstanceEvent = function(args) {
  var self = this;
  if (!args || !args.toneId || !args.instances) {
    console.log("illegal instance args");
    return;
  }
  if (args.added && args.added in self.connections) {
    var addedInstance = self.connections[args.added];
    if (addedInstance.connectionType === "android") {
      self.addToRoom(addedInstance, args.toneId);
    } else {
      addedInstance.socket.join(args.toneId);
    }
    //join chord channels of active chords
    //No broadcast
    if (args.toneId in self.db.chordPairs) {
      var chordTones = self.db.chordPairs[args.toneId];
      for (var tId in chordTones) {
        var chordId = chordTones[args.toneId];
        self.addToRoom(addedInstance, chordId);
      }
    }
  } else if (args.removed && args.removed in self.connections) {
    //TODO
  }
  //broadcast to instances of tone
  self.broadcast("instanceEvent", args, args.toneId);
};

var handleChordUpdated = function(args) {
  var self = this;
  if (!args || !args.chord || typeof args.chord.notes !== "object") {
    console.log("illegal chord");
    return;
  }
  var chord = args.chord;

  if (chord.target && chord.target in self.db.instances) {
    var instances = self.db.instances[toneId];
    for (var instanceId in instances) {
      if (instanceId in self.connections) {
        var instance = self.connections[instanceId];
        self.addToRoom(instance, chord.id);
      }
    }
  }
};

BrokerServer.prototype.addToRoom = function(sConnection, room) {
  if (sConnection.connectionType === "android") {
    if (!(room in this.pendingConnections)) {
      this.pendingConnections[room] = {};
    }
    this.pendingConnections[room][sConnection.socket.id] =
      sConnection.androidSocketInterface.clientSocket;
  } else {
    sConnection.socket.join(room);
  }
};

BrokerServer.prototype.broadcast = function(event, data, target, response) {
  var self = this;
  if (target) {
    if (typeof target === "string") {
      //single room
      //broadcast to default socket io clients
      self.io.to(target).emit(event, data, response);
      //broadcast to clients partially hosted on the server(android)
      if (target in self.pendingConnections) {
        var members = self.pendingConnections[target];
        for (var mId in members) {
          members[mId].emit(event, data, response);
        }
      }
    }
  } else {
    self.io.emit(event, data, response);
  }
};

BrokerServer.prototype.get = function(path) {
  var self = this;
  if (!path) {
    return Promise.reject();
  }
  return self.db.get(path).then(function(resource) {
    return resource;
  });
};

BrokerServer.prototype.handleGetRequest = function (req, res) {
  var self = this;
  var resourcePath = req.params[0];

  //TODO: set timeout/ check database
  return self
    .get(resourcePath)
    .then(function (resource) {
      if (!resource) {
        res.send("Resource doesn't exist");
        return;
      }
      var query = req.query || null;
      if (resource.action === "send") {
        if (resource.meta.callback) {
          var connection =
            self.connections[resource.meta.callback.connection];
          if (connection) {
            console.log(
              "sending to callback",
              connection.id,
              query,
              resource.meta.callback
            );
            connection.socket
              .emit("call", {
                application: resource.application,
                id: resource.id,
                arguments: query
              })
              .catch(function (e) {
                console.log("failed to send to callback", e);
              });
            console.log("error", __dirname);

            var filePath = Path.resolve(__dirname, "result_dialog.html");
            console.log("sending", filePath);
            res.sendFile(filePath);
            return;
          }
        } else if (resource.meta.template) {
          var parsedTemplate = UriTemplate.parse(resource.meta.template);
          var redirectUrl = parsedTemplate.expand(params);
          if (redirectUrl) {
            res.status(301).redirect(redirectUrl);
            return;
          }
        }
        res.send("Invalid resource!");
        return;
      }
      if (resource.value) {
        var redirectUrl = resource.value;
        var queryString = null; //url.parse(query).query;
        if (queryString) {
          redirectUrl += queryString;
        }

        res.status(301).redirect(redirectUrl);
        return;
      }
      res.send("Invalid resource!");
    })
    .catch(function (e) {
      res.send(e);
    });
}