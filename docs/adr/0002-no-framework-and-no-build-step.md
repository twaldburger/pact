# Hand-write the front end: no framework, no bundler

The front end is plain HTML, CSS and ES modules with no build step. The Timeline's interactions - drag to create, drag to resize, snapping, readouts - are pointer events over DOM, so a framework would carry little of the work while adding a toolchain, a lockfile and a build to a project whose value is that it starts with one command.
