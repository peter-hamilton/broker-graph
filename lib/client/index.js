const io = require("socket.io-client");

const util = require("util");
const URL = require("url");
const uuid = require("uuid/v4");
const Events = require("events");

const Firebase = require("firebase");

const BrokerDB = require("..//database/broker-db");

const Account = require("../structures/account.js");
const Connection = require("../structures/connection");
const PendingConnection = require("../structures/pending-connection");

const RemoteResource = require("./remote-resource");
const LocalResource = require("./local-resource");
const ConnectionClient = require("./connection-client");
const Application = require("./application-client");
const Query = require("./query");
const Mingo = require("mingo");
const UriTemplate = require("uri-template");

//TODO: applicationId as helpers
const Helpers = require("../helpers");


/**
 * @namespace client
 */

/**
* Broker Graph API.
* @class
* @memberof client
* @param {Object} params - Broker client initialization parameters.
* @param {Object} params.firebaseConfig - Firebase configuration.
* @param {String} params.host - URL of Broker Graph server.
* @param {String} params.application - ID of parent application.
* @param {String} [params.instanceId] - ID of Broker Client instance.
* @prop {Promise} ready - Promise that resolves when Broker is initialized.
*/
var Broker = (module.exports = function (params) {
  var self = this;

  //TODO: remove
  self._params = params = params || {};

  if (process.env.BROKER_CONFIG) {
    Object.assign(params, process.env.BROKER_CONFIG);
  }

  if (!params.firebaseConfig) {
    throw new Error("invalid firebase configuration");
  }
  if (!params.host) {
    throw new Error("invalid host");
  }

  if (!params.application) {
    throw new Error("invalid application");
  }

  self.host = params.host;

  self._auth = null;
  self.authReady = new Promise(function(resolve, reject) {
    if (self._auth) {
      resolve(self._auth);
    }
    self._onAuthResolve = resolve;
  });
  self.applications = {};
  self.shared = {};
  self.connections = {};
  self.resources = self._brlMap = {};
  self._values = {};

  self._resourceMap = {};
  self._tags = {};

  self._callbacks = {};
  self._remoteRelays = {};
  self._localRelays = {};

  self._brokerCallbacks = {};
  self._pendingConnectionCallbacks = {};

  self._messages = new Events();
  //overide emit
  self.messages = {
    emit: self.sendMessage.bind(self),
    on: self._messages.on.bind(self._messages),
    once: self._messages.once,
    removeListener: self._messages.removeListener,
    off: self._messages.removeListener
  };

  self._application = params.application;
  self._instanceId = params.instanceId || self._application;
  self.meta = self.info = params.meta || params.info || {};

  self.ready = new Promise(function(resolve, reject) {
    if (self._ready) {
      resolve(self);
    }
    self._onReadyPromiseResolve = resolve;
  });

  self.synced = new Promise(function(resolve, reject) {
    if (self._synced) {
      resolve(self);
    }
    self._onSyncedPromiseResolve = resolve;
  });

  initSocket
    .bind(self)()
    .then(initFirebase.bind(self))
    .then(registerAccount.bind(self))
    .then(restoreResources.bind(self))
    .then(initBrokerListeners.bind(self))
    .then(onReady.bind(self))
    .then(onSynced.bind(self))
    .catch(onError);
});

//broker events:
//connection_added
//connection_changed
//connection_removed
util.inherits(Broker, Events.EventEmitter);

Broker.prototype.Helpers = Helpers;
Broker.prototype.ServerValue = Firebase.database.ServerValue;

Broker.prototype.ID_INFO = Connection.INFO_ID;
Broker.prototype.PUBLIC = "public";

Broker.DEFAULT_CONFIG = process.env.BROKER_CONFIG;
Broker.FirebaseDatabase = BrokerDB;

var initSocket = function() {
  var self = this;
  var host = self.host;
  if (self._params.namespace) {
    var namespace = self._params.namespace;
    if (namespace.charAt(0) !== "/") {
      namespace = `/${namespace}`;
    }
    host = `${host}${namespace}`;
  }
  return new Promise(function(resolve, reject) {
    self._socket = io(host);
    self._socket.on("registrationParams", function(response) {
      if (response) {
        self._firebaseConfig = response.firebase;
        resolve();
      }
    });
    self._socket.on("connect", function() {});
    self._socket.on("connect-error", function(e) {
      console.log("connect-error", e);
      reject(e);
    });
    self._socket.on("reconnect", function() {
      // handleReconnect.bind(self)();
    });
  });
};

var handleReconnect = function() {
  console.warn("Reconnecting");
  var self = this;
  self.ready.then(registerAccount.bind(self)()).then(function() {
    //restore resources
    for (var pid in self.shared) {
      var resource = self.shared[pid];
      resource.update();
    }
  });
};

var handleUserChange = function(user) {
  var self = this;
  registerAccount
    .bind(self)()
    .then(function() {
      //transfer resources / Connections
      for (var pid in self.shared) {
        // var resource = self.shared[pid];
        // resource.update();
      }
    });
};

var initFirebase = function() {
  var self = this;

  //If no instance Id specified use unique socket id
  if (self._params.newInstance) {
    self._instance = self._socket.io.engine.id;
  } else if (self._params.instanceId) {
    self._instance = self._params.instanceId;
  } else {
    self._instance = self._application;
  }

  try {
    self._fb = Firebase.initializeApp(self._firebaseConfig, self._instance);
  } catch (e) {
    for (var i = 0; i < Firebase.apps.length; i++) {
      if (Firebase.apps[i].name === self._instance) {
        self._fb = Firebase.apps[i];
        break;
      }
    }
    if (!self._fb) {
      throw new Error(`couldn't initialize firebase: ${e}`);
    }
  }

  self._db = new BrokerDB(self._fb.database());

  var auth = (self._auth = self._fb.auth());
  self._onAuthResolve(auth);
  auth.onAuthStateChanged(onAuthStateChanged.bind(self));

  return new Promise(function(resolve, reject) {
    if (auth.currentUser) {
      resolve(auth.currentUser);
    } else {
      self._onUserResolve = resolve;
    }
  });
};

//TODO: handle changes
var onAuthStateChanged = function(user) {
  var self = this;
  var result;

  if (user) {
    result = Promise.resolve(user);
  } else if (self._params.instanceId) {
    result = self._send("login", { uid: self._instance }).then(function(token) {
      return self._auth.signInWithCustomToken(token).catch(function(e) {
        console.log("Failed signInWithCustomToken: ", e);
      });
    });
  } else if (!self._params.requireLogin) {
    result = self._auth.signInAnonymously().catch(function(e) {
      console.log("Failed signInAnonymously: ", e);
    });
  }

  if (!result) {
    console.warn("Auth error");
    // return Promise.reject("Auth error");
  } else if (self.isReady()) {
    //new login, transfer old user resources
    result.then(function(newUser) {
      handleUserChange.bind(self)(newUser);
    });
  } else if (self._onUserResolve) {
    self._onUserResolve(result);
  }
};

var registerAccount = function() {
  var self = this;
  self.id = self._fb.auth().currentUser.uid;
  self.brl = `${self.host}/acounts/${self.id}`;

  var args = {};
  args.id = self.id;
  args.requireLogin = self._params.requireLogin || false;
  args.application = self._application;
  args.persistent = self._params.persistent || false;
  if (self.meta) {
    args.meta = self.meta;
  }

  //register with host
  return self._send("register", { account: args });
};

var restoreResources = function() {
  var self = this;
  return self.include(self._application);
};

var initBrokerListeners = function() {
  var self = this;
  //initialize socket listeners
  self._socket.on("call", onCall.bind(self));

  self._socket.on("message", _onMessage.bind(self));

  //initialize database listeners
  self._db.onChildUpdated(
    ["connections", self.id],
    onConnectionUpdated.bind(self),
    onError
  );
  self._db.onValue(["accounts", self.id], onAccountUpdated.bind(self), onError);

  self._db.onChildUpdated(
    ["resources", self.id, self.id],
    function(ev, val) {
      switch (ev) {
        case "added":
        case "changed":
          if (val) {
            if (!(val.id in self.shared)) {
              //created by other instance

              if (val.relay && self._localRelays[val.relay.brl]) {
                return;
              }

              var existing = self.resource(val.action, val.id);
              existing.setPrivate(true);
              existing.restore(val);
              self.emit("resource_restored", existing);
              console.log("restoring");
            }
          }
          break;
        case "removed":
          break;
      }
    },
    onError
  );
};

var onReady = function(response) {
  var self = this;
  console.log("connected as " + self.id);
  self._ready = true;
  if (self._onReadyPromiseResolve) {
    self._onReadyPromiseResolve(self);
  }
};

var onSynced = function(response) {
  var self = this;
  self._synced = true;
  if (self._onSyncedPromiseResolve) {
    self._onSyncedPromiseResolve(self);
  }
};

/**
 * Returns true if synchronized with server.
 * @returns {boolean}
 */
Broker.prototype.isSynced = function() {
  var self = this;
  return self._synced;
};

/**
 * Returns true if initialized and ready for operations.
 * @returns {Promise}
 */
Broker.prototype.isReady = function() {
  var self = this;
  return self._ready;
};

Broker.prototype.sendMessage = function(type, data) {
  var self = this;
  console.log("sending msg type ", type);
  return self._send("message", {
    type: type,
    data: data
  });
};

Broker.prototype._send = function(type, data) {
  var self = this;
  return new Promise(function(resolve, reject) {
    self._socket.emit(type, data, resolve);
  });
};

var onCall = function(data, response) {
  var self = this;
  console.log("call", data);
  if (!data || !data.id || !data.application) {
    console.log("Invalid args");
    return;
  }
  var resource = self.shared[data.id];
  if (!resource || !resource._callback) {
    console.log("Invalid resource in callback request");
    return;
  }
  var result = resource._callback.callback(data.meta);

  if (response) {
    if (result instanceof Promise) {
      result.then(function(promiseResult) {
        response(promiseResult);
      });
    } else {
      response(result);
    }
  }
};

var _onMessage = function(data, response) {
  var self = this;
  self._messages.emit(data.type, data.data);
};

Broker.prototype._call = function(account, resource, key, args) {
  return Promise.reject("call deprecated!!");
  // var self = this;
  // return self._send("call", {
  //   iid: account,
  //   pid: resource,
  //   key: key,
  //   args: args
  // });
};

Broker.prototype.getAuth = function(id) {
  return id in this.connections;
};


/**
 * Returns true if provided ID is connected.
 * @param {String} id - Broker ID 
 * @returns {boolean}
 */
Broker.prototype.isConnected = Broker.prototype.isHarmonized = function(id) {
  return id in this.connections;
};

/**
 * Retrieves broker instance metadata. Used in cases where it is changed by another instance.
 * @returns {Promise}
 */
Broker.prototype.refreshInfo = function() {
  var self = this;
  var metaResource = self.resource("get", Connection.INFO_ID);
  return metaResource.restore().then(function() {
    self.meta = metaResource.get();
    return self.meta;
  });
};

/**
 * Update the metadata of the local Broker client.
 * @param {Object} data - Key-value pairs. Keys are unique strings. Values must be serializable.
 */
Broker.prototype.updateMeta = function(data) {
  var self = this;
  if (!data) {
    return Promise.resolve();
  } else if (typeof data === "object") {
    //TODO: check reserved meta keys
    self.meta = Object.assign(self.meta || {}, data);
    return self._db.set(["accounts", self.id, "meta"], self.meta);
  }
  return Promise.reject();
};

/**
 * Query available relays using a Mongo query.
 * @param {Object} query - Mongo style query.
 * @param {function} rankFunction
 * @returns {Query}
 */
Broker.prototype.query = function(query, rankFunction) {
  return new Query(this, query, rankFunction);
};

/**
 * Query shared resources using a Mongo style query.
 * @param {Object} query - Mongo style query.
 * @param {function} rankFunction
 * @returns {LocalResource[]}
 */
Broker.prototype.queryShared = function(query, rankFunction) {
  var self = this;
  var collection = Object.values(self.shared).map(function(resource) {
    return resource._data;
  });
  var mingoQuery = new Mingo.Query(query);
  var results = mingoQuery.find(collection).all();

  if (rankFunction) {
    results = results
      .map(function(item) {
        return { data: item, score: rankFunction(item) };
      })
      .filter(function(item) {
        return item.score > 0;
      })
      .sort(function(a, b) {
        return b.score - a.score;
      })
      .map(function(item) {
        return self.shared[item.data.id];
      });
  } else {
    results = results.map(function(item) {
      return self.shared[item.id];
    });
  }
  return results;
};

/**
 * Query connected Brokers using a Mongo style query.
 * @param {Object} query - Mongo style query. 
 * @param {function} rankFunction
 * @returns {ConnectionClient[]}
 */
Broker.prototype.queryBrokers = function(query, rankFunction) {
  var self = this;
  var collection = Object.values(self.connections).map(function(connection) {
    return connection.info();
  });
  var mingoQuery = new Mingo.Query(query);
  var results = mingoQuery.find(collection).all();

  if (rankFunction) {
    results = results
      .map(function(item) {
        return { data: item, score: rankFunction(item) };
      })
      .filter(function(item) {
        return item.score > 0;
      })
      .sort(function(a, b) {
        return b.score - a.score;
      })
      .map(function(item) {
        return self.brokers[item.data.id];
      });
  } else {
    results = results.map(function(item) {
      return self.brokers[item.id];
    });
  }
  return results;
};

/**
 * Form a connection with another broker.
 * @param {string|object} target BRL of target broker or props object with 'target' property.
 * @param {Object} props 
 * @returns {ConnectionClient}
 */
Broker.prototype.connect = Broker.prototype.harmonize = function(
  target,
  props
) {
  var self = this;
  if (!target) {
    throw new Error("Illegal connection target value");
  }

  if (typeof target === "object") {
    props = target;
  } else if (typeof target === "string") {
    //TODO: parse brls
    if (target === self.id) {
      throw new Error("Can't connection with self");
    }
    props = props || {};
    props.target = target;
    props.type = PendingConnection.TYPE_DIRECT;
  } else {
    throw new Error("Invalid connection arguments");
  }

  //check if already connected
  if (props.target && self.isConnected(props.target)) {
    return Promise.resolve(self.connections[target]);
  }

  return ConnectionClient.connect(self, props);
};

Broker.prototype.parse = function(brl) {
  var self = this;
  if (!brl || typeof brl !== "string") {
    return null;
  }
  var parsedUrl = URL.parse(brl);
  if (!parsedUrl || !parsedUrl.protocol) {
    //not a url
    return null;
  }
  var result = {
    url: parsedUrl
  };

  if (parsedUrl.host && self.host.endsWith(parsedUrl.host)) {
    //if BRL
    result.host = parsedUrl.host;
    if (parsedUrl.path) {
      //TODO:check valid path
      result.path = parsedUrl.path;
      var pathArray = parsedUrl.path.split("/");
      if (pathArray.length > 3 && pathArray[1] === "brl") {
        switch (pathArray[2]) {
          case "applications":
            result.type = "application";
            result.id = pathArray[3];
            result.application = result.id;
            break;
          case "resources":
            result.type = "resource";
            result.application = pathArray[3];
            result.id = pathArray[4];
            break;
        }
      }
    }
  } else {
    result.type = "url";
  }
  return result;
};

/**
 * Include
 * @param {String|String[]} ids - BRLs of relays to include.
 * @returns {Promise} - Promise that resolves when all relays are included.
 */
Broker.prototype.include = function(ids, options) {
  var self = this;

  if (typeof ids === "string") {
    return self._includeBRL(ids);
  } else if (Array.isArray(ids)) {
    var includePromises = [];
    ids.forEach(function(brl) {
      includePromises.push(self._includeBRL(brl));
    });
    return Promise.all(includePromises);
  }
  return Promise.reject("invalid resource identifier:" + brl);
};

Broker.prototype._includeBRL = function(brl) {
  var self = this;
  if (typeof brl === "string") {
    var parsedBRL = self.parse(brl);
    if (parsedBRL) {
      switch (parsedBRL.type) {
        case "application":
          return self._includeApp(parsedBRL.id);
          break;
        case "resource":
          return self._includeRes(parsedBRL.application, parsedBRL.id);
          break;
      }
    } else {
      //check if application
      return self._includeApp(brl);
    }
  }
  return Promise.reject("invalid resource identifier:" + brl);
};

Broker.prototype._includeApp = function(id) {
  var self = this;
  if (/[./:]/.test(id)) {
    return Promise.reject("illegal characters");
  }
  var application = self.applications[id];
  if (!application) {
    //not already included
    application = Application.init(self, id);
  }
  return application.ready;
};

Broker.prototype._includeRes = function(aid, rid) {
  var self = this;
  var resource = self._resourceMap[aid] && self._resourceMap[aid][rid];
  if (!resource) {
    return RemoteResource.init(self, aid, rid);
  }
  return Promise.resolve(resource);
};

Broker.prototype.generateCacheObject = function() {
  var self = this;
  var resources = {};
  Object.keys(self._brlMap).forEach(function(brl) {
    resources[brl] = self._brlMap[brl]._data;
  });

  return { resources: resources };
};

Broker.prototype.restoreFromCachedData = function(cachedData) {
  var self = this;
  if (!cachedData) {
    throw new Error("Invalid cache data");
  }
  Object.keys(cachedData.resources).forEach(function(brl) {
    if (brl in self.resources) {
      //already synched, cache unecessary
      return;
    }
    var resData = cachedData.resources[brl];
    RemoteResource.fromCachedData(self, resData);
  });
  return self._cache;
};

Broker.prototype._addResource = function(res) {
  var self = this;
  var applicationResourceMap = self._resourceMap[res.application.id];
  if (!applicationResourceMap) {
    applicationResourceMap = self._resourceMap[res.application.id] = {};
  }
  if (res.id in applicationResourceMap) {
    return;
  }
  applicationResourceMap[res.id] = res;
  self._brlMap[res.brl] = res;

  if (res.parent) {
    var connection = self.connections[res.parent];
    if (connection) {
      connection.resources[res.id] = res;
    }
  }
};

Broker.prototype.close = Broker.prototype.delete = function() {
  var self = this;
  if (self._socket) {
    self._socket.disconnect();
  }
};

Broker.prototype.disconnectAll = function() {
  var self = this;
  var ops = [];
  Object.keys(self.connections).forEach(function(id) {
    ops.push(self.disconnect(id));
  });
  return Promise.all(ops);
};

/**
 * Disconnect from another broker.
 * @param {String} id - Connection ID. 
 */
Broker.prototype.disconnect = Broker.prototype.deharmonize = function(id) {
  var connection = this.connections[id];
  if (connection) {
    return connection.disconnect();
  }
  //disconnect not needed as connection doesn't exist
  return Promise.resolve();
};

var onAccountUpdated = function(data) {
  var self = this;
  //HACK: reregister if another instance disconnects
  if (!data) {
    handleReconnect.bind(self)();
  }
};

var onConnectionUpdated = function(eventType, data) {
  var self = this;
  var connection = self.connections[data.id];
  switch (eventType) {
    case "added":
      if (connection) {
        //initialized locally
        connection._update(data);
      } else {
        //initialized remotely
        connection = ConnectionClient.init(self, data);
        connection.ready.then(function() {
          var pendingConnectionCallback =
            self._pendingConnectionCallbacks[data.pendingConnectionKey];
          if (pendingConnectionCallback) {
            delete self._pendingConnectionCallbacks[data.pendingConnectionKey];
            return pendingConnectionCallback(connection);
          }
          return connection;
        });
      }
      var aid = connection._data.application;
      var application = self.applications[aid];
      if (application) {
        application.addConnection(connection);
      } else {
        Application.init(self, aid).ready.then(function(application) {
          application.addConnection(connection);
        });
      }
    // application.addBroker(connection);
    // break;
    case "changed":
      connection._update(data);
      break;
    case "removed":
      connection._remove();
      break;
  }
};

var onError = function(e) {
  console.error("error", e);
};

Broker.prototype.shareTaggedResource = function(tag, params) {
  var self = this;
  if (tag in self._tags) {
    return self._tags[tag].set(params);
  }
  return self.share(params).tag(tag);
};

/**
 * Create a new resource or update an existing resource.
 * @param {Object} params
 * @returns {LocalResource}
 * @also
 * Same as [share(params)]{@link client.Broker#share} but give resource a String tag for easier retrieval.
 * @param {String} tag
 * @param {Object} [params] - See [share(params)]{@link client.Broker#share}
 * @returns {LocalResource}
 */
Broker.prototype.share = function(tag, params) {
  var self = this;
  if (!tag) {
    params = {};
  } else {
    switch (typeof tag) {
      case "object":
        params = tag;
        break;
      case "string":
        if (tag in self._tags) {
          var existing = self._tags[tag];
          if (params) {
            return existing.set(params);
          }
          return existing;
        } else if (!params) {
          params = {
            tag: tag
          };
        } else {
          params.tag = tag;
        }
    }
  }

  params.id = params.id || uuid().slice(0, 8);
  params.meta = params.meta || {};
  params.parent = self.id;
  params.application = self._application;

  var sharedResource = LocalResource.init(this, params);
  return sharedResource;
};

/**
 * Remove a shared resource created with share().
 * @param {LocalResource} resource - LocalResource object.
 */
Broker.prototype.removeResource = function(resource) {
  delete this.shared[resource.id];
  if (resource._data && resource._data.tag) {
    delete this._tags[resource._data.tag];
  }
};

Broker.prototype.setCookie = function() {
  Helpers.Cookies.set(Helpers.COOKIE_ID, this.id);
};

Broker.prototype.paths = function(brl) {
  var self = this;
  var pathSet = new Set();
  var relays = self._remoteRelays[brl];
  if (relays) {
    Object.keys(relays).forEach(function(pathBRL) {
      pathSet.add(pathBRL);
    });
  }
  var resource = self.resources[brl];
  var value = resource && self.resources[brl]._data.value;
  if (value) {
    var values = self._values[value];
    if (values) {
      Object.keys(values).forEach(function(pathBRL) {
        var pathRes = self.resources[pathBRL];
        if (
          pathRes &&
          pathBRL !== brl &&
          pathRes._data.application !== resource._data.application
        ) {
          pathSet.add(pathBRL);
        }
      });
    }
  }

  if (pathSet.size) {
    var result = [];
    pathSet.forEach(function(pathBRL) {
      var resource = self.resources[pathBRL];
      if (resource) {
        result.push(resource);
      }
    });
    if (result.length) {
      return result;
    }
  }
  return null;
};

Broker.prototype.applicationPaths = function(brl) {
  var self = this;
  var paths = self.paths(brl);
  if (!paths) {
    return null;
  }
  var apps = {};
  paths.forEach(function(res) {
    var app = res.application;
    if (app && !(app.id in apps)) {
      apps[app.id] = app;
    }
  });
  return apps;
};

//relay all resources that match filter
//ignore relays
Broker.prototype.relay = function(sourceFilter, meta) {
  var self = this;
  var queryOptions = {
    includeDefault: false,
    includeLocal: false
  };
  var query = self.query(sourceFilter, queryOptions);
  query.resources.forEach(function(res) {
    if (res.relay || res.hasRelayed() || res.resourceType === "static") {
      return;
    }
    res.createRelay(meta);
  });
  return query.listen(function(ev) {
    if (ev.value.hasRelayed() || ev.value.resourceType === "static") {
      return;
    }
    switch (ev.type) {
      case "added":
        if (ev.value && !ev.value.relay) {
          if (typeof meta === "function") {
          }
          ev.value.createRelay(meta).catch(function(e) {
            console.log("Failed to create relay:", e.message);
          });
        }
        break;
      case "changed":
      case "removed":
      //should be handled by resource object
    }
  });
};

//template: resource || string
//options: {}
Broker.prototype.expand = function(template, params) {
  var self = this;
  if (typeof template === "object") {
    //either client resource wrapper or data object
    var data = template._data || template;
    if (data.meta.callback) {
      template = data.brl + (data.meta.template || "");
    } else if (data.meta.template) {
      template = data.meta.template;
    } else {
      template = data.brl;
    }
  }
  if (!template) {
    return new Error("Invalid template");
  }
  var parsedTemplate = UriTemplate.parse(template);
  params = params || {};
  var combinedParams = Object.assign(
    {
      $id: self.id,
      $host: self.host,
      $application: self._application
    },
    params
  );
  var result = parsedTemplate.expand(combinedParams);

  return result;
};

Broker.prototype.launch = function(template, params, listener) {
  var self = this;
  var target = self.expand(template, params);

  var launchedWindow = window.open(target, "_blank");
  self.addChildWindowListener(launchedWindow, listener);
  return launchedWindow;
};

Broker.prototype.addChildWindowListener = function(childWindow, listener) {
  var templateListener = function(event) {
    if (listener) {
      listener(event);
    }
    //TODO:check valid origin
    if (event.data && event.data.type === "finish") {
      console.log("finishing", event.origin);
      window.removeEventListener("message", this);
      childWindow.close();
    }
  };
  childWindow.addEventListener("message", templateListener, false);
  return templateListener;
};

//HACK: firebase auth api has an issue with use pics expiring
Broker.prototype._refreshUserData = function() {
  var self = this;
  return self._auth.currentUser.updateProfile({
    photoURL: self._auth.currentUser.providerData[0].photoURL
  });
};

Broker.prototype._login = function(type) {
  var self = this;
  var provider;
  switch (type) {
    case "facebook":
      provider = new Firebase.auth.FacebookAuthProvider();
      break;
    case "google":
    default:
      provider = new Firebase.auth.GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/plus.login");
      provider.setCustomParameters({ login_hint: "user@example.com" });
      break;
  }
  return self._auth.signInWithPopup(provider);
};
