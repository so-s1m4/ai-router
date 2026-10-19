// Keep a bounded, in-memory startup log. Never display enrollment credentials.
function startupDiagnostics(secrets = []) {
  let output = '';
  const clean = value => {
    let text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[скрыто]');
    return text
      .replace(/(Bearer\s+)\S+/gi, '$1[скрыто]')
      .replace(/((?:["']?(?:secret|token|password|authorization|ROUTER_PAIRING_CODE)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}]+)/gi, '$1[скрыто]');
  };
  return {
    append(chunk) { output = (output + chunk.toString()).slice(-12000); },
    text() { return clean(output).slice(-6000).trim(); }
  };
}
function exitMessage(code, signal, detail) {
  const prefix = signal ? `Исполнитель аварийно завершён (${signal}).` : `Исполнитель остановлен (код ${code}).`;
  if (/Pairing failed: (400|401|403|404|410)\b/.test(detail)) return prefix + ' Получите новый одноразовый код на сайте в разделе «Исполнители».';
  if (/Pairing failed: 429\b/.test(detail)) return prefix + ' Слишком много попыток подключения. Повторите позже.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|certificate/i.test(detail)) return prefix + ' Не удалось связаться с сайтом. Проверьте адрес и сеть; подробности ниже.';
  return prefix + (detail ? ' Причина указана ниже.' : ' Процесс не передал текст ошибки.');
}
module.exports = { startupDiagnostics, exitMessage };
