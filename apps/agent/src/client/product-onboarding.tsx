import { useEffect } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { SettingsOnboardingOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";

function ProductWelcome({ complete }: SettingsOnboardingOwnerProps) {
  useEffect(() => complete(), [complete]);
  return null;
}

export const inject = ["slots"];
export function apply(ctx: Context): void {
  // The published DSH models plugin owns an internal-testing notice. Replace
  // only that list occupant; Workspace and model setup retain their lifecycle.
  ctx.slots.inject("settings.onboarding", () => ctx.slots.register({
    name: "settings.onboarding", id: "welcome-notice", priority: -1, order: -100,
  }, ProductWelcome));
}
