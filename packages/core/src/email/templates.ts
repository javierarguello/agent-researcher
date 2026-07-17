/**
 * Minimal, self-contained HTML for account emails. Inline styles only (email
 * clients strip <style>). Branded with the app name; the accent is generic so any
 * app looks reasonable without per-app theming.
 */
interface AccountEmail {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = '#e65100';
const INK = '#2a2824';
const MUTED = '#6b6860';

function shell(appName: string, heading: string, body: string, cta: { label: string; url: string }, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f0e8;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5dfd4;border-radius:10px;overflow:hidden;">
      <tr><td style="height:6px;background:${ACCENT};"></td></tr>
      <tr><td style="padding:32px 36px 8px;">
        <div style="font-weight:800;font-size:17px;letter-spacing:-0.02em;color:${INK};">${appName}</div>
      </td></tr>
      <tr><td style="padding:8px 36px 0;">
        <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${INK};margin:12px 0 14px;">${heading}</h1>
        <p style="font-size:15px;line-height:1.6;color:${INK};margin:0 0 22px;">${body}</p>
        <a href="${cta.url}" style="display:inline-block;background:${INK};color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.04em;padding:13px 22px;border-radius:6px;">${cta.label}</a>
        <p style="font-size:12.5px;line-height:1.6;color:${MUTED};margin:24px 0 0;">Or paste this link into your browser:<br><a href="${cta.url}" style="color:${ACCENT};word-break:break-all;">${cta.url}</a></p>
      </td></tr>
      <tr><td style="padding:24px 36px 30px;">
        <p style="font-size:11.5px;line-height:1.55;color:${MUTED};margin:16px 0 0;border-top:1px solid #ece7dc;padding-top:16px;">${footer}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function verifyEmailTemplate(appName: string, url: string): AccountEmail {
  return {
    subject: `Verify your email for ${appName}`,
    html: shell(
      appName,
      'Confirm your email',
      `Welcome to ${appName}. Confirm this email address to activate your account and sign in.`,
      { label: 'Verify email', url },
      `If you didn't create a ${appName} account, you can safely ignore this email. This link expires in 24 hours.`,
    ),
    text: `Confirm your email for ${appName}\n\nVerify this address to activate your account: ${url}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
  };
}

export function reportReadyTemplate(appName: string, reportTitle: string, url: string): AccountEmail {
  const title = reportTitle?.trim() || 'Your research summary';
  return {
    subject: `Your ${appName} report is ready — ${title}`,
    html: shell(
      appName,
      'Your report is ready',
      `Your research summary <strong>${title.replace(/[<>&]/g, '')}</strong> has finished generating and is ready to view.`,
      { label: 'View report', url },
      `AI-generated research for informational purposes. Always refer to the original listings and verify figures independently before acting.`,
    ),
    text: `Your ${appName} report is ready\n\n${title} has finished generating. View it: ${url}\n\nAI-generated research — verify independently before acting.`,
  };
}

export function resetPasswordTemplate(appName: string, url: string): AccountEmail {
  return {
    subject: `Reset your ${appName} password`,
    html: shell(
      appName,
      'Reset your password',
      `We received a request to reset the password for your ${appName} account. Choose a new password to continue.`,
      { label: 'Reset password', url },
      `If you didn't request this, you can safely ignore this email — your password won't change. This link expires in 1 hour.`,
    ),
    text: `Reset your ${appName} password\n\nChoose a new password: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  };
}
