var BrokerObject = module.exports = function(args) {
  args = parseArgs(args);

  this.id = args.id || require('uuid/v4')().slice(0, 8); //TODO: remove slice. uuid shortened for debugging
  this.application = args.application || null;
  this.host = args.host || null;
  this.type = args.type || null;
  this.brl = args.brl || null;

  //
  this.flags = args.flags || 0;
  this.meta = this.arguments = args.meta || args.arguments || {}; //TODO: arguments deprecated
};

var parseArgs = BrokerObject.parseArgs = function(args) {
  if (!args) {
    args = {};
  } else if (typeof args === "string") {
    args = JSON.parse(args);
  }
  return args;
}

BrokerObject.prototype.toJson = function() {
  return JSON.stringify(this);
};

BrokerObject.prototype.toString = BrokerObject.prototype.toJson;

BrokerObject.prototype.setMeta = BrokerObject.prototype.putArgument = function(key, value) {
  //TODO: check valid
  this.meta[key] = value;
  return this;
};

BrokerObject.prototype.putArguments = function(args) {
  //TODO: check valid
  for (var k in args) {
    this.putArgument(k, args[k]);
  }
  return this;
};

BrokerObject.prototype.removeMeta = BrokerObject.prototype.removeArgument = function(key) {
  //TODO: check valid
  delete this.meta[key];
  return this;
};

BrokerObject.prototype.setFlags = function(flags) {
  if (this.flags ^ flags !== 0) {
    this.flags = this.flags | flags;
  }
  return this;
};

BrokerObject.prototype.unsetFlags = function(flags) {
  if (this.flags & flags > 0) {
    this.flags = this.flags ^ flags;
  }
  return this;
};

BrokerObject.prototype.hasFlags = function(flags) {
  return (this.flags & flags) === flags;
};
