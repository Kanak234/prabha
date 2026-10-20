/*
 * lib/path-polyfill.js — Minimal path polyfill for web extension.
 *
 * WHY:   Node's `path` module is not available in VS Code Web (vscode.dev).
 *        This provides the minimal subset used by web-core.js.
 * WHAT:  Exports: join, basename, extname, dirname, resolve, isAbsolute
 * WHERE: Used by lib/web-core.js (web entry) — desktop uses Node's path.
 */

'use strict';

function normalizePath(path) {
  const isAbsolute = path.startsWith('/');
  const parts = path.split('/').filter(p => p !== '' && p !== '.');
  const result = [];
  for (const part of parts) {
    if (part === '..') {
      if (result.length > 0) result.pop();
      else if (!isAbsolute) result.push('..');
    } else {
      result.push(part);
    }
  }
  return (isAbsolute ? '/' : '') + result.join('/');
}

function join(...paths) {
  return normalizePath(paths.join('/'));
}

function basename(path, ext) {
  const name = path.split('/').pop() || '';
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length);
  return name;
}

function extname(path) {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

function dirname(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || (path.startsWith('/') ? '/' : '.');
}

function resolve(...paths) {
  let resolved = '';
  for (const p of paths) {
    if (p.startsWith('/')) {
      resolved = p;
    } else {
      resolved = join(resolved, p);
    }
  }
  return normalizePath(resolved) || '/';
}

function isAbsolute(path) {
  return path.startsWith('/');
}

module.exports = { join, basename, extname, dirname, resolve, isAbsolute, normalize: normalizePath };