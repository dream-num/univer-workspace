import { createHash, timingSafeEqual } from "node:crypto";

export function createBearerCheck(token: string): (authorization: string | null) => boolean {
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  return (authorization) =>
    timingSafeEqual(
      expected,
      createHash("sha256")
        .update(authorization ?? "")
        .digest(),
    );
}
