/** Existing integration tests must cross the same real review boundary as UI. */
export async function captureReviewToken(
  origin: string,
  cookie: string,
  worktreeId: string,
): Promise<string> {
  const response = await fetch(`${origin}/universer-api/worktrees/${worktreeId}/review`, {
    method: "POST",
    headers: { cookie },
  });
  const body = (await response.json()) as { reviewToken?: string; error?: { message: string } };
  if (!response.ok || !body.reviewToken)
    throw new Error(body.error?.message ?? "Review could not be captured");
  return body.reviewToken;
}
