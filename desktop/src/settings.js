const $ = id => document.getElementById(id);
let folder = '';
function modes() { $('folder-section').hidden = $('mode').value !== 'folder'; $('full-section').hidden = $('mode').value !== 'full'; }
function update(state) {
  $('status').textContent = state.status;
  $('runner-error').textContent = state.runnerError || '';
  $('runner-error-section').hidden = !state.runnerError;
}
async function action(fn) {
  $('error').textContent = '';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { return await fn(); } catch (error) { $('error').textContent = error.message; }
  finally { for (const button of document.querySelectorAll('button')) button.disabled = false; }
}
window.desktop.state().then(state => {
  $('server').value = state.server || ''; $('mode').value = state.mode || 'off';
  folder = state.folder || ''; $('folder').textContent = folder || 'Папка не выбрана'; modes(); update(state);
});
window.desktop.onState(update);
$('mode').onchange = modes;
$('choose').onclick = () => action(async () => { const selected = await window.desktop.chooseFolder(); if (selected) { folder = selected; $('folder').textContent = selected; } });
$('setup').onsubmit = event => { event.preventDefault(); action(() => window.desktop.save({server:$('server').value, mode:$('mode').value, folder})); };
$('site').onclick = () => action(() => window.desktop.openSite());
$('start').onclick = () => action(async () => { await window.desktop.start($('code').value.trim()); $('code').value = ''; });
$('stop').onclick = () => action(async () => { await window.desktop.stop(); $('mode').value = 'off'; modes(); });
$('disk').onclick = () => action(() => window.desktop.diskSettings());
