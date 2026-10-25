// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
const text = fs.readFileSync(0, 'utf8');
const core = /\n  name: faketraffic\n/.test(text);
const ebpf = /\n  name: faketraffic-ebpf\n/.test(text);
assert.ok(core || ebpf || /\n  name: luci-app-faketraffic\n/.test(text));
assert.ok(text.includes('\n  version: 0.4.0-r3\n'));
assert.ok(!/^  (replaces|install-if|triggers):/m.test(text));
assert.ok(!/post-install|post-upgrade/.test(text), 'Installation must not start or stop services');
const modes = [...text.matchAll(/\bmode: (0[0-7]+)/g)].map(m => parseInt(m[1], 8));
assert.ok(modes.length > 5);
assert.ok(modes.every(m => [0o600, 0o644, 0o755].includes(m)));
assert.ok(!/user: (?!root\b)|group: (?!root\b)/.test(text));
if (core) {
  assert.match(text, /name: usr\/libexec\/faketraffic\n/);
  assert.match(text, /pre-deinstall/);
  assert.ok(!/name: usr\/bin\n/.test(text), 'Do not take legacy binary paths');
} else if (ebpf) {
  assert.match(text, /    - faketraffic=0\.4\.0-r3\n/);
  assert.match(text, /license: GPL-2\.0-only/);
  assert.match(text, /name: usr\/libexec\/faketraffic\n/);
  assert.match(text, /name: usr\/lib\/faketraffic\n/);
  assert.match(text, /pre-deinstall/);
  assert.ok(!/name: etc\/init.d/.test(text));
} else {
  assert.match(text, /    - faketraffic=0\.4\.0-r3\n/);
  assert.ok(!/    - (?:fakehttp|fakesip|luci-app-fakehttp|luci-app-fakesip)[=\s]/m.test(text));
  assert.ok(!/^scripts:/m.test(text));
}
console.log(JSON.stringify({ package: core ? 'faketraffic' : ebpf ? 'faketraffic-ebpf' : 'luci-app-faketraffic', entries: modes.length, metadataVerified: true }));
