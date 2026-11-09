import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = lock.packages;
assert.equal(packages['node_modules/next'].version, '16.4.5', 'Next must resolve to reviewed patch');
assert.equal(packages['node_modules/sharp'].version, '0.35.5', 'Image runtime must resolve to reviewed patch');
for (const [name, value] of Object.entries(packages)) {
  if (name.endsWith('/sharp')) assert.ok(value.version === '0.35.5', 'sharp must resolve to reviewed patch');
}
assert.equal(packages['node_modules/react'].version, '19.3.1');
assert.equal(packages['node_modules/react-dom'].version, '19.3.1');
console.log('Reviewed runtime dependency versions verified');
