#!/bin/bash
# Runs CWMP, NBI and the isolation proxy together; if any exits the container exits and Docker restarts it.
set -eu
node /opt/acs/init.cjs
export GENIEACS_MONGODB_CONNECTION_URL="mongodb://$(node -p 'encodeURIComponent(process.env.MONGO_APP_USER)'):$(node -p 'encodeURIComponent(process.env.MONGO_APP_PASSWORD)')@mongo:27017/genieacs?authSource=genieacs"
export GENIEACS_EXT_DIR=/opt/acs/ext GENIEACS_LOG_FORMAT=json GENIEACS_ACCESS_LOG_FORMAT=json
export GENIEACS_CWMP_INTERFACE=127.0.0.1 GENIEACS_CWMP_PORT=7547 GENIEACS_CWMP_WORKER_PROCESSES=1
export GENIEACS_NBI_INTERFACE=0.0.0.0 GENIEACS_NBI_PORT=7557 GENIEACS_NBI_WORKER_PROCESSES=1
export CWMP_PROXY_HOST=0.0.0.0
node /opt/acs/node_modules/genieacs/bin/genieacs-cwmp &
node /opt/acs/node_modules/genieacs/bin/genieacs-nbi &
node /opt/acs/cwmp-proxy.cjs &
wait -n
exit 1
