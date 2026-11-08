process.once("message", () => {
  const retained = [];
  while (true) retained.push(new Array(100_000).fill("heap"));
});
