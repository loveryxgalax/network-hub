#!/usr/bin/env bash
# Run as root inside the dedicated NetworkHub-ACS Ubuntu 24.04 WSL instance.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
APP=/opt/network-hub-acs
PRIVATE=/etc/network-hub-acs
NODE_VERSION=${NODE_VERSION:-24.21.0}
GENIEACS_VERSION=1.2.16
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then
  printf '%s\n' 'This installer targets the dedicated Ubuntu 24.04 ACS host.' >&2
  exit 1
fi
if [[ $(id -u) != 0 ]]; then exit 1; fi
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils
install -d -m 0755 "$APP" "$APP/downloads" "$APP/app" "$APP/ext"
curl -fsSL https://pgp.mongodb.com/server-8.0.asc -o "$APP/downloads/mongodb-server-8.0.asc"
gpg --batch --yes --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg "$APP/downloads/mongodb-server-8.0.asc"
printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse' > /etc/apt/sources.list.d/network-hub-mongodb.list
apt-get update -qq
apt-get install -y --no-install-recommends mongodb-org-server mongodb-mongosh mongodb-database-tools
if [[ ! -x "$APP/node/bin/node" ]]; then
  archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$APP/downloads/SHASUMS256.txt"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/$archive" -o "$APP/downloads/$archive"
  (cd "$APP/downloads" && grep "  $archive\$" SHASUMS256.txt | sha256sum -c -)
  install -d -m 0755 "$APP/node"
  tar -xJf "$APP/downloads/$archive" -C "$APP/node" --strip-components=1
fi
export PATH="$APP/node/bin:$PATH"
cd "$APP/app"
if [[ ! -f package.json ]]; then printf '%s\n' '{"name":"network-hub-acs-runtime","private":true,"version":"1.0.0"}' > package.json; fi
npm install --omit=dev --ignore-scripts --save-exact "genieacs@$GENIEACS_VERSION"
# GenieACS ships bundled dependencies. Re-resolve its runtime tree with
# compatible security fixes instead of leaving the bundled vulnerable versions.
cd "$APP/app/node_modules/genieacs"
npm pkg set 'overrides.ip-address=10.7.4' 'overrides.fast-xml-parser=5.11.2' 'overrides.fast-xml-builder=1.3.1' 'overrides.qs=6.16.1'
npm install --omit=dev --ignore-scripts --package-lock
npm audit --omit=dev
cd "$APP/app"
if ! id genieacs >/dev/null 2>&1; then useradd --system --no-create-home --user-group --shell /usr/sbin/nologin genieacs; fi
install -d -o root -g genieacs -m 0750 "$PRIVATE"
install -d -o genieacs -g genieacs -m 0750 /var/log/network-hub-acs
node <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto');
const file='/etc/network-hub-acs/secrets.json';
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({mongoAdmin:'networkhub-admin',mongoAdminPassword:crypto.randomBytes(32).toString('base64url'),mongoUser:'networkhub-acs',mongoPassword:crypto.randomBytes(32).toString('base64url'),uiJwt:crypto.randomBytes(64).toString('hex')},null,2),{mode:0o600,flag:'wx'});
const cp='/etc/network-hub-acs/cpes.json';
if(!fs.existsSync(cp))fs.writeFileSync(cp,JSON.stringify({devices:{}},null,2),{mode:0o640,flag:'wx'});
NODE
chown root:genieacs "$PRIVATE/cpes.json"
chmod 0640 "$PRIVATE/cpes.json"
chmod 0600 "$PRIVATE/secrets.json"
cat > /etc/mongod.conf <<'YAML'
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.25
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1
security:
  authorization: enabled
processManagement:
  timeZoneInfo: /usr/share/zoneinfo
YAML
systemctl enable mongod >/dev/null
systemctl restart mongod
for attempt in $(seq 1 30); do
  if curl -s --max-time 1 http://127.0.0.1:27017/ >/dev/null; then break; fi
  sleep 1
done
cat > "$APP/ext/network-hub-auth.js" <<'JS'
'use strict';
const fs=require('node:fs');
function entry(args){const serial=String(args[0]||'');const data=JSON.parse(fs.readFileSync('/etc/network-hub-acs/cpes.json','utf8'));return data.devices?.[serial];}
exports.enrolled=(args,callback)=>{try{const e=entry(args);callback(null,!!(e&&e.enabled&&typeof e.password==='string'&&e.password.length>=32));}catch(error){callback(error);}};
exports.password=(args,callback)=>{try{const e=entry(args);callback(null,e&&e.enabled?e.password:null);}catch(error){callback(error);}};
JS
chown root:genieacs "$APP/ext/network-hub-auth.js"
chmod 0640 "$APP/ext/network-hub-auth.js"
node <<'NODE'
const fs=require('node:fs'),genieRequire=require('node:module').createRequire(require.resolve('genieacs/package.json')),{MongoClient}=genieRequire('mongodb');
const s=JSON.parse(fs.readFileSync('/etc/network-hub-acs/secrets.json','utf8'));
const adminUri='mongodb://'+encodeURIComponent(s.mongoAdmin)+':'+encodeURIComponent(s.mongoAdminPassword)+'@127.0.0.1:27017/admin?directConnection=true';
(async()=>{
 let client=new MongoClient(adminUri,{serverSelectionTimeoutMS:5000});
 try{await client.connect();await client.db('admin').command({ping:1});}
 catch(error){await client.close().catch(()=>{});const bootstrap=new MongoClient('mongodb://127.0.0.1:27017/admin?directConnection=true',{serverSelectionTimeoutMS:5000});try{await bootstrap.connect();await bootstrap.db('admin').command({createUser:s.mongoAdmin,pwd:s.mongoAdminPassword,roles:[{role:'root',db:'admin'}]});}finally{await bootstrap.close();}client=new MongoClient(adminUri,{serverSelectionTimeoutMS:5000});await client.connect();}
 try{
  const db=client.db('genieacs');const info=await db.command({usersInfo:s.mongoUser});
  if(!info.users.length)await db.command({createUser:s.mongoUser,pwd:s.mongoPassword,roles:[{role:'readWrite',db:'genieacs'}]});
  const expression='EXT("network-hub-auth", "enrolled", DeviceID.SerialNumber) = true AND AUTH(DeviceID.SerialNumber, EXT("network-hub-auth", "password", DeviceID.SerialNumber))';
  await db.collection('config').updateOne({_id:'cwmp.auth'},{$set:{value:expression}},{upsert:true});
  const appUri='mongodb://'+encodeURIComponent(s.mongoUser)+':'+encodeURIComponent(s.mongoPassword)+'@127.0.0.1:27017/genieacs?authSource=genieacs';
  const lines=[
   'GENIEACS_MONGODB_CONNECTION_URL='+appUri,'GENIEACS_EXT_DIR=/opt/network-hub-acs/ext',
   'GENIEACS_CWMP_INTERFACE=127.0.0.1','GENIEACS_CWMP_PORT=7547','GENIEACS_CWMP_WORKER_PROCESSES=1',
   'GENIEACS_NBI_INTERFACE=127.0.0.1','GENIEACS_NBI_PORT=7557','GENIEACS_NBI_WORKER_PROCESSES=1',
   'GENIEACS_UI_INTERFACE=127.0.0.1','GENIEACS_UI_JWT_SECRET='+s.uiJwt,
   'GENIEACS_CWMP_LOG_FILE=/var/log/network-hub-acs/cwmp.log','GENIEACS_CWMP_ACCESS_LOG_FILE=/var/log/network-hub-acs/cwmp-access.log',
   'GENIEACS_NBI_LOG_FILE=/var/log/network-hub-acs/nbi.log','GENIEACS_NBI_ACCESS_LOG_FILE=/var/log/network-hub-acs/nbi-access.log',
   'GENIEACS_LOG_FORMAT=json','GENIEACS_ACCESS_LOG_FORMAT=json'
  ];
  fs.writeFileSync('/etc/network-hub-acs/genieacs.env',lines.join('\n')+'\n',{mode:0o600});
  const build=await client.db('admin').command({buildInfo:1});
  fs.writeFileSync('/opt/network-hub-acs/install.json',JSON.stringify({installedAt:new Date().toISOString(),node:process.versions.node,genieacs:require('genieacs/package.json').version,mongodb:build.version,cwmp:'http://127.0.0.1:7547',nbi:'http://127.0.0.1:7557',authentication:'serial-scoped credentials; unknown serials denied'},null,2));
 }finally{await client.close();}
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
NODE
for component in cwmp nbi; do
  cat > "/etc/systemd/system/network-hub-acs-$component.service" <<UNIT
[Unit]
Description=Network Hub GenieACS $component
After=network.target mongod.service
Requires=mongod.service
[Service]
Type=simple
User=genieacs
Group=genieacs
EnvironmentFile=/etc/network-hub-acs/genieacs.env
WorkingDirectory=/opt/network-hub-acs/app
Environment=PATH=/opt/network-hub-acs/node/bin:/usr/bin:/bin
ExecStart=/opt/network-hub-acs/node/bin/node /opt/network-hub-acs/app/node_modules/genieacs/bin/genieacs-$component
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/log/network-hub-acs
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
UNIT
done
cat > /etc/logrotate.d/network-hub-acs <<'LOGROTATE'
/var/log/network-hub-acs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su genieacs genieacs
}
LOGROTATE
install -m 0644 "$(dirname "${BASH_SOURCE[0]}")/cwmp-proxy.cjs" "$APP/cwmp-proxy.cjs"
install -m 0644 "$(dirname "${BASH_SOURCE[0]}")/network-hub-acs-proxy.service" /etc/systemd/system/network-hub-acs-proxy.service
systemctl daemon-reload
systemctl enable network-hub-acs-cwmp network-hub-acs-nbi network-hub-acs-proxy >/dev/null
systemctl restart network-hub-acs-cwmp network-hub-acs-nbi network-hub-acs-proxy
install -m 0755 "$(dirname "${BASH_SOURCE[0]}")/keep-host.sh" "$APP/keep-host.sh"
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 2 'http://127.0.0.1:7557/devices/?projection=_id&limit=1' > "$APP/downloads/nbi-health.json"; then break; fi
  sleep 1
done
node -e 'const fs=require("node:fs");if(!Array.isArray(JSON.parse(fs.readFileSync("/opt/network-hub-acs/downloads/nbi-health.json","utf8"))))process.exit(1)'
systemctl is-active mongod network-hub-acs-cwmp network-hub-acs-nbi network-hub-acs-proxy
cat "$APP/install.json"
