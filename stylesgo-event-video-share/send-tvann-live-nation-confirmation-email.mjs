import {existsSync, readFileSync} from "node:fs";

const envCandidates = [
  process.env.SENDGRID_ENV_FILE,
  "/Users/khalifaibrahim/Flutter Projects/All StylesGo/stylesgo-website/.env.local",
  "/Users/khalifaibrahim/Flutter Projects/All StylesGo/stylesgo-website/.env.test",
  "/Users/khalifaibrahim/Flutter Projects/All StylesGo/stylesgo-client/functions/.env.development",
].filter(Boolean);

function readEnvValue(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const path of envCandidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    if (!line) continue;
    return line.slice(name.length + 1).replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const toEmail = "tvann1010@yahoo.com";
const toName = "Tvann";
const subject = "Please confirm availability for tomorrow's Live Nation event";

const text = `Hi Tvann,

You are currently registered for tomorrow’s Live Nation event, Monday, June 1, from 11:00 AM to 3:00 PM PT happening in Oakland.

Please reply to this email by 3:00 PM PT today, Sunday, May 31, to confirm whether you will be available for the event.

If we do not hear back by then, we may need to plan as if you are unavailable.

Thanks,
StylesGo Support`;

const paragraphs = [
  "You are currently registered for tomorrow’s Live Nation event, Monday, June 1, from 11:00 AM to 3:00 PM PT happening in Oakland.",
  "Please reply to this email by 3:00 PM PT today, Sunday, May 31, to confirm whether you will be available for the event.",
  "If we do not hear back by then, we may need to plan as if you are unavailable.",
];

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f7;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <div style="background: linear-gradient(135deg, #34A853 0%, #1f7a3a 100%); padding: 34px 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 26px;">StylesGo Barber</h1>
      <p style="color: #e8f7ed; margin: 10px 0 0; font-size: 16px;">Live Nation event confirmation</p>
    </div>
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0 0 18px;">Hi Tvann,</p>
      ${paragraphs.map((paragraph) =>
        `<p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0 0 18px;">${escapeHtml(paragraph)}</p>`
      ).join("")}
      <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 24px 0 0;">Thanks,<br>StylesGo Support</p>
    </div>
    <div style="background-color: #f4f4f7; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">StylesGo - Mobile Barber Services</p>
      <p style="color: #9ca3af; font-size: 12px; margin: 4px 0 0;">
        <a href="https://stylesgoapp.com" style="color: #34A853; text-decoration: none;">stylesgoapp.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

const apiKey = readEnvValue("SENDGRID_API_KEY");
if (!apiKey) {
  throw new Error("SENDGRID_API_KEY was not found in the known StylesGo env files.");
}

const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    personalizations: [
      {
        to: [{email: toEmail, name: toName}],
        custom_args: {
          campaign: "live-nation-barber-confirmation",
          event: "live-nation-2026-06-01",
          recipient_role: "support_barber",
        },
      },
    ],
    from: {email: "team@sgmobilebarber.com", name: "StylesGo Support"},
    reply_to: {email: "team@stylesgoapp.com", name: "StylesGo Support"},
    subject,
    content: [
      {type: "text/plain", value: text},
      {type: "text/html", value: html},
    ],
    categories: ["event-confirmation", "barber-operations"],
  }),
});

if (response.status !== 202) {
  const errorText = await response.text();
  throw new Error(`SendGrid returned ${response.status}: ${errorText}`);
}

console.log(JSON.stringify({
  status: response.status,
  to: toEmail,
  subject,
  message: "SendGrid accepted the email for delivery.",
}, null, 2));
