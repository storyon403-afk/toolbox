'use strict';
// Electron's Windows GUI stdin may be an already-ended placeholder. A bundled
// console Node process owns Toolbox stdio; a private pipe carries the same contract.
const {createServer} = require('node:net');
const {randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
const {join,resolve} = require('node:path');
const {mkdirSync} = require('node:fs');
const token = process.env.TOOLBOX_READY_TOKEN;
if (!token || !process.env.TOOLBOX_DATA_DIR) throw Error('Managed launch requires Toolbox identity and data directory');
const directory = resolve(process.env.TOOLBOX_DATA_DIR); mkdirSync(directory,{recursive:true});
const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\linkparse-${randomUUID()}` : join(directory,`.control-${randomUUID()}.sock`);
let child, connection, authenticated = false, stopping = false, quitTimer;
const server = createServer(socket => {
  if (connection) return socket.destroy();
  connection = socket; socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 65536) return stop();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
      try {
        const ready = JSON.parse(line);
        if (ready.toolboxReady !== token || ready.dataDir !== directory) return stop();
        if (!authenticated) { authenticated = true; clearTimeout(startup); process.stdout.write(JSON.stringify(ready)+'\n'); }
      } catch { stop(); }
    }
  });
  socket.on('error',stop);
  socket.on('end',stop);
  if (stopping) socket.end('quit\n');
});
function stop() {
  if (stopping) return;
  stopping = true; clearTimeout(startup);
  if (connection) connection.end('quit\n');
  quitTimer = setTimeout(() => { child?.kill(); process.exitCode = 1; },12000);
  quitTimer.unref();
}
const startup = setTimeout(stop,40000);
server.on('error',() => {process.exitCode=1;stop();server.close();});
server.listen(endpoint, () => {
  if (stopping) {server.close();return;}
  const executable = join(__dirname,'../../..','LinkParse.exe');
  const env = {...process.env,LINKPARSE_CONTROL_PIPE:endpoint}; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable,[],{env,stdio:'ignore',windowsHide:true});
  child.on('error',()=>{process.exitCode=1;stop();connection?.destroy();server.close();});
  child.on('close',code=>{
    clearTimeout(startup);clearTimeout(quitTimer);connection?.destroy();server.close();
    process.exitCode=authenticated ? (code ?? 1) : 1;
    process.stdin.pause();process.stdin.destroy();
  });
});
process.stdin.on('end',stop);process.stdin.on('error',stop);process.stdin.resume();
