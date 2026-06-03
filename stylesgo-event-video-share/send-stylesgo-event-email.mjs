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

const toEmail = process.env.EMAIL_TO || "ishaqibrahim017@gmail.com";
const toName = process.env.EMAIL_TO_NAME || "Abel";
const videoUrl = "https://stylesgo-event-video-share.vercel.app";
const subject = "StylesGo Barber App Walkthrough for Monday's Live Nation Event";

const text = `Hi Abel,

Ahead of Monday, June 1's Live Nation event, I wanted to share a quick walkthrough of how to manage the event inside the StylesGo Barber app.

Please watch this before the event:
${videoUrl}

The walkthrough covers the main flow: checking the event details, marking when you've arrived, starting the event, managing attendee statuses, marking cuts as completed or no-show, and ending the event once the queue is clean.

Also, please install or update to the latest version of the StylesGo Barber app before Monday. After installing, open the app once to make sure you're signed in and can see your event assignment.

Please respond to this email with any questions.

Thanks,
StylesGo Support`;

const bodyParagraphs = [
  "Ahead of Monday, June 1's Live Nation event, I wanted to share a quick walkthrough of how to manage the event inside the StylesGo Barber app.",
  "The walkthrough covers the main flow: checking the event details, marking when you've arrived, starting the event, managing attendee statuses, marking cuts as completed or no-show, and ending the event once the queue is clean.",
  "Also, please install or update to the latest version of the StylesGo Barber app before Monday. After installing, open the app once to make sure you're signed in and can see your event assignment.",
  "Please respond to this email with any questions.",
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
      <p style="color: #e8f7ed; margin: 10px 0 0; font-size: 16px;">Live Nation event walkthrough</p>
    </div>
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0 0 18px;">Hi Abel,</p>
      ${bodyParagraphs.slice(0, 1).map((paragraph) =>
        `<p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0 0 18px;">${escapeHtml(paragraph)}</p>`
      ).join("")}
      <div style="text-align: center; margin: 28px 0;">
        <a href="${videoUrl}" style="display: inline-block; padding: 15px 28px; background-color: #34A853; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Watch walkthrough
        </a>
      </div>
      <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 22px; word-break: break-all;">
        ${videoUrl}
      </p>
      ${bodyParagraphs.slice(1).map((paragraph) =>
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
          campaign: "live-nation-barber-walkthrough",
          recipient_role: "lead_barber",
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
    categories: ["event-walkthrough", "barber-operations"],
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
