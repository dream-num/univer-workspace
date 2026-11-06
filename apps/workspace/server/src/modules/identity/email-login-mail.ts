import type { EmailMessage } from "../../integrations/email/index.js";

export function emailLoginMessage(input: {
  readonly to: string;
  readonly code: string;
  readonly ttlMinutes: number;
}): EmailMessage {
  const { code, ttlMinutes } = input;
  return {
    to: input.to,
    subject: `Univer Workspace sign-in code: ${code}`,
    text: [
      "Univer Workspace",
      "",
      `Your sign-in code is ${code}.`,
      `It expires in ${ttlMinutes} minutes.`,
      "",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2329;">
    <div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <h1 style="margin:0 0 20px;font-size:18px;line-height:1.4;">Univer Workspace</h1>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Your sign-in code is:</p>
      <p style="margin:0 0 20px;font-size:32px;font-weight:600;letter-spacing:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${code}</p>
      <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b7280;">It expires in ${ttlMinutes} minutes. If you did not request this code, you can ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">This message was sent by Univer Workspace. Replies are not monitored.</p>
    </div>
  </body>
</html>`,
  };
}
