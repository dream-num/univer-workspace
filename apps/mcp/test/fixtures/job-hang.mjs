process.once("message", () => {
  setInterval(() => {}, 1000);
  process.send({ ok: true, value: { ready: true } });
});
