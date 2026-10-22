import assert from "node:assert/strict";
import test from "node:test";
import { handleSendvise, handleSlackMessage, startOutbound } from "../convex/lib/inbox.js";
import { createStore } from "../support/sqliteStore.js";

function harness(agentUserIds = ["U_A", "U_B"]) {
  const posts = [];
  const invites = [];
  const channels = [];
  const sent = [];
  const templates = [];
  const store = createStore(":memory:");
  const deps = {
    store,
    config: { agentUserIds, privateChannels: true, sendviseTemplateLanguage: "en" },
    log: { info() {}, warn() {}, error() {} },
    slack: {
      async postMessage(args) {
        const ts = `1.${posts.length + 1}`;
        posts.push({ ...args, ts });
        return { ok: true, ts, channel: args.channel };
      },
      async addReaction() {},
      async createChannel({ name }) {
        const channel = { id: `C_${channels.length + 1}`, name };
        channels.push(channel);
        return channel;
      },
      async invite(channel, user) {
        invites.push({ channel, user });
      },
      async setPurpose() {},
      async publishView() {},
    },
    sendvise: {
      async sendText(to, text) {
        sent.push({ to, text });
        return { message_id: `wamid.${sent.length}` };
      },
      async sendTemplate(to, template, variables) {
        templates.push({ to, template, variables });
        return { message_id: `wamid.t${templates.length}`, status: "sent" };
      },
    },
  };
  return { deps, posts, invites, channels, sent, templates, store };
}

function inbound(phone, message, name = "Deepu") {
  return {
    event: "message.received",
    timestamp: new Date().toISOString(),
    data: {
      phone,
      type: "text",
      message,
      wamid: `wamid.${phone}.${message}`,
      contact: { name, phone },
    },
  };
}

test("inbound WhatsApp opens a private channel and rotates the assignee", async () => {
  const { deps, posts, invites, channels } = harness();
  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  await handleSendvise(inbound("+919800000001", "Hi", "Asha"), "del-2", deps);
  await handleSendvise(inbound("+919812345678", "Any update?"), "del-3", deps);

  assert.equal(channels.length, 2);
  assert.equal(channels[0].name, "wa-deepu-5678");
  assert.deepEqual(invites[0], { channel: "C_1", user: "U_A" });
  assert.deepEqual(invites[1], { channel: "C_2", user: "U_B" });
  assert.equal(posts.filter((post) => post.channel === "C_1").length, 3);
  assert.match(posts[0].text, /this one is yours/);
  assert.match(posts[1].text, /Hello/);
});

test("a channel reply sends WhatsApp only after the customer has written", async () => {
  const { deps, posts, sent, store } = harness();
  store.upsertContact("919812345678", { channelId: "C_EXISTING", name: "Deepu" });
  await handleSlackMessage(
    { eventId: "Ev0", message: { channel: "C_EXISTING", ts: "2.0", user: "U_A", text: "Too soon" } },
    deps,
  );
  assert.equal(sent.length, 0);
  assert.match(posts.at(-1).text, /Home tab/);

  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  const channel = store.getContact("919812345678").channel_id;
  await handleSlackMessage(
    { eventId: "Ev1", message: { channel, ts: "2.1", user: "U_A", text: "On the way" } },
    deps,
  );
  assert.deepEqual(sent, [{ to: "919812345678", text: "On the way" }]);
});

test("opt-out blocks a later channel reply", async () => {
  const { deps, posts, sent } = harness();
  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  const channel = deps.store.getContact("919812345678").channel_id;
  await handleSendvise(
    { event: "opt_out", timestamp: new Date().toISOString(), data: { phone: "+919812345678" } },
    "del-opt",
    deps,
  );
  await handleSlackMessage(
    { eventId: "Ev2", message: { channel, ts: "9.8", user: "U_A", text: "hello" } },
    deps,
  );
  assert.equal(sent.length, 0);
  assert.match(posts.at(-1).text, /opted out/);
});

test("messages sent from Home are not mirrored again by the webhook", async () => {
  const { deps, posts, store } = harness();
  store.rememberOutbound({ wamid: "wamid.OUT", phone: "919812345678", status: "sent" });
  await handleSendvise(
    { event: "message.sent", data: { phone: "+919812345678", message: "On the way", wamid: "wamid.OUT" } },
    "del-sent",
    deps,
  );
  assert.equal(posts.length, 0);
});

test("outbound from Home sends the template and adds the sender to the channel", async () => {
  const { deps, templates, invites, channels, posts } = harness();
  const result = await startOutbound(
    {
      userId: "U_ME",
      assign: "me",
      headerText: "",
      headerMediaUrl: "",
      values: { 1: "Priya", 2: "#44" },
      meta: {
        name: "Priya Sharma",
        phone: "919812345678",
        template_name: "order_update",
        template_body: "Hi {{1}}, your order {{2}} is confirmed.",
        language: "en",
        var_keys: ["1", "2"],
        needs_header_text: false,
        needs_header_media: false,
      },
    },
    deps,
  );
  assert.deepEqual(templates[0], {
    to: "919812345678",
    template: "order_update",
    variables: ["Priya", "#44"],
  });
  assert.equal(channels.length, 1);
  assert.deepEqual(invites, [{ channel: result.channelId, user: "U_ME" }]);
  assert.match(posts.at(-1).text, /Hi Priya, your order #44 is confirmed/);
  assert.equal(deps.store.getContact("919812345678").assignee_user_id, "U_ME");
});

test("handing the reply to the rota invites that person and the sender", async () => {
  const { deps, invites } = harness();
  const result = await startOutbound(
    {
      userId: "U_DESK",
      assign: "round_robin",
      headerText: "",
      headerMediaUrl: "",
      values: {},
      meta: {
        name: "Ravi",
        phone: "919800001111",
        template_name: "hello",
        template_body: "Hello from us.",
        language: "en",
        var_keys: [],
        needs_header_text: false,
        needs_header_media: false,
      },
    },
    deps,
  );
  assert.equal(result.assigneeUserId, "U_A");
  assert.deepEqual(
    invites.map((invite) => invite.user),
    ["U_A", "U_DESK"],
  );
});

test("a failed channel open releases the delivery so Sendvise can retry", async () => {
  const { deps, store } = harness();
  deps.slack.createChannel = async () => {
    const err = new Error("missing_scope");
    err.code = "missing_scope";
    throw err;
  };
  await assert.rejects(() => handleSendvise(inbound("+919812345678", "Hello"), "del-fail", deps));
  assert.equal(store.claim("del-fail"), true);
});

test("inbound files are uploaded into the channel instead of linked", async () => {
  const { deps, posts } = harness();
  const uploads = [];
  deps.slack.uploadFile = async (args) => {
    uploads.push(args);
    return { ok: true };
  };
  deps.files = {
    async fetch(url) {
      assert.equal(url, "https://cdn.example/invoice.pdf");
      return { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "application/pdf" };
    },
  };
  await handleSendvise(
    {
      event: "message.received",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "document",
        message: "Signed copy",
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        media_url: "https://cdn.example/invoice.pdf",
        contact: { name: "Deepu", phone: "+919812345678" },
      },
    },
    "del-pdf",
    deps,
  );
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].filename, "invoice.pdf");
  assert.equal(uploads[0].contentType, "application/pdf");
  assert.equal(uploads[0].bytes.byteLength, 4);
  assert.match(posts.map((post) => post.text).join("\n"), /Signed copy/);
  assert.equal(posts.some((post) => JSON.stringify(post).includes("cdn.example")), false);
});

test("an inbound WhatsApp contact card is written in the channel and attached as a vcard", async () => {
  const { deps, posts } = harness();
  const uploads = [];
  deps.slack.uploadFile = async (args) => {
    uploads.push(args);
    return { ok: true };
  };
  await handleSendvise(
    {
      event: "message.received",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "contacts",
        contact: { name: "Deepu", phone: "+919812345678" },
        contacts: [
          {
            name: { formatted_name: "Ravi Kumar", first_name: "Ravi", last_name: "Kumar" },
            phones: [{ phone: "+919800001111" }],
          },
        ],
      },
    },
    "del-card",
    deps,
  );
  const rendered = posts.find((post) => post.blocks);
  assert.match(rendered.blocks[0].text.text, /Ravi Kumar/);
  assert.match(rendered.blocks[0].text.text, /\+919800001111/);
  assert.equal(uploads[0].filename, "Ravi Kumar.vcf");
  assert.match(new TextDecoder().decode(uploads[0].bytes), /BEGIN:VCARD/);
  assert.equal(JSON.stringify(rendered).includes("http"), false);
});

test("a channel file is sent to WhatsApp as the file, not as a link", async () => {
  const { deps, posts, sent } = harness();
  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  const channel = deps.store.getContact("919812345678").channel_id;
  const media = [];
  const contacts = [];
  deps.slack.download = async (url) => {
    if (url.endsWith("card.vcf")) {
      const vcf = "BEGIN:VCARD\nVERSION:3.0\nFN:Ravi Kumar\nTEL:+919800001111\nEND:VCARD\n";
      return { bytes: new TextEncoder().encode(vcf), contentType: "text/vcard" };
    }
    return { bytes: new Uint8Array([9, 9, 9, 9]), contentType: "application/octet-stream" };
  };
  deps.files = {
    async publish(_bytes, meta) {
      return `https://files.example/${encodeURIComponent(meta.filename)}`;
    },
  };
  deps.sendvise.sendMedia = async (to, payload) => {
    media.push({ to, ...payload });
    return { message_id: `wamid.m${media.length}` };
  };
  deps.sendvise.sendContacts = async (to, cards) => {
    contacts.push({ to, cards });
    return { message_id: "wamid.card" };
  };

  await handleSlackMessage(
    {
      eventId: "Ev-files",
      message: {
        channel,
        ts: "4.1",
        user: "U_A",
        text: "Pack <https://warpdrive.slack.com/files/U1/F1/a.pdf|a.pdf>",
        subtype: "file_share",
        files: [
          { name: "a.pdf", mimetype: "application/pdf", url_private_download: "https://files.slack.com/a.pdf", size: 4 },
          { name: "b.docx", mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", url_private_download: "https://files.slack.com/b.docx", size: 4 },
          { name: "c.xlsx", mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", url_private_download: "https://files.slack.com/c.xlsx", size: 4 },
          { name: "photo.png", mimetype: "image/png", url_private_download: "https://files.slack.com/photo.png", size: 4 },
          { name: "anim.gif", mimetype: "image/gif", url_private_download: "https://files.slack.com/anim.gif", size: 4 },
          { name: "card.vcf", mimetype: "text/vcard", url_private_download: "https://files.slack.com/card.vcf", size: 80 },
          { name: "skip.zip", mimetype: "application/zip", url_private_download: "https://files.slack.com/skip.zip", size: 4 },
        ],
      },
    },
    deps,
  );

  assert.equal(sent.length, 0);
  assert.deepEqual(
    media.map((item) => [item.type, item.filename, item.caption || "", item.mediaUrl]),
    [
      ["document", "a.pdf", "Pack", "https://files.example/a.pdf"],
      ["document", "b.docx", "", "https://files.example/b.docx"],
      ["document", "c.xlsx", "", "https://files.example/c.xlsx"],
      ["image", "photo.png", "", "https://files.example/photo.png"],
      ["document", "anim.gif", "", "https://files.example/anim.gif"],
    ],
  );
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].cards[0].name.formatted_name, "Ravi Kumar");
  assert.match(posts.at(-1).text, /skip\.zip/);
  assert.match(posts.at(-1).text, /contact cards/);
});

test("a file-only reply is sent once the WhatsApp window is open", async () => {
  const { deps, posts, sent } = harness();
  deps.store.upsertContact("919812345678", { channelId: "C_EXISTING", name: "Deepu" });
  await handleSlackMessage(
    {
      eventId: "Ev-early-file",
      message: {
        channel: "C_EXISTING",
        ts: "5.0",
        user: "U_A",
        text: "",
        files: [{ name: "quote.pdf", mimetype: "application/pdf", url_private_download: "https://files.slack.com/quote.pdf", size: 4 }],
      },
    },
    deps,
  );
  assert.equal(sent.length, 0);
  assert.match(posts.at(-1).text, /Home tab/);

  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  const channel = deps.store.getContact("919812345678").channel_id;
  const media = [];
  deps.slack.download = async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), contentType: "application/pdf" });
  deps.files = { async publish() { return "https://files.example/quote.pdf"; } };
  deps.sendvise.sendMedia = async (to, payload) => {
    media.push({ to, ...payload });
    return { message_id: "wamid.pdf" };
  };
  await handleSlackMessage(
    {
      eventId: "Ev-pdf",
      message: {
        channel,
        ts: "5.1",
        user: "U_A",
        subtype: "file_share",
        files: [{ name: "quote.pdf", mimetype: "application/pdf", url_private_download: "https://files.slack.com/quote.pdf", size: 4 }],
      },
    },
    deps,
  );
  assert.equal(media.length, 1);
  assert.equal(media[0].type, "document");
  assert.equal(media[0].filename, "quote.pdf");
  assert.equal(posts.some((post) => /Files stay in Slack/.test(post.text || "")), false);
});

test("opt-out blocks a file the same way it blocks text", async () => {
  const { deps, posts } = harness();
  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  const channel = deps.store.getContact("919812345678").channel_id;
  await handleSendvise(
    { event: "opt_out", timestamp: new Date().toISOString(), data: { phone: "+919812345678" } },
    "del-opt",
    deps,
  );
  const media = [];
  deps.sendvise.sendMedia = async () => {
    media.push("sent");
    return { message_id: "wamid.no" };
  };
  await handleSlackMessage(
    {
      eventId: "Ev-opt-file",
      message: {
        channel,
        ts: "5.4",
        user: "U_A",
        files: [{ name: "quote.pdf", mimetype: "application/pdf", url_private_download: "https://files.slack.com/quote.pdf", size: 4 }],
      },
    },
    deps,
  );
  assert.equal(media.length, 0);
  assert.match(posts.at(-1).text, /opted out/);
});

test("a file sent outside Slack is attached in the channel", async () => {
  const { deps, posts } = harness();
  const uploads = [];
  deps.slack.uploadFile = async (args) => {
    uploads.push(args);
    return { ok: true };
  };
  deps.files = {
    async fetch() {
      return { bytes: new Uint8Array([7, 7]), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    },
  };
  await handleSendvise(
    {
      event: "message.sent",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "document",
        message: "Purchase order",
        filename: "po.docx",
        media_url: "https://cdn.example/po.docx",
        wamid: "wamid.outside",
      },
    },
    "del-sent-file",
    deps,
  );
  assert.match(posts.map((post) => post.text).join("\n"), /Sent outside Slack/);
  assert.match(posts.map((post) => post.text).join("\n"), /Purchase order/);
  assert.equal(uploads[0].filename, "po.docx");
  assert.equal(posts.some((post) => JSON.stringify(post).includes("cdn.example")), false);
});

test("an unnamed inbound document is sniffed from its bytes and uploaded", async () => {
  const { deps, posts } = harness();
  const uploads = [];
  deps.slack.uploadFile = async (args) => {
    uploads.push(args);
    return { ok: true };
  };
  deps.files = {
    async fetch(url) {
      assert.equal(url, "https://cdn.example/media/abc123");
      return {
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
        contentType: "application/octet-stream",
      };
    },
  };
  await handleSendvise(
    {
      event: "message.received",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "document",
        media_url: "https://cdn.example/media/abc123",
        contact: { name: "Deepu", phone: "+919812345678" },
      },
    },
    "del-sniff",
    deps,
  );
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].filename, "file.pdf");
  assert.equal(uploads[0].contentType, "application/pdf");
  assert.equal(posts.some((post) => JSON.stringify(post).includes("cdn.example")), false);
});

test("an inbound document keeps the customer filename instead of the storage id", async () => {
  const { deps, posts } = harness();
  const uploads = [];
  deps.slack.uploadFile = async (args) => {
    uploads.push(args);
    return { ok: true };
  };
  deps.files = {
    async fetch() {
      return {
        bytes: new TextEncoder().encode("PK\u0003\u0004[Content_Types].xml spreadsheetml xl/"),
        contentType: "application/octet-stream",
      };
    },
  };
  await handleSendvise(
    {
      event: "message.received",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "document",
        filename: "78fb2b91-124e-4965-b22b-b08ff4f34b2c.bin",
        message: "78fb2b91-124e-4965-b22b-b08ff4f34b2c.bin",
        document: { filename: "FinalABISProShop - Manish nagar - Copy.xlsx" },
        media_url: "https://cdn.example/78fb2b91-124e-4965-b22b-b08ff4f34b2c.bin",
        contact: { name: "Deepu", phone: "+919812345678" },
      },
    },
    "del-customer-name",
    deps,
  );
  assert.equal(uploads[0].filename, "FinalABISProShop - Manish nagar - Copy.xlsx");
  assert.equal(uploads[0].title, "FinalABISProShop - Manish nagar - Copy.xlsx");
  const rendered = posts.map((post) => post.text).join("\n");
  assert.match(rendered, /FinalABISProShop - Manish nagar - Copy\.xlsx/);
  assert.doesNotMatch(rendered, /78fb2b91/);
});

test("an inbound Word file keeps its extension even when the CDN is generic", async () => {
  const { deps, posts } = harness();
  const uploads = [];
  deps.slack.uploadFile = async (args) => {
    uploads.push(args);
    return { ok: true };
  };
  deps.files = {
    async fetch() {
      return {
        bytes: new TextEncoder().encode("PK\u0003\u0004[Content_Types].xml wordprocessingml.document word/"),
        contentType: "application/octet-stream",
      };
    },
  };
  await handleSendvise(
    {
      event: "message.received",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "document",
        filename: "po.docx",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        media_url: "https://cdn.example/po.docx",
        contact: { name: "Deepu", phone: "+919812345678" },
      },
    },
    "del-docx",
    deps,
  );
  assert.equal(uploads[0].filename, "po.docx");
  assert.equal(uploads[0].contentType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(posts.some((post) => JSON.stringify(post).includes("cdn.example")), false);
});

test("a file that cannot be fetched falls back to its link", async () => {
  const { deps, posts } = harness();
  deps.files = {
    async fetch() {
      throw new Error("network");
    },
  };
  await handleSendvise(
    {
      event: "message.received",
      timestamp: new Date().toISOString(),
      data: {
        phone: "+919812345678",
        type: "document",
        filename: "invoice.pdf",
        media_url: "https://cdn.example/invoice.pdf",
        contact: { name: "Deepu", phone: "+919812345678" },
      },
    },
    "del-miss",
    deps,
  );
  const note = posts.map((post) => post.text).join("\n");
  assert.match(note, /Couldn't show invoice\.pdf/);
  assert.match(note, /https:\/\/cdn\.example\/invoice\.pdf/);
  assert.equal(posts.some((post) => post.blocks && JSON.stringify(post.blocks).includes("cdn.example")), false);
});

test("round robin survives the store and wraps", () => {
  const store = createStore(":memory:");
  assert.equal(store.nextAssignee(["U1", "U2"]), "U1");
  assert.equal(store.nextAssignee(["U1", "U2"]), "U2");
  assert.equal(store.nextAssignee(["U1", "U2"]), "U1");
  assert.equal(store.nextAssignee([]), null);
});
