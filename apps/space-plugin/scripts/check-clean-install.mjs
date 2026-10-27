/** Official manager, empty profile, no inherited build approvals. */
import assert from 'node:assert/strict';
import { writeEvidence } from './evidence-output.mjs';
import { connectHost } from './host-connection.mjs';
const host = await connectHost();
const spec = process.env.SPACE_PLUGIN_TARBALL;
if (!spec) throw new Error('SPACE_PLUGIN_TARBALL is required.');
const first = await host.request('pluginManager/installBundle', { args: { spec, options: { enabled: true } } });
assert.equal(first.packageResult?.kind, 'build-blocked');
assert.deepEqual(first.pendingBuilds, ['protobufjs@7.6.6']);
// The exact published script was inspected; do not approve other packages or
// broad/all build policies. This is the official manager approval/retry API.
const second = await host.request('pluginManager/installBundle', { args: { spec, options: { enabled: true, approvedBuilds: ['protobufjs@7.6.6'] } } });
assert.equal(second.packageResult?.exitCode, 0);
assert.ok(['applied', 'restart-required'].includes(second.application));
const summary = { carrier: 'official packaged DSH Host; fresh profile; no Desktop-window claim', first: { application: first.application, kind: first.packageResult.kind, pendingBuilds: first.pendingBuilds }, second: { application: second.application, exitCode: second.packageResult.exitCode, approvedBuilds: second.approvedBuilds, bundle: second.bundle, version: second.version }, note: 'Production first install requires an explicit exact dependency build approval. Peer warnings are not the failure cause.' };
await writeEvidence('clean-manager-install.json', summary);
console.log('PASS clean official-manager build approval and installation', summary);
