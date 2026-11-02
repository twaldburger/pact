# Run PACT as a dependency-free Node server over a single JSON file

PACT runs as one local Node process: `node:http` serves a static front end and one JSON file on disk is the single source of truth. The alternatives were browser storage, which locks the plan inside one browser profile and makes it hard to back up or inspect, and SQLite, which buys real queries at the price of the project's first dependency and a schema layer. The plan is small, single-user and worth keeping readable, diffable and copyable, so the file wins.
