const { spawn } = require('node:child_process');
function createComputerTools({ enabled, helper, stopTree, spawnProcess = spawn }) {
  const active = new Map();
  let queue = Promise.resolve();
  async function run(id, args) {
    if (!enabled) throw new Error('App control is disabled. Enable it in AI Router settings with extended access.');
    if (typeof id !== 'string' || active.has(id) || active.size >= 4) throw new Error('Too many computer requests or duplicate request');
    const entry = { child: null, canceled: false }; active.set(id, entry);
    const previous = queue;
    let release; queue = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      if (entry.canceled) throw new Error('Computer action canceled');
      if (!args || typeof args.operation !== 'string') throw new Error('Invalid computer operation');
      return await new Promise((resolve, reject) => {
        const child = spawnProcess(helper, [], { stdio: ['pipe','pipe','pipe'], detached: true });
        entry.child = child;
        let output = '', error = '', overflow = false;
        const timer = setTimeout(() => void stopTree(child).catch(() => {}), 30000);
        child.stdout.on('data', chunk => {
          if (output.length + chunk.length > 3000000) { overflow = true; void stopTree(child).catch(() => {}); }
          else output += chunk;
        });
        child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
        child.stdin.on('error', () => {});
        child.once('error', failure => { clearTimeout(timer); reject(failure); });
        child.once('close', code => {
          clearTimeout(timer);
          if (entry.canceled) return reject(new Error('Computer action canceled'));
          if (overflow) return reject(new Error('Computer output too large'));
          try {
            const result = JSON.parse(output);
            if (code !== 0 || result.error) throw new Error(result.error || error || 'Computer helper failed');
            const { image, mimeType, ...metadata } = result;
            const content = [{ type: 'text', text: JSON.stringify(metadata) }];
            if (image) content.push({ type: 'image', data: image, mimeType });
            resolve(content);
          } catch (failure) { reject(new Error(failure.message || error || 'Computer helper failed')); }
        });
        child.stdin.end(JSON.stringify(args));
      });
    } finally { active.delete(id); release(); }
  }
  async function cancel(id) { const entry = active.get(id); if (entry) { entry.canceled = true; if (entry.child) await stopTree(entry.child); } }
  return { run, cancel, stop: () => Promise.all([...active.keys()].map(cancel)) };
}
module.exports = { createComputerTools };
