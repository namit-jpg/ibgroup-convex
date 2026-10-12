import { httpAction } from "./_generated/server";
import { verifySendvise } from "./lib/bridge.js";
import { loadConfig } from "./lib/config.js";
import { handleSendvise } from "./lib/inbox.js";
import { makeDeps } from "./runtime.js";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const sendviseWebhook = httpAction(async (ctx, request) => {
  const config = loadConfig();
  const raw = await request.text();
  const timestamp = request.headers.get("x-sendvise-timestamp");
  const signature = request.headers.get("x-sendvise-signature");
  const secrets = [config.sendviseWebhookSecret, config.sendviseOutboundWebhookSecret].filter(Boolean);
  let trusted = false;
  for (const secret of secrets) {
    if (await verifySendvise(raw, timestamp, signature, secret)) {
      trusted = true;
      break;
    }
  }
  if (!trusted) {
    const why = !timestamp || !signature ? "missing signature" : "signature did not match";
    console.error(`[bridge] sendvise webhook rejected: ${why}`);
    return json({ ok: false }, 401);
  }
  const deliveryId = request.headers.get("x-sendvise-delivery-id") || "";
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return json({ ok: false }, 400);
  }
  try {
    await handleSendvise(payload, deliveryId, makeDeps(ctx));
    return json({ ok: true }, 200);
  } catch (err) {
    console.error(`[bridge] webhook failed: ${err.message}`);
    return json({ ok: false }, 500);
  }
});
