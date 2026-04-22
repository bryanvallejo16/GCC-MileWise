# syntax=docker/dockerfile:1
#
# EV Routing map — static HTML served by nginx.
#
# OpenShift/Rahti runs containers with an arbitrary (non-root) UID, not
# UID 0, so we use nginxinc/nginx-unprivileged which is pre-configured
# to run on port 8080 as a non-root user. This avoids the "nginx: [emerg]
# bind() to 0.0.0.0:80 failed (13: Permission denied)" problem that bites
# people who try to use the stock nginx image on OpenShift.

FROM nginxinc/nginx-unprivileged:1.27-alpine

# ---- Metadata ----
LABEL org.opencontainers.image.title="EV Routing Rovaniemi" \
      org.opencontainers.image.description="Static MapLibre visualization of EV delivery routing" \
      org.opencontainers.image.source="https://github.com/YOUR_USER/ev_routing_rovaniemi"

# ---- App files ----
# Copy the generated HTML into nginx's default document root.
# (routing_map.html is renamed to index.html so it's served at `/`.)
COPY --chown=nginx:nginx output/routing_map.html /usr/share/nginx/html/index.html

# Optional: make summary.json available at /summary.json for debugging
COPY --chown=nginx:nginx output/summary.json /usr/share/nginx/html/summary.json

# ---- nginx config ----
# OpenShift requires the process to bind to a non-privileged port and
# write PID/temp files to paths writable by a random UID. The
# nginx-unprivileged image already binds to 8080; we also add a small
# config for gzip + long cache on the HTML so the map loads fast.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# The base image already sets CMD ["nginx", "-g", "daemon off;"], so
# no override needed.
