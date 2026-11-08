process.once("message", (message) => {
  process.send(
    {
      ok: false,
      error: { code: message.options.fileName, message: "failed at /private/secret/input.xlsx" },
    },
    () => process.disconnect(),
  );
});
