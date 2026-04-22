# GCC MileWise — Rovaniemi EV Fleet Routing

Interactive web app that computes EV delivery routes over the Rovaniemi
road network, all in the browser.

- **Live site:** deploy via GitHub Pages (see `DEPLOY.md`).
- **Architecture:** Python runs once to convert raw data; React app runs
  entirely in the browser using MapLibre + Dijkstra on a client-side graph.
- **Routes:** configurable fleet size, range, shift length, start battery.
- **Output:** animated routes, delivered vs. missed buildings, suggested
  new charger locations.

See `DEPLOY.md` for setup and deployment.
