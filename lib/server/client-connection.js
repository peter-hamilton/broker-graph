//Wrapper for socket.io client connections that references associated broker.
var ClientConnection = module.exports = function(socket, db) {
  var self = this;
  self.socket = socket;
  self.id = self.socket.client.id;
  self.client = self.socket.client;
  self.account = null;

  console.log('-- ' + self.id + ' joined --');
  self
    .socket
    .emit('id', socket.client.id);
};

ClientConnection.prototype.on = function(key, callback) {
  var self = this;
  self
    .socket
    .on(key, function(args, ack) {
      callback(args, self, ack);
    });
};

ClientConnection.prototype.emit = function(key, data) {
  var self = this;
  new Promise(function(resolve, reject) {
    self
      .socket
      .emit(key, data, resolve);
  });
};

//TODO:remove (Debugging)
if (require.main === module) {}