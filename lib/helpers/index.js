const Cookies = require("js-cookie");

const uuid = require('uuid/v4');
const URL = require('url');
const io = require('socket.io-client');
const path = require('path');

exports.COOKIE_ID = "BrokerId";
exports.Cookies = Cookies;

exports.appendURLQuery = function(url, key, values) {
  var parsed = URL.parse(url, true);
  parsed.search = ''; //.format won't use query object if search is set
  if (!parsed.query[key]) {
    parsed.query[key] = values;
  } else {
    parsed.query.i = Array.from(new Set(values.concat(parsed.query[key])));
  }
  return URL.format(parsed);
}

exports.isBrowser = function() {
  if (typeof window === "undefined") {
    return false;
  }
  return true;
}

exports.register = function(config, data) {
  var socket = io(config.host);
  return new Promise(function(res, rej) {
    socket.on("registrationParams", function(params) {
      if (params) {
        socket.emit("register", data, function(registerResult) {
          res(registerResult);
          socket.close();
        });
      } else {
        rej();
      }
    });
  });
}

exports.setCookie = function(broker) {
  return broker
    .ready
    .then(function() {
      Helpers
        .Cookies
        .set(Helpers.COOKIE_ID, broker.id);
    });
}

exports.connectToHost = function(broker) {
  if (!window) {
    return Promise.reject("Not running in a browser");
  }
  return broker
    .ready
    .then(function() {
      return window
        .parent
        .postMessage({
          type: "brokerId",
          id: broker.id
        }, "*");
    });
}

exports.parse = function(brl) {
  return URL.parse(brl);
}

exports.getConfig = function(argv) {
  var config;
  var configPath;
  if (typeof(argv.config) === "object") {
    config = argv.config;
  } else {
    if (argv.config) {
      configPath = path.resolve(process.cwd(), argv.config);
    } else {
      configPath = path.resolve(process.cwd(), "broker.config.json");
    }
    try {
      config = require(configPath);
    } catch (e) {
      var errorMsg = `Invalid or no config.json file: ${e}`;
      throw new Error(errorMsg);
    }
  }
  return config;
}

//return true if valid
exports.checkConfig = function(config) {
  if (!config) {
    return new Error(`Empty config`);
  } else {
    var missing = ["firebaseAdminKey", "firebaseConfig"].filter(function(key) {
      return config[key] === undefined;
    });
    if (missing.length) {
      return new Error(`config missing fields: ${missing.join()}`);
    }
  }
  return true;
}
