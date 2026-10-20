/*
 * lib/assert-polyfill.js — Minimal assert polyfill for web tests.
 */

'use strict';

function ok(value, message) {
  if (!value) throw new Error('Assertion failed: ' + (message || ''));
}

function strictEqual(actual, expected, message) {
  if (actual !== expected) throw new Error('Assertion failed: ' + (message || '') + ' Expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
}

function deepStrictEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Assertion failed: ' + (message || '') + ' Expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
}

function fail(message) {
  throw new Error('Assertion failed: ' + (message || ''));
}

module.exports = { ok, strictEqual, deepStrictEqual, fail };