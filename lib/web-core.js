/*
 * lib/web-core.js — Shared web-compatible core for PRABHA.
 *
 * WHY:   The web extension (vscode.dev) cannot use Node.js APIs (fs, child_process, etc.).
 *        This file contains ONLY the pure JavaScript / VS Code API code that works on both
 *        desktop and web. Desktop extension.js imports this and adds Node-only features.
 * WHAT:  Exports: activateWeb(context) — registers web-compatible commands only.
 * WHERE: Used by src/web/extension.js (web entry) and extension.js (desktop entry).
 */

'use strict';

const vscode = require('vscode');
const path = require('./path-polyfill');
const engine = require('./modern/engine');
const { explain } = require('./modern/explain');
const { parseDiagnostics, tipFor } = require('./diagnostics');
const { explainExit, exitLine } = require('./crash');
const { createRouter, MARK } = require('./stream');

const VERSION = '6.0.1';
const SRC_EXT = ['.c', '.cpp', '.cc', '.cxx'];

let out, status, diag;
const modern = { panel: null, uri: null, lang: 'en', review: [] };

/* ───────────────────────────── activateWeb ───────────────────────────── */

/**
 * Web-compatible activation — registers ONLY commands that work on vscode.dev.
 * Desktop-only commands (compile, run, debug, install compiler) are NOT registered here.
 * They are registered in extension.js (desktop entry) with "when": "!isWeb" in package.json.
 */
function activateWeb(context) {
  out = vscode.window.createOutputChannel('PRABHA');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  status.command = 'prabha.showOutput';
  diag = vscode.languages.createDiagnosticCollection('prabha');

  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(out, status, diag,
    cmd('prabha.modernize', target => openModern(context, target, onModernMessageWeb)),
    cmd('prabha.showOutput', () => out.show(true)),
    cmd('prabha.openExample', () => openExampleWeb(context)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('prabha')) {} }), // no-op on web
    vscode.workspace.onDidCloseTextDocument(d => diag.delete(d.uri)),
    vscode.workspace.onDidChangeTextDocument(e => { if (modern.panel && modern.uri && e.document.uri.toString() === modern.uri.toString()) renderModernSoon(); })
  );

  // Show status bar
  status.text = '$(sparkle) PRABHA Teacher Edition';
  status.show();
}

/** Web-specific handlers for 'check' and 'run' (show helpful message) */
async function onModernMessageWeb(m) {
  const doc = await modernDoc();
  if (!doc) return;
  switch (m.t) {
    case 'check': {
      // On web, we cannot compile/run. Show a message instead.
      if (modern.panel) modern.panel.webview.postMessage({ t: 'check', ok: false, text: 'Compile and run need VS Code Desktop (real C compiler). The Turbo→Modern converter and error explanations work here.' });
      break;
    }
    case 'run': {
      // On web, cannot run. Show message.
      vscode.window.showInformationMessage('Compile and run need VS Code Desktop (real C compiler). The Turbo→Modern converter and error explanations work here.');
      break;
    }
  }
}

/* ───────────────────────── Web-compatible commands ───────────────────────── */

/** Turbo → Modern panel (pure JS, webview) */
async function openModern(context, target, extraHandler) {
  const editor = vscode.window.activeTextEditor;
  const uri = target && target.fsPath ? target : editor && editor.document.uri;
  if (!uri) { vscode.window.showInformationMessage('PRABHA: open a Turbo C/C++ file, then run "Turbo → Modern".'); return; }
  modern.uri = uri;
  if (!modern.panel) {
    modern.panel = vscode.window.createWebviewPanel('prabhaModern', 'PRABHA · Turbo → Modern', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true,
      // WHY: on vscode.dev context.extensionPath is not a real disk path, so Uri.file() pointed at
      //      file:///static/... and the panel's CSS/JS failed to load (blank panel).
      // WHAT: joinPath on extensionUri works on both desktop (file:) and web (https:).
      // WHERE: webview may only load files under this root -> modernShell() media links below.
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });
    modern.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png'); // same web-safe URI as above
    modern.panel.webview.html = modernShell(modern.panel.webview, context);
    modern.panel.onDidDispose(() => { modern.panel = null; modern.uri = null; });
    modern.panel.webview.onDidReceiveMessage(async m => {
      await onModernMessage(m);
      if (extraHandler) await extraHandler(m);
    });
  } else {
    modern.panel.reveal(vscode.ViewColumn.Beside, true);
  }
  modern.panel.title = 'Modern · ' + path.basename(uri.fsPath || uri.path);
  renderModern();
  return modern.panel;
}

async function modernDoc() { return modern.uri ? vscode.workspace.openTextDocument(modern.uri) : null; }

function modernResult(doc) {
  try { return engine.modernize(doc.getText(), { fileName: doc.fileName, enabled: enabledRules(), ui: modern.lang }); } catch (e) { out.appendLine('[modern] ' + e.message); return null; }
}

async function renderModern() {
  if (!modern.panel) return;
  const doc = await modernDoc();
  if (!doc) return;
  const res = modernResult(doc);
  if (!res) return;
  const text = doc.getText();
  modern.panel.webview.postMessage({
    t: 'render',
    file: path.basename(doc.fileName),
    diff: engine.diffLines(text, res.code),
    changes: res.changes, available: res.available, warnings: res.warnings,
    minJava: res.minJava, lang: modern.lang,
    reviewRules: engine.RULES.filter(r => r.safety === 'review' && r.lang.includes(res.lang)).map(r => ({ id: r.id, on: modern.review.includes(r.id), title: explain(r.id, modern.lang).title }))
  });
}
let modernTimer;
function renderModernSoon() { clearTimeout(modernTimer); modernTimer = setTimeout(renderModern, 400); }

async function onModernMessage(m) {
  const doc = await modernDoc();
  if (!doc) return;
  switch (m.t) {
    case 'ready': renderModern(); break;
    case 'lang': modern.lang = m.lang === 'hi' ? 'hi' : 'en'; renderModern(); break;
    case 'toggleReview':
      modern.review = m.on ? [...new Set([...modern.review, m.id])] : modern.review.filter(x => x !== m.id);
      renderModern(); break;
    case 'apply': {
      const res = modernResult(doc);
      if (!res || res.code === doc.getText()) return;
      const pick = await vscode.window.showWarningMessage('PRABHA: apply ' + res.changes.length + ' change(s) to the file? (Ctrl+Z undoes it)', 'Apply', 'Open in new tab');
      if (pick === 'Open in new tab') return openModernNewTab(doc, res);
      if (pick !== 'Apply') return;
      const we = new vscode.WorkspaceEdit();
      we.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), res.code);
      await vscode.workspace.applyEdit(we);
      renderModern();
      break;
    }
    case 'newFile': { const res = modernResult(doc); if (res) await openModernNewTab(doc, res); break; }
    case 'copy': {
      const res = modernResult(doc);
      if (res) { await vscode.env.clipboard.writeText(res.code); vscode.window.setStatusBarMessage('PRABHA: modern code copied', 3000); }
      break;
    }
    // 'check' and 'run' are platform-specific (need compiler on desktop, not available on web)
    // Handlers for these are added by each platform's entry point via openModern(extraHandler)
  }
}

async function openModernNewTab(doc, res) {
  const nd = await vscode.workspace.openTextDocument({ language: res.lang === 'c' ? 'c' : 'cpp', content: res.code });
  await vscode.window.showTextDocument(nd, vscode.ViewColumn.One);
}

function enabledRules() { return [...engine.defaultEnabled(), ...modern.review]; }

function modernShell(webview, context) {
  // WHY/WHAT: web-safe media URI (see localResourceRoots note); WHERE: <link>/<script> tags of the panel HTML
  const media = p => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', p));
  const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('modern-panel.css')}">
<title>PRABHA · Turbo → Modern</title></head>
<body><div id="app"><p class="muted">Loading…</p></div>
<script nonce="${nonce}" src="${media('modern-panel.js')}"></script></body></html>`;
}

/** Open Example — web version uses bundled examples list (no fs.readdirSync) */
async function openExampleWeb(context) {
  // Examples are bundled as static assets in the web extension
  const examples = [
    '01_shapes.c',
    '02_bouncing_ball.c',
    '03_moving_car.c',
    '04_sine_wave.c',
    '05_keyboard_game.c',
    '06_conio_menu.c',
    '07_turbo_cpp_classic.cpp'
  ];
  const pick = await vscode.window.showQuickPick(examples, { placeHolder: 'Open a PRABHA example (bundled)' });
  if (!pick) return;
  // Read example content from the extension's media/examples folder (bundled)
  const exampleUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'examples', pick);
  try {
    const content = await vscode.workspace.fs.readFile(exampleUri);
    const doc = await vscode.workspace.openTextDocument({ language: pick.endsWith('.cpp') ? 'cpp' : 'c', content: content.toString() });
    await vscode.window.showTextDocument(doc);
  } catch (e) {
    vscode.window.showErrorMessage('PRABHA: could not load example ' + pick + ' — ' + e.message);
  }
}

/* ───────────────────────── Diagnostics helper (web-compatible) ───────────────────────── */

/**
 * Parse compiler output into diagnostics — works on web if compiler output is provided
 * (e.g., from a server-side compilation or pasted by user).
 */
function showDiagnosticsWeb(text, mainFileUri) {
  const list = parseDiagnostics(text, { mainFile: mainFileUri ? mainFileUri.fsPath : null });
  diag.delete(mainFileUri);
  const byFile = new Map();
  let errors = 0, warnings = 0;
  for (const d of list) {
    if (d.severity === 'error') errors++; else if (d.severity === 'warning') warnings++;
    if (!d.file) continue;
    const key = vscode.Uri.file(d.file).toString();
    if (!byFile.has(key)) byFile.set(key, { uri: vscode.Uri.file(d.file), items: [] });
    const line = Math.max(0, d.line - 1), col = Math.max(0, d.col - 1);
    const dg = new vscode.Diagnostic(new vscode.Range(line, col, line, col + 1),
      d.message + (d.tip ? '\n💡 ' + d.tip : '') + (d.notes && d.notes.length ? '\n   ' + d.notes.slice(0, 2).join('\n   ') : ''),
      d.severity === 'error' ? vscode.DiagnosticSeverity.Error : d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
    dg.source = 'PRABHA';
    byFile.get(key).items.push(dg);
  }
  for (const { uri, items } of byFile.values()) diag.set(uri, items);
  return { errors, warnings };
}

/* ───────────────────────── Crash explanation (web-compatible) ───────────────────────── */

/**
 * Explain a crash exit code/signal — works on web for pasted exit codes.
 */
function explainCrashWeb(code, signal, platform) {
  return explainExit({ code, signal, platform: platform || 'linux' });
}

/* ───────────────────────── Exports ───────────────────────── */

module.exports = {
  activateWeb,
  VERSION,
  SRC_EXT,
  modernState: modern,  // shared modern panel state
  // Web-compatible utilities
  showDiagnosticsWeb,
  explainCrashWeb,
  parseDiagnostics,
  tipFor,
  explainExit,
  exitLine,
  createRouter,
  MARK,
  engine,
  modern: { openModern, renderModern, onModernMessage, renderModernSoon, modernDoc, modernResult }
};