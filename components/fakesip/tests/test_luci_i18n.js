'use strict';

const fs = require('fs');

const viewPath = process.argv[2];
const poPath = process.argv[3];

if (!viewPath || !poPath)
	throw new Error('usage: test_luci_i18n.js VIEW_PATH PO_PATH');

const source = fs.readFileSync(viewPath, 'utf8');
const po = fs.readFileSync(poPath, 'utf8');
const messages = new Set();
const translations = new Map();
const callPattern = /_\('((?:\\.|[^'])*)'\)/g;
const entryPattern = /^msgid "((?:\\.|[^"])*)"\nmsgstr "((?:\\.|[^"])*)"$/gm;
let match;

function decodeJavaScript(value) {
	return Function("'use strict'; return '" + value + "';")();
}

function decodePo(value) {
	return JSON.parse('"' + value + '"');
}

function placeholders(value) {
	return value.match(/%[a-z]/g) || [];
}

function assert(condition, message) {
	if (!condition)
		throw new Error(message);
}

while ((match = callPattern.exec(source)) !== null)
	messages.add(decodeJavaScript(match[1]));

while ((match = entryPattern.exec(po)) !== null) {
	const id = decodePo(match[1]);
	const translated = decodePo(match[2]);

	if (id)
		translations.set(id, translated);
}

assert(po.indexOf('"Language: zh_TW\\n"') >= 0,
	'Traditional Chinese PO header has the wrong language');
assert(messages.size > 0, 'no LuCI translation calls were found');

messages.forEach(function(message) {
	assert(translations.has(message), 'missing translation: ' + message);
	assert(translations.get(message).trim().length > 0,
		'empty translation: ' + message);
	assert(placeholders(message).join(',') ===
		placeholders(translations.get(message)).join(','),
		'placeholder mismatch: ' + message);
});

translations.forEach(function(translation, message) {
	assert(messages.has(message), 'stale translation: ' + message);
});

console.log('LuCI Traditional Chinese translation tests passed (' +
	messages.size + ' messages).');
