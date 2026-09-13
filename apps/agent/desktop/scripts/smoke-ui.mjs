/** Require usable first-run settings without configuring a model or account. */
export async function waitForUsableAgent(page, { firstRun = true } = {}) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 20);
  await page.getByRole('button', { name: /Reconnecting/ }).waitFor({ state: 'hidden', timeout: 30000 });
  const notice = page.getByRole('button', { name: 'Continue', exact: true });
  // Wait for asynchronously mounted onboarding, then defer model setup in
  // isolated test data. No API key or remote model request is needed.
  if (firstRun || await notice.isVisible()) {
    await notice.click({ timeout: 30000 });
    await page.getByRole('button', { name: 'Configure later', exact: true }).click({ timeout: 30000 });
  }
  // A visible enabled button behind an overlay does not prove interactivity.
  // Trial click checks visibility, stability and event reception without editing.
  // The composer can remain disabled until a model is configured. Settings
  // must already accept input so a fresh installation can be configured.
  await page.getByRole('button', { name: 'Settings', exact: true })
    .click({ trial: true, timeout: 30000 });
}
