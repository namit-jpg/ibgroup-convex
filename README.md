# WhatsApp Trial (Convex)

This is the trial copy of the WhatsApp inbox. It is a separate project from the on-prem app in `../ibgroup`.

The on-prem app keeps using Slack Socket Mode and a database file on the client's server. This copy runs on Convex, so there is no office server to start. WhatsApp messages and phone numbers are stored in Convex's cloud.

## Where it lives

| | |
|---|---|
| Convex project | [whatsapp-slack-trial](https://dashboard.convex.dev/t/namit-dasappanavar/whatsapp-slack-trial/fantastic-ox-585) |
| Slack app | WhatsApp Trial (`A0C7U7T2F6H`) |
| Workspace | Warpdrive demo Sandbox, inside warpdrivegridsandbox |

The original Slack app, WhatsApp Inbox (`A0C7XCUQF5L`), is unchanged.

## Address to give Sendvise

```
https://fantastic-ox-585.convex.site/webhooks/sendvise
```

Subscribe that URL to `message.received`, `message.sent`, `opt_in`, `opt_out`, and `contact.created`.

The signing secret Sendvise shows, and the API key, still have to be saved on the Convex deployment. From this folder:

```bash
npx convex env set --prod SENDVISE_API_KEY 'sv_live_…'
npx convex env set --prod SENDVISE_WEBHOOK_SECRET 'the secret Sendvise shows'
npx convex env set --prod SLACK_AGENT_USER_IDS 'U0C7QNBPY66,U0C8W8LBSE4'
```

`SLACK_AGENT_USER_IDS` are invited to every WhatsApp channel **in addition to** the vendor→employee mapping (not instead of it). Current always-on members: Akshat (`U0C7QNBPY66`) and Namit (`U0C8W8LBSE4`).

Slack's bot token and signing secret are already set. Open **WhatsApp Trial → Home** in the IB Group workspace.

## Vendor → employee routing

Inbound WhatsApp messages invite Slack users mapped to the sender's vendor number (plus anyone in `SLACK_AGENT_USER_IDS`). Edit `data/vendor-routing.json`, then upsert (idempotent, safe to re-run):

```bash
npm run seed:routing
npm run seed:routing -- --prod
```

Unmapped or invalid sender numbers are stored in `messageLogs` with status `unmapped` and do not post to Slack (the webhook still returns 200).

## Deploy again

```bash
npm test
npx convex deploy
npm run seed:routing -- --prod
```
