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
npx convex env set --prod SLACK_AGENT_USER_IDS 'U0C7QNBPY66,<your-slack-user-id>'
```

Everyone listed in `SLACK_AGENT_USER_IDS` is invited to every WhatsApp channel the app opens (Akshat is `U0C7QNBPY66`). Open the WhatsApp Trial Home tab once, then check Convex logs for `app_home_opened user=…` to find your own member ID and add it to that list.

Slack's bot token and signing secret are already set. Open **WhatsApp Trial → Home** in the Warpdrive demo Sandbox workspace.

## Deploy again

```bash
npm test
npx convex deploy
```
