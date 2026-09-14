/** Dismiss known asynchronous onboarding, then prove settings receive input. */
export async function waitForUsableAgent(page, { firstRun = true, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  let lastError;
  let setupHandled = !firstRun;
  if (firstRun) await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
  while (Date.now() < deadline) {
    // These dialogs can mount after the preceding click or a WebSocket update.
    // A one-time isVisible check can miss them and leave Settings covered.
    for (const name of ['Continue', 'Configure later']) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.isVisible()) {
        try {
          await button.click({ timeout: Math.min(1000, Math.max(1, deadline - Date.now())) });
          if (name === 'Configure later') setupHandled = true;
        } catch (error) { lastError = error; }
      }
    }
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
