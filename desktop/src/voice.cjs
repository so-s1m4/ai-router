const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

function allowedVoiceSender(event, contents, origin) {
  if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
function createVoice({ executable, send, launch = spawn }) {
  let current;
  function stop() { current?.kill('SIGTERM'); }
  function start() {
    if (current) throw new Error('Dictation is already active.');
    const child = launch(executable, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    let buffer = '', ended = false;
    const decoder = new StringDecoder('utf8');
    const emit = value => { if (current === child) send(value); };
    const timer = setTimeout(() => child.kill('SIGKILL'), 70000);
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 262144) { child.kill('SIGKILL'); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (['ready','result','error','end'].includes(value.type)) {
            if (value.type === 'end') ended = true;
            else emit(value);
          }
        } catch {}
      }
    });
    // Drain diagnostics without exposing microphone/transcript data to logs.
    child.stderr.on('data', () => {});
    child.on('error', () => emit({type:'error',message:'Unable to start dictation. Update AI Router.'}));
    child.on('close', code => {
      clearTimeout(timer);
      if (!ended) {
        if (code !== 0) emit({type:'error',message:'Dictation stopped. Check microphone and speech recognition permissions in macOS settings.'});
      }
      emit({type:'end'});
      if (current === child) current = undefined;
    });
  }
  return { start, stop };
}
module.exports = { createVoice, allowedVoiceSender };
