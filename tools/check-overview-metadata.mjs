// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import assert from 'node:assert/strict';
export function checkOverviewMetadata(text) {
  assert.match(text, /\n  name: luci-app-faketraffic\n/);
  assert.match(text, /\n  version: 0\.1\.0-r1\n/);
  for (const dep of ['fakehttp=99.3-r1', 'fakesip=0.9.1-r23', 'luci-app-fakehttp=99.3-r1', 'luci-app-fakesip=0.9.1-r23'])
    assert.ok(text.includes('    - ' + dep + '\n'), 'Missing version constraint: ' + dep);
  assert.ok(!/^scripts:|^  (replaces|install-if|triggers):/m.test(text), 'Unexpected lifecycle or replacement metadata');
  assert.ok(!/^  - name: (etc|bin|sbin)(\/|$)/m.test(text), 'Unexpected engine/config files');
  const modes = [...text.matchAll(/\bmode: (0[0-7]+)/g)].map(m => parseInt(m[1], 8));
  assert.ok(modes.length >= 4, 'No file permissions found');
  assert.ok(modes.every(mode => mode === 0o644 || mode === 0o755), 'Unexpected or writable package permissions');
  return { metadataVerified: true, permissionsChecked: modes.length, noLifecycleScripts: true };
}
if (process.argv[1]?.endsWith('check-overview-metadata.mjs'))
  console.log(JSON.stringify(checkOverviewMetadata(fs.readFileSync(0, 'utf8'))));
