# Broker Graph

Broker Graph is an implementation of [concepts](docs/CONCEPTS.md) developed during my graduate work at the University of Toronto. The description of these concepts and the prototype code is **shared to support future research**. This project is **no longer being actively developed as of 2018**.

- [Broker Graph Concepts](docs/CONCEPTS.md) - Write-up of Broker Graph concepts and motivations.
- [Architecture](docs/ARCHITECTURE.md) - High level details of the implementation architecture.
- [Development](docs/DEVELOPMENT.md) - Instructions for building the code.
- [API Documentation](https://peter-hamilton.github.io/broker-graph/) - JSDoc generated *partial* API documentation.

![Formation of Broker Graph relationships](docs/img/BrokerGraphFormation.gif)
## Getting Started

### Setup Server

1. Create a Firebase Javascript Realtime Database ([Instructions](https://firebase.google.com/docs/database/web/start))
   - Firebase Security Rules: Test Mode
   - Follow the instructions for [Initializing the Realtime Database JavaScript SDK](https://firebase.google.com/docs/database/web/start#initialize_the_javascript_sdk). Save the `config` object for a future step.
   - Follow instructions for [generating a private key](https://firebase.google.com/docs/admin/setup#initialize-sdk). Save the key securely.
2. Install Node.js dependencies:

    ```bash
    # Install Broker Graph
    npm install broker-graph
    # Install server dependencies
    npm install express socket.io
    ```

3. Initialize BrokerServer, pasting the Firebase config from step 1. `host` should be the URL of the server.

    ```javascript
    // Initialize express http server
    var app = require('express')()
    var server = require('http').createServer(app);
    server.listen(port, function() {
      console.log('Listening on port ' + port);
    });

    // Initialize Socket.io
    var io = require('socket.io')(server);

    // Initialize Broker Server
    brokerServer = new require('broker-graph').server(io, app, {
      firebaseConfig: {/*firebase config*/},
      firebaseAdminKey: {/*admin key object*/},
      host: "http://HOST:PORT"
    });
    brokerServer.ready.then(() => {
      //Register applications
      brokerServer.registerApplication(
      {
        id: "myApp",
        meta: {/*define general application info*/},
        resources: {/*define static resources*/}
      });
      //Array of Applications can also be passed in BrokerServer `applications` argument
    });
    ```

### Include Broker Graph Client

Broker Graph client can be imported into Node.js applications or included in HTML websites, using a webpack bundled module.

**Node.js**:

Install Node.js dependencies using npm:

    ```npm install broker-graph```

Import module:

```javascript
const Broker = require('broker-graph').client;
```

**HTML**:

Add `broker.js` file and include script in html file:

```html
<script type="text/javascript" src="broker.js"></script>
```

### Initialize a Broker

```javascript
let broker = new Broker({
    host: "http://[server:port]",
    application: "[my_app]",
    firebaseConfig: {/*Copy firebase config*/},
    meta: {
      title: "My App",
      //broker instance info...
    }
    });

broker.ready.then(()=>
{
  // Promise resolves when Broker client is initialized and ready to handle operations.
  // broker.[operation()]...
});

```
