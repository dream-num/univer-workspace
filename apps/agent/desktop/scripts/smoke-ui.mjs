/** Dismiss known asynchronous onboarding, then prove settings receive input. */
export async function waitForUsableAgent(page, { firstRun = true, timeoutMs = 30000, onWorkspaceOnboarding } = {}) {
  const deadline = Date.now() + timeoutMs;
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const modelSetup = page.getByRole('button', { name: 'Configure later', exact: true });
  let lastError;
  let setupObserved = false;
  let setupHandled = !firstRun;

  while (Date.now() < deadline) {
    if (await page.getByRole("button", { name: "Continue", exact: true }).isVisible())
      throw new Error("Unexpected DSH internal-testing welcome notice");
    // These dialogs can mount after the preceding click or a WebSocket update.
    // A one-time isVisible check can miss them and leave Settings covered.
    for (const name of ['Sign in later', 'Configure later']) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.isVisible()) {
        if (name === 'Configure later') setupObserved = true;
        if (name === 'Sign in later') await onWorkspaceOnboarding?.();
        try {
          await button.click({ timeout: Math.min(1000, Math.max(1, deadline - Date.now())) });
        } catch (error) { lastError = error; }
      }
    }
    // A click can reach the page but time out before Playwright acknowledges it.
    // Observe the dismissed prompt instead of requiring click() to resolve.
    // On first run, an as-yet-unmounted prompt is not a completed setup.
    setupHandled = (!firstRun || setupObserved) && !await modelSetup.isVisible();
    try {
      // Actionability needs consecutive animation frames. A 250 ms attempt can
      // repeatedly expire on a throttled macOS runner before stability is checked.
      // The overall deadline and installed-app performance budgets remain unchanged.
      await settings.click({ trial: true, timeout: Math.min(2000, Math.max(1, deadline - Date.now())) });
      if (setupHandled && !await page.getByRole('button', { name: /Reconnecting/ }).isVisible()) return;
    } catch (error) { lastError = error; }
    await page.waitForTimeout(50);
  }
  throw new Error(`Agent Settings never became interactive after onboarding (model setup deferred: ${setupHandled})`, { cause: lastError });
}
