import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  channelName,
  formatInbound,
  headerNeeds,
  isHumanChannelMessage,
  normalizePhone,
  renderTemplate,
  slackTextToPlain,
  templateVariables,
  verifySendvise,
  verifySlack,
  windowOpen,
} from "../convex/lib/bridge.js";

test("verifySendvise accepts timestamp.rawBody HMAC and rejects skew", async () => {
  const secret = "whsec_test";
  const timestamp = "1700000000";
  const raw = '{"event":"message.received"}';
  const signature =
    "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const now = 1700000000 * 1000;
  assert.equal(await verifySendvise(raw, timestamp, signature, secret, now), true);
  assert.equal(await verifySendvise(raw, timestamp, signature, secret, now + 10 * 60 * 1000), false);
  assert.equal(await verifySendvise(raw, timestamp, "sha256=deadbeef", secret, now), false);
});

test("verifySlack uses the v0 base string", async () => {
  const secret = "slack_secret";
  const timestamp = "1700000000";
  const raw = "token=x&text=hi";
  const signature =
    "v0=" + crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex");
  assert.equal(await verifySlack(raw, timestamp, signature, secret, 1700000000 * 1000), true);
  assert.equal(await verifySlack(raw + " ", timestamp, signature, secret, 1700000000 * 1000), false);
});

test("normalizePhone and channel names stay Slack-safe", () => {
  assert.equal(normalizePhone("+91 97552 26079"), "919755226079");
  assert.equal(normalizePhone("09755226079"), "919755226079");
  assert.equal(normalizePhone("9755226079"), "919755226079");
  assert.equal(normalizePhone("919755226079"), "919755226079");
  assert.equal(normalizePhone("+91 98123 45678"), "919812345678");
  assert.equal(normalizePhone("123"), "");
  assert.equal(normalizePhone("975522607"), "");
  assert.equal(channelName("Priya Sharma", "919812345678"), "wa-priya-sharma-5678");
  assert.equal(channelName("", "919800000000"), "wa-contact-0000");
});

test("template blanks render in order and detect media headers", () => {
  const template = { body: "Hi {{1}}, your order {{2}} is confirmed." };
  assert.deepEqual(templateVariables(template), ["1", "2"]);
  assert.equal(renderTemplate(template.body, { 1: "Priya", 2: "#44" }), "Hi Priya, your order #44 is confirmed.");
  assert.equal(renderTemplate(template.body, {}), "Hi ___, your order ___ is confirmed.");
  assert.deepEqual(headerNeeds({ header: { format: "IMAGE" } }), { text: false, media: true, format: "IMAGE" });
  assert.equal(headerNeeds({ header: { format: "TEXT", text: "Hello {{1}}" } }).text, true);
});

test("formatInbound keeps flow answers and location links", () => {
  const flow = formatInbound({
    type: "interactive",
    message: "Sent",
    phone: "+919812345678",
    contact: { name: "Deepu", phone: "+919812345678" },
    interactive: {
      kind: "flow_reply",
      title: "Sent",
      flow_response: { flow_token: "order-8842", name: "Deepu Sharma", preferred_slot: "evening" },
    },
  });
  assert.match(flow.body, /preferred_slot: evening/);
  assert.doesNotMatch(flow.body, /^Sent$/);

  const pin = formatInbound({
    type: "location",
    message: "Phoenix Mall",
    phone: "+919812345678",
    location: { name: "Phoenix Mall", address: "Lower Parel", maps_url: "https://maps.example/pin" },
  });
  assert.equal(pin.link, "https://maps.example/pin");
  assert.match(pin.body, /Phoenix Mall/);
});

test("channel messages ignore bots and thread replies", () => {
  assert.equal(slackTextToPlain("see <https://example.com|docs>"), "see docs (https://example.com)");
  assert.equal(
    isHumanChannelMessage({ channel: "C1", ts: "1.1", user: "U1", text: "hi" }),
    true,
  );
  assert.equal(
    isHumanChannelMessage({ channel: "C1", ts: "1.2", thread_ts: "1.1", user: "U1", text: "hi" }),
    false,
  );
  assert.equal(isHumanChannelMessage({ channel: "C1", ts: "1.1", user: "U1", bot_id: "B1" }), false);
});

test("window is open only inside 24 hours of the last inbound", () => {
  const now = 1_700_000_000;
  assert.equal(windowOpen(now - 60, now), true);
  assert.equal(windowOpen(now - 24 * 60 * 60, now), false);
  assert.equal(windowOpen(null, now), false);
});
