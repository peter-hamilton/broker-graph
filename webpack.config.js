var path = require('path');
var webpack = require('webpack');
var BUILD_DIR = path.resolve(__dirname, 'dist');
var CLIENT_DIR = path.resolve(__dirname, 'lib/client');

var config = {
  mode: "development",
  entry: CLIENT_DIR,
  output: {
    path: BUILD_DIR,
    filename: 'broker.js',
    libraryTarget: "var",
    library: "Broker"
  },
  module: {
    rules: []
  }
};

module.exports = config;
