// Keep a bounded, in-memory startup log. Never display enrollment credentials.
function startupDiagnostics(secrets = []) {
  let output = '';
  const clean = value => {
    let text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]');
    return text
      .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
      .replace(/((?:["']?(?:secret|token|password|authorization|ROUTER_PAIRING_CODE)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}]+)/gi, '$1[redacted]');
  };
  return {
    append(chunk) { output = (output + chunk.toString()).slice(-12000); },
    text() { return clean(output).slice(-6000).trim(); }
  };
}
function exitMessage(code, signal, detail) {
  const prefix = signal ? `Runner crashed (${signal}).` : `Runner stopped (code ${code}).`;
  if (/Pairing failed: (400|401|403|404|410)\b/.test(detail)) return prefix + ' Get a new one-time pairing code from Runners on the website.';
  if (/Pairing failed: 429\b/.test(detail)) return prefix + ' Too many pairing attempts. Try again later.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|certificate/i.test(detail)) return prefix + ' Unable to reach the website. Check the URL and network; see details below.';
  return prefix + (detail ? ' See the reason below.' : ' The process did not provide an error message.');
}
module.exports = { startupDiagnostics, exitMessage };
