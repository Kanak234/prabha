const path = require('path');
const fs = require('fs');
const os = require('os');
const mock = require('./vscode-mock');

const root = path.join(__dirname, '..');
const vscode = mock.install({ config: { 'prabha.toolchain': 'auto' } });
const ext = require(path.join(root, 'extension.js'));
ext.activate(mock.context(root));

async function test() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prabha-test-'));
  const src = path.join(tmp, 'marks.cpp');
  fs.copyFileSync(path.join(__dirname, 'modern', 'marks.cpp'), src);
  fs.copyFileSync(path.join(__dirname, 'modern', 'marks.stdin'), path.join(tmp, 'marks.stdin'));

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(src));
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('prabha.modernize', doc.uri);

  const mp = vscode._panels.find(p => p.viewType === 'prabhaModern');
  console.log('Panel:', !!mp);

  await mp.send({ t: 'ready' });
  await new Promise(r => setTimeout(r, 500));

  console.log('Posted messages:', mp.posted.map(m => m.t));

  await mp.send({ t: 'check' });
  console.log('Sent check, waiting...');

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await wait(50); } return false; };

  const found = await until(() => mp.posted.some(m => m.t === 'check'), 60000);
  console.log('Found check:', found);
  const chk = mp.posted.find(m => m.t === 'check');
  console.log('Check result:', JSON.stringify(chk, null, 2));

  fs.rmSync(tmp, { recursive: true, force: true });
}

test().catch(e => console.error(e));