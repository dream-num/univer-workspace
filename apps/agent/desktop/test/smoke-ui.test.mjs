import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { waitForUsableAgent } from '../scripts/smoke-ui.mjs';

// Model the observed CI race: the browser receives the click and closes the
// prompt, but the automation call times out before acknowledging delivery.
function onboardingPage({ delivered = true, deferred = false } = {}) {
  let notice = true;
  let prompt = false;
  let checks = 0;
  let clicks = 0;
  let dismissed = false;
  const page = {
    getByRole(role, { name }) {
      assert.equal(role, 'button');
      return {
        async isVisible() {
          if (name === 'Continue') return notice;
          if (name === 'Configure later') {
            if (!notice && !dismissed && (!deferred || ++checks > 2)) prompt = true;
            return prompt;
          }
          if (name instanceof RegExp) return false;
          return true;
        },
        async click({ trial } = {}) {
          if (name === 'Continue') { notice = false; return; }
          if (name === 'Configure later') {
            clicks++;
            if (delivered) { prompt = false; dismissed = true; }
            throw new Error('Click acknowledgement timed out');
          }
          assert.equal(name, 'Settings');
          assert.equal(trial, true);
          if (notice || prompt) throw new Error('Onboarding intercepts pointer events');
        },
      };
    },
    waitForTimeout: ms => setTimeout(ms),
  };
  return { page, clicks: () => clicks };
}

test('accepts dismissed onboarding when click delivery succeeds but acknowledgement times out', async () => {
  const fixture = onboardingPage();
  await waitForUsableAgent(fixture.page, { timeoutMs: 500 });
  assert.equal(fixture.clicks(), 1);
});

test('does not accept an actionable Settings button before asynchronous onboarding appears', async () => {
  const fixture = onboardingPage({ deferred: true });
  await waitForUsableAgent(fixture.page, { timeoutMs: 1000 });
  assert.equal(fixture.clicks(), 1);
});

test('rejects a timed-out click when onboarding still blocks interaction', async () => {
  const fixture = onboardingPage({ delivered: false });
  await assert.rejects(waitForUsableAgent(fixture.page, { timeoutMs: 100 }),
    /Agent Settings never became interactive/);
  assert.ok(fixture.clicks() > 0);
});
