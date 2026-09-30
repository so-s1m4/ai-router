import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(process.env.RUNNER_DATA_DIR || '/runner-data');
const accountId = process.argv[2];

if (!accountId || !/^[a-zA-Z0-9_-]{1,80}$/.test(accountId)) {
  console.error('Usage: node import-chatgpt.js <accountId> [sessionToken/cookiesJSON]');
  process.exit(1);
}

async function readInput(): Promise<string> {
  if (process.argv[3]) {
    return process.argv[3];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter __Secure-next-auth.session-token or JSON cookies from chatgpt.com:\n', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const input = await readInput();
  if (!input) {
    console.error('Error: empty input');
    process.exit(1);
  }

  const home = path.join(root, 'accounts', accountId, 'home');
  const target = path.join(home, 'chatgpt-session.json');
  await mkdir(home, { recursive: true, mode: 0o700 });

  let sessionData: any;
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      sessionData = { cookies: parsed };
    } else if (typeof parsed === 'object' && parsed !== null) {
      sessionData = parsed;
    } else {
      sessionData = { sessionToken: String(parsed) };
    }
  } catch {
    // Treat as raw session token string
    sessionData = { sessionToken: input };
  }

  await writeFile(target + '.tmp', JSON.stringify(sessionData, null, 2), { mode: 0o600 });
  await rename(target + '.tmp', target);

  console.log(`ChatGPT session for account ${accountId} successfully saved to ${target}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
