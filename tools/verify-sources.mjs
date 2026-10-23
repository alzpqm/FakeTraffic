// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function verifySources(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'sources.lock.json')));
  const failures = [];
  let checked = 0;
  for (const component of lock.components) {
    const base = path.join(root, 'components', component.name);
    const seen = new Set();
    function visit(dir, relative = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = relative ? relative + '/' + entry.name : entry.name;
        if (rel === 'build' || entry.name === '__pycache__') continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(absolute, rel);
        else {
          seen.add(rel);
          if (!entry.isFile()) { failures.push(`${component.name}/${rel}: not a regular file`); continue; }
          const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
          if (component.files[rel] !== actual) failures.push(`${component.name}/${rel}: unreviewed source change`);
          checked++;
        }
      }
    }
    visit(base);
    for (const rel of Object.keys(component.files))
      if (!seen.has(rel)) failures.push(`${component.name}/${rel}: missing source`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return { components: lock.components.length, files: checked, exactImportedSources: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(verifySources(path.resolve(fileURLToPath(new URL('..', import.meta.url))))));
