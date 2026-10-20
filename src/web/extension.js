/*
 * src/web/extension.js — PRABHA Web Extension Entry Point (vscode.dev / github.dev)
 *
 * WHY:   The web extension host has NO Node.js APIs (no fs, child_process, os, crypto, https).
 *        This entry point registers ONLY the web-compatible features:
 *        - Turbo → Modern converter (pure JS)
 *        - Diagnostics parsing (pure JS regex)
 *        - Crash explanations (pure JS mapping)
 *        - Webview UIs (graphics panel UI, modern panel)
 *        - Keybindings, settings, menus (declarative, work via package.json)
 *        - Open Examples (bundled as static assets)
 *
 * WHAT:  Activates on C/C++ files. Registers commands: prabha.modernize, prabha.showOutput,
 *        prabha.openExample. Desktop-only commands (run, compile, debug, installCompiler,
 *        compilerInfo, stop) are NOT registered here — they have "when": "!isWeb" in
 *        package.json and show a helpful message if somehow triggered on web.
 *
 * WHERE: Built by esbuild (compile:web script) → dist/web/extension.js
 *        Declared in package.json "browser": "./dist/web/extension.js"
 */

'use strict';

const { activateWeb } = require('../../lib/web-core');

/**
 * Web extension activation — only web-compatible features.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  activateWeb(context);
}

/**
 * Web extension deactivation — cleanup.
 */
function deactivate() {
  // No child processes or terminals to clean up on web
}

module.exports = { activate, deactivate };