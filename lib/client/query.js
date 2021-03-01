const account = require('../structures/account');
const resource = require('../structures/resource');
const connection = require('../structures/connection');

const util = require('util');
const EventEmitter = require('events').EventEmitter;

const Mingo = require('mingo');

Mingo.setup({key: 'key'});

/**
 * Query object used for defining a query and retrieving the data it corresponds to.
 * @class
 * @memberof client
 */
var Query = module.exports = function(broker, query, options) {
  var self = this;
  self._broker = broker;
  self._query = new Mingo.Query(query);
  self._listeners = {};
  self.groups = {};
  self._resourceGroup = new Group("resources");
  // self._resourceMap = {};
  // self._resourceCollection = [];
  self._options = {};

  self.groups.applications = new GroupSet({
    keyFunction: function(res) {
      //check relay paths, add to each participating application group
      var pathResources = res.paths();
      if (pathResources) {
        var keySet = new Set([res._data.application]);
        pathResources.forEach(function(res) {
          keySet.add(res._data.application);
        });
        return Array.from(keySet);
      }
      return res._data.application;
    },
    metaFunction: function(key) {
      return self
        ._broker
        .applications[key]
        ._data
        .meta;
    }
  });
  self.groups.values = new GroupSet({
    keyFunction: function(res) {
      var val = res._data.relay
        ? res._data.relay.value
        : res._data.value;
      return val;
    }
  });

  /**
   * All resources that match the query.
   * @property{RemoteResource[]}
   */
  self.resources = self._resourceGroup.resources;
  self.apps = [];
  self.refresh(null, checkOptions(options));
};

Query.prototype._resetResourceGroup = function() {
  var self = this;
  var resourceMap = {};
  var resourceCollection = [];
  for (var aid in self._broker._resourceMap) {
    var appResources = self
      ._broker
      ._resourceMap[aid];
    for (rid in appResources) {
      var resource = appResources[rid];
      if (!resource) {
        continue;
      }
      if (resource.relay) { //skip relays
        continue;
      }
      if (!self._options.includeDefault) {
        if (resource.resourceType === "static" || resource.isApplicationDefault()) {
          continue;
        }
      }
      resourceMap[resource.brl] = resource;
      resourceCollection.push(resource._data);
    }
  }

  if (self._options.includeLocal) {
    Object
      .keys(self._broker.shared)
      .forEach(function(resId) {
        var resource = self
          ._broker
          .shared[resId];
        if (!resource || !resource._synchedData) { //check that resource exists on server
          return;
        }
        if (resource.relay) { //skip relays
          return;
        }

        resourceMap[resource.brl] = resource;
        resourceCollection.push(resource._synchedData);
      });
  }

  if (self._options.includeCache && self._broker._cache && self._broker._cache.resources) {
    Object
      .keys(self._broker._cache.resources)
      .forEach(function(brl) {
        if (brl in resourceMap) {
          return;
        }
        var resource = self
          ._broker
          ._cache
          .resources[resources];

        if (!resource) { //removed~~
          return;
        }
        if (resource.relay) { //skip relays
          return;
        }
        if (!self._options.includeDefault) {
          if (resource.isApplicationDefault()) {
            return;
          }
        }
        resourceMap[resource.brl] = resource;
        resourceCollection.push(resource._data);
      });
  }

  var cursor = self
    ._query
    .find(resourceCollection);

  var resourceGroup = self._resourceGroup;

  //remove old resources
  Object
    .keys(resourceGroup.resourceMap)
    .filter(function(resBrl) {
      return !(resBrl in resourceMap);
    })
    .forEach(function(resItem) {
      resourceGroup.remove(resItem);
      Object
        .keys(self.groups)
        .forEach(function(type) {
          self
            .groups[type]
            .remove(resItem);
        });
    });

  // if (self._options.sortFunction) {
  //   resourceGroup.sort(self._options.sortFunction);
  // }
  // if (self._options.rankFunction) {
  //   resourceGroup.search(self._options.rankFunction);
  // }

  cursor
    .all()
    .forEach(function(data) {
      var res = resourceMap[data.brl];
      resourceGroup.update(res);
    });

  resourceGroup
    .resources
    .forEach(function(res) {
      Object
        .keys(self.groups)
        .forEach(function(type) {
          self
            .groups[type]
            .add(res);
        });
    });

  return true;
};

Query.prototype._updateResourceGroup = function(changes) {
  var self = this;
  if (!changes) {
    return self._resetResourceGroup();
  }
  var result = false;
  if (Array.isArray(changes)) {
    changes.forEach(function(change) {
      result = result || self._applyChange(change);
    })
  } else {
    result = self._applyChange(changes);
  }
  return result;
};

Query.prototype._applyChange = function(change) {
  var self = this;
  var res = change.value;
  if (self.test(res)) {
    switch (change.type) {
      case "added":
        self
          ._resourceGroup
          .add(res);
        Object
          .keys(self.groups)
          .forEach(function(groupType) {
            var groupSet = self.groups[groupType];
            groupSet.add(res);
          });
        return true;
      case "removed":
        self
          ._resourceGroup
          .remove(res.brl);
        Object
          .keys(self.groups)
          .forEach(function(groupType) {
            var groupSet = self.groups[groupType];
            groupSet.remove(res.brl);
          });
        return true;
      case "changed":
        self
          ._resourceGroup
          .update(res);
        Object
          .keys(self.groups)
          .forEach(function(groupType) {
            var groupSet = self.groups[groupType];
            groupSet.update(res);
          });
        return true;
    }
  } else if (self._resourceGroup.has(res.brl)) { //If resource changed to no longer match
    self
      ._resourceGroup
      .remove(res.brl);
    Object
      .keys(self.groups)
      .forEach(function(groupType) {
        var groupSet = self.groups[groupType];
        groupSet.remove(res.brl);
      });
    return true;
  }
  return false;
}

Query.prototype.addGroup = function(name, options) {
  var self = this;
  var option = Object.assign(options || {}, self._options);
  var groupSet = self.groups[name] = new GroupSet(options);
  return groupSet;
};

/**
 * Refresh the query.
 * @param  {} changes - optional variable that describes changes to the dataset
 * @param  {} options - query options.
 * @return {Query} - Instance of query.        
 */
Query.prototype.refresh = function(changes, options) {
  var self = this;
  //update changed options
  if (options) {
    self
      ._resourceGroup
      .setOptions(options);
    Object
      .keys(self.groups)
      .forEach(function(groupType) {
        var groupSet = self.groups[groupType];
        groupSet.setOptions(options);
      });
    self._options = Object.assign(self._options, options);
  }

  var changed;
  if (changes) {
    changed = self._updateResourceGroup(changes);
  } else { //reset dataset
    changed = self._resetResourceGroup();
  }

  if (changed) {
    self._refreshShortcuts();
  }
  return self;
}

Query.prototype._refreshShortcuts = function(resource) {
  var self = this;
  self.resources = self._resourceGroup.resources;
  self.apps = self
    .groups
    .applications
    .asArray();
  self.values = self
    .groups
    .values
    .asArray();

  self.first = self.resources.length > 0
    ? self.resources[0]
    : null;
};

Query.prototype.test = function(resource) {
  var self = this;
  if (!resource || !resource._data) {
    return false;
  }
  return self
    ._query
    .test(resource._data);
};

Query.prototype.search = function(rankFunction) {
  var self = this;
  rankFunction = rankFunction === undefined
    ? self._options.rankFunction
    : rankFunction;
  self._options.rankFunction = rankFunction;
  self
    ._resourceGroup
    .search(rankFunction);
  Object
    .keys(self.groups)
    .forEach(function(groupType) {
      var groupSet = self.groups[groupType];
      groupSet.search(rankFunction);
    });
  self._refreshShortcuts();
  return self;
};

/**
 * Sorts the queried items.
 * @returns {Query} 
 */
Query.prototype.sort = function() {
  var self = this;
  self._options.sortFunction = sortFunction;
  self
    ._resourceGroup
    .sort(sortFunction);
  Object
    .keys(self.groups)
    .forEach(function(groupType) {
      var groupSet = self.groups[groupType];
      groupSet.sort(sortFunction);
    });
  self._refreshShortcuts();
  return self;
};

/**
 * Number of queried items.
 * @returns {int}
 */
Query.prototype.count = function() {
  var self = this;
  self.refresh();
  return self
    ._resourceGroup
    .count();
}


/**
 * This callback is displayed as a global member.
 * @callback QueryCallback
 * @param {String} eventType
 * @param {Query} queryInstance
 */

/**
 * Add callback that is called when the items returned by a query changes.
 * @param {QueryCallback} callback 
 * @returns {QueryCallback}
 */
Query.prototype.listen = function(callback) {
  var self = this;
  if (typeof(callback) !== "function") {
    throw new Error("callback arg not function");
  }
  var existing = self._listeners[callback];
  if (existing) {
    throw new Error("Listener already added");
    return;
  }

  self._listeners[callback] = resourceUpdatedCallback.bind(this)(callback);
  self
    ._broker
    .on("resource_updated", self._listeners[callback]);
  return callback;
};

/**
 * Remove callback added with listen().
 * @param {QueryCallback} callback 
 * @return {boolean} - true if successfully removed. 
 */
Query.prototype.removeListener = function(callback) {
  var self = this;
  var existing = self._listeners[callback];
  if (existing) {
    this
      ._broker
      .removeListener("resource_updated", self._listeners[callback]);
    return true;
  }
  return false;
};

/**
 * Remove all callbacks added with listen().
 */
Query.prototype.removeListeners = function() {
  var self = this;
  Object
    .keys(self._listeners)
    .forEach(function(key) {
      var listener = self._listeners[key];
      self
        ._broker
        .removeListener("resource_updated", listener);
    });
};

var checkOptions = function(options) {
  //apply default if not set or invalid
  options = options || {};
  options.includeLocal = (options.includeLocal === undefined)
    ? false
    : options.includeLocal;
  options.includeDefault = (options.includeDefault === undefined)
    ? true
    : options.includeDefault;
  options.includeCache = (options.includeCache === undefined)
    ? true
    : options.includeCache;
  return options;
}

var resourceUpdatedCallback = function(callback) {
  var self = this;
  return function(ev) {
    if (self.test(ev.value)) { //test changed resource against query
      self.refresh(ev);
      callback(ev, self);
    }
  };
}

/**
 * A grouping of query results.
 * @class
 * @memberof client
 * @param {Object} options 
 */
var GroupSet = function(options) {
  this.map = this.groups = {};
  this._options = {};
  this.setOptions(options);
}

GroupSet.prototype.setOptions = function(options) {
  var self = this;
  self._options = Object.assign(self._options, options);

  self._keyFunction = self._options.keyFunction;
  self._sortFunction = self._options.sortFunction;
  //TODO: seperate group and groupset options
  Object
    .keys(self.groups)
    .forEach(function(key) {
      var group = self.groups[key];
      group.setOptions(self._options);
    });
  return true;
};

GroupSet.prototype.sort = function(sortFunction) {
  var self = this;

  self._sortFunction = sortFunction;
  Object
    .keys(self.groups)
    .forEach(function(key) {
      var group = self.groups[key];
      group.sort(sortFunction);
    });
  return true;
};

GroupSet.prototype.search = function(rankFunction) {
  var self = this;

  self._rankFunction = rankFunction;
  Object
    .keys(self.groups)
    .forEach(function(key) {
      var group = self.groups[key];
      group.search(rankFunction);
    });
  return true;
};

GroupSet.prototype.add = function(resource) {
  var self = this;
  var result = self._keyFunction(resource);
  if (Array.isArray(result)) {
    result.forEach(function(key) {
      var group = self.groups[key];
      if (!group) {
        var options = {};
        options.meta = self._options.metaFunction
          ? self
            ._options
            .metaFunction(key)
          : null;

        group = self.groups[key] = new Group(key, options);
      }
      group.add(resource);
    });
    return true;
  } else if (typeof(result) === "string") {
    var group = self.groups[result];
    if (!group) {
      var options = {};
      options.meta = self._options.metaFunction
        ? self
          ._options
          .metaFunction(result)
        : null;
      if (self._sortFunction) {
        options.sortFunction = self._sortFunction;
      }
      group = self.groups[result] = new Group(result, options);
    }
    group.add(resource);
    return true;
  }
  return false;
}

//TODO: brute force. maybe maintain a map.
GroupSet.prototype.remove = function(id) {
  var self = this;
  Object
    .keys(self.groups)
    .forEach(function(groupKey) {
      self
        .groups[groupKey]
        .remove(id);
    })
}

//HACK: demo sloppiness
GroupSet.prototype.update = function(resource) {
  var self = this;
  self.remove(resource.brl);
  self.add(resource);
}

GroupSet.prototype.count = function() {
  var self = this;
  return Object
    .keys(self.groups)
    .length;
}

GroupSet.prototype.asArray = function() {
  var self = this;
  var result = [];
  Object
    .keys(self.groups)
    .forEach(function(groupId) {
      var group = self.groups[groupId];
      if (group.resources.length > 0) {
        result.push(group);
      }
    });
  return result;
}

/**
 * @class
 * @memberof client
 * @param {String} id - Unique name of group. 
 * @param {*} options 
 */
var Group = function(id, options) {
  this.id = id;
  this.resources = [];
  this.resourceMap = {};
  this.options = {
    meta: null
  };

  this.setOptions(options);
}

Group.prototype.setOptions = function(options) {
  var self = this;
  options = options || {};

  if (options.meta && self.options.meta !== options.meta) {
    self.meta = options.meta;
  }
  if (options.sortFunction && self.options.sortFunction !== options.sortFunction) {
    self.sort(options.sortFunction);
  }
  if (options.rankFunction && self.options.rankFunction !== options.rankFunction) {
    self.search(options.rankFunction);
  }
  return true;
};

/**
 * Check if Broker resource exists.
 * @param {String} brl 
 * @returns {boolean} True if corresponding resource exists.
 */
Group.prototype.has = function(brl) {
  return brl in this.resourceMap;
};

/**
 * Get index of Broker resource if it exists.
 * @param {String} brl 
 * @returns {int} - Corresponding index or -1 if none found.
 */
Group.prototype.indexOf = function(brl) {
  var resEntry = this.resourceMap[brl];
  if (resEntry) {
    return resEntry.index;
  }
  return -1;
};

/**
 * Add Broker resource
 * @param {*} resource - Resource to be added.
 * @param {int} [rank] - If provided, force rank value. 
 */
Group.prototype.add = function(resource, rank) {
  var self = this;
  var index; //insert index
  if (resource && resource.brl && !self.has(resource.brl)) {
    if (!rank && self._rankFunction) {
      rank = self._rankFunction(resource);
    }

    //add to map
    self.resourceMap[resource.brl] = new Item(resource, self.resources.length, rank);

    //determine insertion index
    if (rank) {

      for (var i = 0; i < self.resources.length; i++) {
        var next = self.resourceMap[
          self
            .resources[i]
            .brl
        ];
        if (next < rank) {
          index = i;
          break;
        }
      }
    } else if (self.options.sortFunction) {
      var last = -1;
      for (var i = 0; i < self.resources.length; i++) {
        var next = self
          .options
          .sortFunction(resource, self.resources[i]);
        if (next > last) {
          index = i;
          break;
        }
        last = next;
      }
    }

    if (index !== undefined && index < self.resources.length) {
      self
        .resources
        .splice(index, 0, resource);
    } else {
      self
        .resources
        .push(resource);
    }
    self._refreshMap();
    return true;

  }
  return false;
};

Group.prototype.remove = function(brl) {
  var self = this;
  if (self.has(brl)) {
    var resData = self.resourceMap[brl];
    self
      .resources
      .splice(resData.index, 1);
    delete self.resourceMap[brl];
    self._refreshMap();
    return true;
  }
  return false;
};

Group.prototype.update = function(resource, rank) {
  var self = this;
  var brl = resource.brl;
  self.remove(brl);
  return self.add(resource, rank);
};

Group.prototype.sort = function(sortFunction) {
  var self = this;
  self.resources = self
    .resources
    .sort(sortFunction);
  self.options.sortFunction = sortFunction;
  self._refreshMap();
  return self;
};

Group.prototype.count = function() {
  var self = this;
  return self.resources.length;
};

Group.prototype._refreshMap = function() {
  var self = this;
  self
    .resources
    .forEach(function(res, index) {
      var resItem = self.resourceMap[res.brl];
      resItem.index = index;
    });
};

Group.prototype.search = function(rankFunction) {
  var self = this;

  //if rank function is null, reevaluate existing
  rankFunction = rankFunction || self.options.rankFunction;

  if (rankFunction) {

    var results = [];
    Object
      .keys(self.resourceMap)
      .forEach(function(id) {
        var resData = self.resourceMap[id];
        resData.rank = rankFunction(resData.value);
        if (resData.rank >= 0) {
          results.push(resData);
        }
      });

    results = results.sort(function(a, b) {
      return b.rank - a.rank;
    });
    self.resources = results.map(function(result) {
      return result.value;
    });
  }

  self.options.rankFunction = rankFunction;
  self._refreshMap();
  return self;
}

var Item = function(value, index, rank) {
  this.value = value;
  this.id = value.brl;
  this.index = index;
  this.rank = rank || 0;
}

/**
 * Creates a Mingo Query object and performs a find operation, returning a Mingo Cursor
 * @param {*} query 
 * @param {*} collection 
 */
Query.find = function(query, collection) {
  var mingoQuery = new Mingo.Query(query);
  return mingoQuery.find(collection);
}

/**
 * Creates a Mingo Query object and performs a remove operation, returning a Mingo Cursor.
 * @param {*} query 
 * @param {*} collection 
 */
Query.remove = function(query, collection) {
  var mingoQuery = new Mingo.Query(query);
  return mingoQuery.remove(collection);
}

/**
 * Apply a rank function to a given colleciton.
 * @param {function} rankFunction 
 * @param {*} collection 
 */
Query.search = function(rankFunction, collection) {
  var results = collection.map(function(item) {
    return {item: item, rank: rankFunction(item)};
  });

  results = results.filter(function(result) {
    return result.rank > 0;
  });

  results = results.sort(function(a, b) {
    return b.rank - a.rank;
  });

  return results.map(function(result) {
    return result.item;
  });
}
