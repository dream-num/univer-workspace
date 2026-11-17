// Log completed work at most once every ten seconds, plus the final count.
export function reportProgress(label: string) {
  let next = Date.now() + 10_000;
  return (count: number, bytes?: number, finished = false) => {
    const now = Date.now();
    if (!finished && now < next) return;
    console.log(`${label}: ${count}${bytes === undefined ? "" : ` (${bytes} bytes)`}`);
    next = now + 10_000;
  };
}
