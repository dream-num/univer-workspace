function errorDetails(error, depth = 0) {
  if (!error || depth > 3) return undefined;
  if (typeof error !== "object") return String(error).slice(0, 16000);
  return Object.fromEntries(
    ["name", "message", "code", "stack", "failureType", "cause"].flatMap((key) => {
      const value = error[key];
      return value === undefined
        ? []
        : [[key, key === "cause" ? errorDetails(value, depth + 1) : String(value).slice(0, 16000)]];
    }),
  );
}

export default async function* report(source) {
  for await (const { type, data } of source) {
    if (!["test:pass", "test:fail", "test:diagnostic", "test:summary"].includes(type)) continue;
    const record = {
      type,
      ...data,
      details: data.details && { ...data.details, error: errorDetails(data.details.error) },
    };
    yield `${JSON.stringify(record)}\n`;
  }
  yield `${JSON.stringify({ type: "report:complete" })}\n`;
}
