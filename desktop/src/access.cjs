const path = require('node:path');
function serverUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter an HTTPS website URL without a path, password or query parameters.');
  }
  return url.origin;
}
function quote(value) {
  if (/[\x00-\x1f]/.test(value)) throw new Error('Invalid path');
  return JSON.stringify(value);
}
function folderProfile({ folder, data, runtime, executable, temporary }) {
  if (!path.isAbsolute(folder) || folder === '/') throw new Error('Choose a specific folder');
  // dyld needs executable mappings, separately from file-read*. Cryptex paths
  // follow Chromium's sandbox/policy/mac/common.sb (dyld-support.sb rules).
  const read = ['/System', '/System/Cryptexes/App', '/System/Cryptexes/OS', '/System/Volumes/Preboot/Cryptexes/App/System', '/System/Volumes/Preboot/Cryptexes/OS', '/usr', '/bin', '/sbin', '/Library', '/etc', '/private/etc', '/private/var/db/dyld', '/private/var/db/timezone', runtime, path.dirname(path.dirname(executable))];
  return `(version 1)
(deny default)
(allow process* sysctl-read mach-lookup ipc-posix* signal)
(allow network*)
(allow file-read-metadata)
; dyld reads the root directory when starting a process. This literal grants
; access to the directory itself, without granting access to its descendants.
(allow file-read* (literal "/"))
(allow file-read* file-map-executable ${read.map(p => `(subpath ${quote(p)})`).join(' ')})
(allow file-map-executable ${[folder, data, temporary].map(p => `(subpath ${quote(p)})`).join(' ')})
(allow file-read* file-write* (subpath "/dev") ${[folder, data, temporary].map(p => `(subpath ${quote(p)})`).join(' ')})
`;
}
function descendants(rows, parent) {
  const found = [];
  const visit = id => { for (const row of rows) if (row.ppid === id) { found.push(row.pid); visit(row.pid); } };
  visit(parent);
  return found;
}
module.exports = { serverUrl, folderProfile, descendants };
