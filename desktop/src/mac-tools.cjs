const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createTools({ root, data, env, stopTree, shell = '/bin/zsh' }) {
  const active = new Map();
  async function workdir(value = '.') {
    if (typeof value !== 'string') throw new Error('Invalid working directory');
    const directory = await fs.realpath(path.resolve(root, value));
    // The enclosing macOS sandbox also confines shell commands and symlinks.
    if (env.DESKTOP_ACCESS_MODE === 'folder' && directory !== root && !directory.startsWith(root + path.sep)) throw new Error('Папка вне разрешённого доступа');
    if (directory === data || directory.startsWith(data + path.sep)) throw new Error('Служебная папка недоступна');
    return directory;
  }
  async function run(id, args) {
    if (typeof id !== 'string' || active.has(id) || active.size >= 4) throw new Error('Too many commands or duplicate request');
    if (!args || typeof args.command !== 'string' || !args.command.trim() || args.command.length > 40000) throw new Error('Invalid command');
    const entry = {child:null,canceled:false};
    active.set(id,entry);
    let cwd;
    try { cwd = await workdir(args.cwd); } catch(error) { active.delete(id); throw error; }
    if (entry.canceled) { active.delete(id); throw new Error('Command canceled'); }
    return new Promise((resolve, reject) => {
      const child = spawn(shell, ['-f', '-c', args.command], { cwd, env, detached:true, stdio:['ignore','pipe','pipe'] });
      entry.child = child;
      let output = '', truncated = false;
      const append = chunk => { const text = chunk.toString(); truncated ||= output.length + text.length > 24000; output = (output + text).slice(-24000); };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timer = setTimeout(() => void stopTree(child).catch(() => {}), 120000);
      const cleanup = () => { clearTimeout(timer); active.delete(id); };
      child.once('error', error => { cleanup(); reject(error); });
      child.once('close', (code, signal) => { cleanup(); resolve(`Exit code: ${code}${signal ? ' · ' + signal : ''}\n${truncated ? '[earlier output omitted]\n' : ''}${output}`); });
    });
  }
  const cancel = async id => { const entry = active.get(id); if (entry) { entry.canceled = true; if(entry.child) await stopTree(entry.child); } };
  return { run, cancel, stop: async () => { await Promise.all([...active.keys()].map(cancel)); } };
}
module.exports = { createTools };
