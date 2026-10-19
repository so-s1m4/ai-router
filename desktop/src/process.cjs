const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { descendants } = require('./access.cjs');
const exec = promisify(execFile);
async function processTree(pid) {
  const {stdout} = await exec('/bin/ps', ['-axo','pid=,ppid=']);
  const rows = stdout.trim().split('\n').map(line => { const [pid,ppid] = line.trim().split(/\s+/).map(Number); return {pid,ppid}; });
  return descendants(rows, pid);
}
async function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Freeze parents before collecting descendants: detached command groups must also stop.
  const frozen = [];
  const freeze = pid => { try { process.kill(pid, 'SIGSTOP'); frozen.push(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  try {
    freeze(child.pid);
    for (let pass = 0; pass < 3; pass++) {
      const children = await processTree(child.pid);
      for (const pid of children) if (!frozen.includes(pid)) freeze(pid);
    }
    for (const pid of frozen.reverse()) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  } catch (error) {
    for (const pid of frozen) { try { process.kill(pid,'SIGCONT'); } catch {} }
    throw error;
  }
  await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('close',resolve); });
}
module.exports = { killTree };
