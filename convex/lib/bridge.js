export const WINDOW_SECONDS = 24 * 60 * 60;
const SKEW_SECONDS = 5 * 60;

export function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withinSkew(timestamp, nowMs) {
  const n = Number(timestamp);
  if (!Number.isFinite(n)) return false;
  const seconds = n > 1e12 ? Math.floor(n / 1000) : n;
  return Math.abs(nowMs / 1000 - seconds) <= SKEW_SECONDS;
}

export async function verifySendvise(rawBody, timestamp, signature, secret, nowMs = Date.now()) {
  if (!timestamp || !signature || !secret || rawBody == null) return false;
  if (!withinSkew(timestamp, nowMs)) return false;
  const digest = await hmacHex(secret, `${timestamp}.${rawBody}`);
  const expected = `sha256=${digest}`;
  const actual = String(signature).toLowerCase().startsWith("sha256=")
    ? String(signature)
    : `sha256=${signature}`;
  return safeEqual(expected, actual);
}

export async function verifySlack(rawBody, timestamp, signature, secret, nowMs = Date.now()) {
  if (!timestamp || !signature || !secret || rawBody == null) return false;
  if (!withinSkew(timestamp, nowMs)) return false;
  const digest = await hmacHex(secret, `v0:${timestamp}:${rawBody}`);
  return safeEqual(`v0=${digest}`, signature);
}

export function normalizePhone(raw) {
  if (raw == null) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `…${digits.slice(-4)}`;
}

export function phoneFrom(data) {
  if (!data || typeof data !== "object") return "";
  return normalizePhone(data.contact?.phone || data.phone || data.to || data.from || "");
}

export function wamidFrom(data) {
  if (!data || typeof data !== "object") return "";
  return data.wamid || data.message_id || "";
}

export function eventTimeSeconds(value, fallbackMs = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return eventTimeSeconds(Number(value), fallbackMs);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(fallbackMs / 1000);
}

export function windowOpen(lastInboundAt, nowSec = Math.floor(Date.now() / 1000)) {
  if (!lastInboundAt) return false;
  return nowSec - Number(lastInboundAt) < WINDOW_SECONDS;
}

export function isWindowClosedError(err) {
  const blob = `${err?.message || ""} ${JSON.stringify(err?.body || {})}`;
  return blob.includes("131047");
}

export function windowClosedText(phone) {
  return `The 24-hour WhatsApp window is closed for +${phone}. Send another template from the WhatsApp Home tab.`;
}

export function channelName(name, phone) {
  const slug = String(name || "contact")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "contact";
  return `wa-${slug}-${String(phone).slice(-4)}`.slice(0, 80);
}

export function templateVariables(template) {
  const keys = [];
  const seen = new Set();
  for (const match of String(template?.body || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      keys.push(match[1]);
    }
  }
  keys.sort((a, b) => Number(a) - Number(b));
  return keys.slice(0, 10);
}

export function headerNeeds(template) {
  let header = template?.header;
  if (typeof header === "string") {
    try {
      header = JSON.parse(header);
    } catch {
      header = null;
    }
  }
  if (!header || typeof header !== "object") return { text: false, media: false, format: null };
  const format = String(header.format || "").toUpperCase();
  if (format === "TEXT") {
    return { text: /\{\{\s*\d+\s*\}\}/.test(header.text || ""), media: false, format };
  }
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) return { text: false, media: true, format };
  return { text: false, media: false, format: format || null };
}

export function renderTemplate(body, values = {}) {
  return String(body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, key) => {
    const value = values[key];
    return value && String(value).trim() ? String(value).trim() : "___";
  });
}

export function escapeMrkdwn(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(value, max = 2500) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stringifyAnswer(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function formatInbound(data) {
  const phone = phoneFrom(data);
  const name = data?.contact?.name || "WhatsApp contact";
  const type = data?.type || "text";
  let body = data?.message || "";
  let link = "";

  if (type === "location" && data?.location) {
    const loc = data.location;
    body = [loc.name, loc.address].filter(Boolean).join(", ") || body || "Location";
    link = loc.maps_url || "";
  }

  const interactive = data?.interactive;
  if (interactive?.kind === "flow_reply" && interactive.flow_response) {
    body = Object.entries(interactive.flow_response)
      .map(([key, value]) => `${key}: ${stringifyAnswer(value)}`)
      .join("\n");
  } else if (interactive) {
    const title = interactive.title || body;
    const id = interactive.id ? ` (${interactive.id})` : "";
    body = `${title}${id}`;
    if (interactive.description) body += `\n${interactive.description}`;
  }

  const media = data?.media_url || data?.media?.url || (type !== "text" && type !== "location" ? data?.url : "");
  if (media) link = link || media;
  if (!body) body = `(${type})`;
  if (data?.filename) body = `${data.filename}\n${body}`;

  return { name, phone, type, body, link };
}

export function renderInbound(view, { hint } = {}) {
  let mrkdwn = `*${escapeMrkdwn(view.name)}*  \`+${view.phone}\`\n${escapeMrkdwn(view.body)}`;
  if (view.link) mrkdwn += `\n<${view.link}>`;
  if (hint) mrkdwn += `\n_${escapeMrkdwn(hint)}_`;
  return {
    text: clip(`${view.name} (+${view.phone}): ${view.body}`),
    blocks: [{ type: "section", text: { type: "mrkdwn", text: clip(mrkdwn) } }],
  };
}

export function slackTextToPlain(text) {
  return String(text || "")
    .replace(/<mailto:([^|>]+)\|[^>]*>/g, "$1")
    .replace(/<mailto:([^>]+)>/g, "$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<@[A-Z0-9]+>/g, "@teammate")
    .replace(/<!channel>/g, "@channel")
    .replace(/<!here>/g, "@here")
    .replace(/<!everyone>/g, "@everyone")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function errorText(data) {
  return (
    data?.error_message ||
    data?.error_reason ||
    data?.reason ||
    (typeof data?.error === "string" ? data.error : "") ||
    "WhatsApp delivery failed"
  );
}

export function isHumanChannelMessage(message) {
  if (!message || message.bot_id || message.bot_profile) return false;
  if (message.subtype && message.subtype !== "file_share") return false;
  if (!message.user || !message.channel) return false;
  if (message.thread_ts && message.thread_ts !== message.ts) return false;
  return true;
}
