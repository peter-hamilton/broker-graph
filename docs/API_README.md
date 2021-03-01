# Broker Graph API

The Broker Graph API allows developers to create and update shared resources; form connections; and query available resources. Through the Broker Graph API application developers specify how they envision their application will work across devices to both other applications and users.

Interacting with the Broker Graph starts with initializing a [Broker]{@link client.Broker}. Once initialized (i.e., after `broker.ready` resolves), the following core operations can be used.

- [.include()]{@link client.Broker#include}: Gain access to static resources from a specified application.
- [.connect()]{@link client.Broker#connect}: Form a connection with other Brokers to gain access to additional resources.
- [.share()]{@link client.Broker#share}: Share a local resource or update a previously shared resources metadata.
- [.query()]{@link client.Broker#query}: Query available resources.