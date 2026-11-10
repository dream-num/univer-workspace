// Pure generation for the packaged Space Plugin README.
//
// The package ships exactly one README, generated from docs/installation.md.
// Nothing here touches the filesystem, so the packaging contract can be
// verified without building, packing or a running environment.
//
// The runtime only requires the inputs to be present. Document content rules
// (required sections, no development commands, absolute links) are asserted by
// test/package-readme.test.mjs, not by the packaging path.

export function buildPackageReadme({ version, instructions, licensing }) {
  if (typeof version !== 'string' || !version.trim())
    throw new Error('Package version is required.');
  if (typeof instructions !== 'string' || !instructions.trim())
    throw new Error('Missing in-package installation document.');
  if (typeof licensing !== 'string' || !licensing.trim())
    throw new Error('Package licensing note is required.');
  return [
    `# Space Plugin ${version}`,
    '',
    'Preview build for official DeepSeek Harness Desktop. This is a proof-of-concept package, not a production release.',
    '',
    licensing.trim(),
    '',
    demoteFirstHeading(instructions.trim()),
    '',
  ].join('\n');
}

// The packaged README already carries the version title. Demote the source
// document's own top-level heading so the shipped file keeps a single H1.
function demoteFirstHeading(markdown) {
  const lines = markdown.split('\n');
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index === -1) return markdown;
  lines[index] = lines[index].replace(/^#\s/, '## ');
  return lines.join('\n');
}
