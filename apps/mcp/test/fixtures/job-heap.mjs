process.once("message", () => {
  // Fits the default 256 MiB heap but exceeds the test's 16 MiB cap.
  const retained = Array.from({ length: 8 }, () => new Array(1_000_000).fill("heap"));
  process.send({ ok: true, value: { arrays: retained.length } }, () => process.exit(0));
});
