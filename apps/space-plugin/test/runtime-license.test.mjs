import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRuntimeLicense, readRuntimeLicenseKey } from '../lib/runtime-license.js';

test('Desktop test license survives an environment-free launch and respects operator overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-license-'));
  const file = pathToFileURL(join(directory, 'runtime-license.json'));
  const previous = process.env.UNIVER_LICENSE;
  delete process.env.UNIVER_LICENSE;
  try {
    assert.equal(readRuntimeLicense(undefined, file), '');
    await writeFile(file, JSON.stringify({ scope: 'internal-desktop-test', license: 'fixture-license' }));
    assert.equal(readRuntimeLicense(undefined, file), 'fixture-license');
    assert.equal(readRuntimeLicense('operator-license', file), 'operator-license');
    assert.equal(readRuntimeLicense('', file), 'fixture-license');
    await writeFile(file, '{"private-credential":"must-never-appear-in-errors"');
    assert.throws(() => readRuntimeLicense(undefined, file), {
      message: 'Invalid packaged runtime license configuration.',
    });
  } finally {
    if (previous === undefined) delete process.env.UNIVER_LICENSE;
    else process.env.UNIVER_LICENSE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Exchange key stays in packaged Host configuration and supports its own operator override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-exchange-key-'));
  const file = pathToFileURL(join(directory, 'runtime-license.json'));
  try {
    assert.throws(() => readRuntimeLicenseKey('', file), /not configured/);
    await writeFile(file, JSON.stringify({ scope: 'internal-desktop-test', license: 'fixture-license', licenseKey: 'fixture-key' }));
    assert.equal(readRuntimeLicenseKey('', file), 'fixture-key');
    assert.equal(readRuntimeLicenseKey('operator-key', file), 'operator-key');
    assert.equal(readRuntimeLicense('', file), 'fixture-license');
    await writeFile(file, '{"licenseKey":"private-invalid');
    assert.throws(() => readRuntimeLicenseKey('', file), { message: 'Exchange license key is not configured.' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
