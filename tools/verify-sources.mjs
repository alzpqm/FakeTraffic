// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function verifySources(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'sources.lock.json')));
  const overlayFile = path.join(root, 'source-overrides.lock.json');
  const overlay = fs.existsSync(overlayFile) ? JSON.parse(fs.readFileSync(overlayFile)) : { files: {} };
  if (fs.existsSync(overlayFile) && (overlay.schemaVersion !== 1 || !overlay.patchSet || !overlay.description))
    throw new Error('Invalid reviewed source override manifest');
  const overrides = overlay.files || {};
  const unused = new Set(Object.keys(overrides));
  const failures = [];
  let checked = 0, modified = 0;
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
          const key = component.name + '/' + rel, override = overrides[key];
          if (override) {
            unused.delete(key);
            if (!override.reason || !/^[a-f0-9]{64}$/.test(override.sha256) ||
                override.baseSHA256 !== (component.files[rel] ?? null) || actual !== override.sha256)
              failures.push(`${key}: invalid or unreviewed source change`);
            modified++;
          } else if (component.files[rel] !== actual) failures.push(`${key}: unreviewed source change`);
          checked++;
        }
      }
    }
    visit(base);
    for (const rel of Object.keys(component.files))
      if (!seen.has(rel)) failures.push(`${component.name}/${rel}: missing source`);
  }
  for (const key of unused) failures.push(`${key}: unused or missing source override`);
  if (failures.length) throw new Error(failures.join('\n'));
  return { components: lock.components.length, files: checked,
    baseFiles: lock.components.reduce((n, c) => n + Object.keys(c.files).length, 0),
    reviewedOverrides: modified, exactImportedSources: modified === 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(verifySources(path.resolve(fileURLToPath(new URL('..', import.meta.url))))));
