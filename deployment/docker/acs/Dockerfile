# Private GenieACS (CWMP + NBI) plus the connection-isolation proxy. MongoDB runs in its own container.
FROM node:24-bookworm-slim
ARG GENIEACS_VERSION=1.2.16
WORKDIR /opt/acs
RUN npm install --omit=dev --ignore-scripts --save-exact genieacs@${GENIEACS_VERSION} \
 && cd node_modules/genieacs \
 && npm pkg set 'overrides.ip-address=10.7.4' 'overrides.fast-xml-parser=5.11.2' 'overrides.fast-xml-builder=1.3.1' 'overrides.qs=6.16.1' \
 && npm install --omit=dev --ignore-scripts --package-lock && npm audit --omit=dev
COPY deployment/acs/cwmp-proxy.cjs /opt/acs/cwmp-proxy.cjs
COPY deployment/docker/acs/network-hub-auth.js /opt/acs/ext/network-hub-auth.js
COPY deployment/docker/acs/init.cjs deployment/docker/acs/start.sh /opt/acs/
RUN chmod 0755 /opt/acs/start.sh && mkdir -p /private && chown node:node /private
USER node
VOLUME /private
EXPOSE 7548
CMD ["/opt/acs/start.sh"]
