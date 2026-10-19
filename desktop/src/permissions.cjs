const path = require('node:path');
const { execFile } = require('node:child_process');
const targets = Object.freeze({accessibility: 'Privacy_Accessibility', 'screen-recording': 'Privacy_ScreenCapture'});
async function computerPermissions(target, {runtime, openExternal, run = execFile}) {
  if (target !== 'status' && !Object.hasOwn(targets, target)) throw new Error('Неизвестное разрешение.');
  const helper = path.join(runtime, 'computer-use');
  if (target === 'status') return new Promise((resolve, reject) => {
    const child = run(helper, [], {timeout: 10000}, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end();
  });
  // Always open Settings, including after a previous denial. Native requests
  // may wait for the user; they must not block the settings window's buttons.
  await openExternal('x-apple.systempreferences:com.apple.preference.security?' + targets[target]);
  const child = run(helper, ['--request-' + target], {timeout: 60000}, () => {});
  child.stdin.end();
  return {opened: true};
}
module.exports = {computerPermissions};
