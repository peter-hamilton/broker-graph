var BaseReference = require("./base-reference.js");

var PendingConnection = module.exports = function(props) {
  if (!props) {
    props = {};
  } else if (typeof props === "string") {
    props = JSON.parse(props);
  }
  BaseReference.call(this, props);
  this.type = "PendingConnection";
  this.timestamp = props.timestamp || null;

  this.source = props.source || null;
  this.target = props.target || null;

};

PendingConnection.prototype = new BaseReference();
PendingConnection.prototype.constructor = PendingConnection;

PendingConnection.TYPE_DIRECT = "direct";
PendingConnection.TYPE_KEY = "key";
