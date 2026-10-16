import assert from "node:assert/strict";
import test from "node:test";
import { handleSendvise, handleSlackMessage, startOutbound } from "../convex/lib/inbox.js";
import { createStore } from "../support/sqliteStore.js";

function seedRouting(store, { vendors, employees, mappings }) {
  for (const employee of employees) {
    store.upsertEmployee({
      slackUserId: employee.slack_user_id,
      name: employee.name,
      email: employee.email ?? null,
      phone: employee.phone ?? null,
      active: employee.active !== false,
    });
  }
  for (const vendor of vendors) {
    store.upsertVendor({
      phone: vendor.phone,
      name: vendor.name,
      active: vendor.active !== false,
    });
  }
  for (const mapping of mappings) {
    store.upsertVendorEmployeeMapping({
      vendorPhone: mapping.vendor_phone,
      employeeSlackUserId: mapping.employee_slack_user_id,
      active: mapping.active !== false,
    });
  }
}

const DEFAULT_ROUTING = {
  employees: [
    { slack_user_id: "U_A", name: "Agent A", phone: "919755226079" },
    { slack_user_id: "U_B", name: "Agent B", phone: "917880103410" },
    { slack_user_id: "U_C", name: "Agent C", phone: "919201775427" },
  ],
  vendors: [
    { phone: "919812345678", name: "Deepu" },
    { phone: "919800000001", name: "Asha" },
    { phone: "919800001111", name: "Ravi" },
  ],
  mappings: [
    { vendor_phone: "919812345678", employee_slack_user_id: "U_A" },
    { vendor_phone: "919812345678", employee_slack_user_id: "U_B" },
    { vendor_phone: "919800000001", employee_slack_user_id: "U_B" },
    { vendor_phone: "919800001111", employee_slack_user_id: "U_A" },
  ],
};

function harness(agentUserIds = [], routing = DEFAULT_ROUTING) {
  const posts = [];
  const invites = [];
  const channels = [];
  const sent = [];
  const templates = [];
  const membersByChannel = new Map();
  const store = createStore(":memory:");
  if (routing) seedRouting(store, routing);
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
        membersByChannel.set(channel.id, new Set());
        return channel;
      },
      async listMemberIds(channel) {
        return membersByChannel.get(channel) || new Set();
      },
      async invite(channel, user) {
        invites.push({ channel, user });
        const set = membersByChannel.get(channel) || new Set();
        set.add(user);
        membersByChannel.set(channel, set);
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

test("inbound WhatsApp opens a private channel and invites mapped employees", async () => {
  const { deps, posts, invites, channels, store } = harness();
  await handleSendvise(inbound("+919812345678", "Hello"), "del-1", deps);
  await handleSendvise(inbound("+919800000001", "Hi", "Asha"), "del-2", deps);
  await handleSendvise(inbound("+919812345678", "Any update?"), "del-3", deps);

  assert.equal(channels.length, 2);
  assert.equal(channels[0].name, "wa-deepu-5678");
  assert.deepEqual(
    invites.filter((row) => row.channel === "C_1").map((row) => row.user).sort(),
    ["U_A", "U_B"],
  );
  assert.deepEqual(
    invites.filter((row) => row.channel === "C_2").map((row) => row.user),
    ["U_B"],
  );
  assert.equal(store.getContact("919812345678").assignee_user_id, "U_A");
  assert.equal(posts.filter((post) => post.channel === "C_1").length, 3);
  assert.match(posts[0].text, /this one is yours/);
  assert.match(posts[1].text, /Hello/);
  const delivered = store.listMessageLogs("919812345678").find((row) => row.status === "delivered");
  assert.ok(delivered);
  assert.match(delivered.employee_slack_ids, /U_A/);
});

test("SLACK_AGENT_USER_IDS are invited in addition to mapped employees", async () => {
  const { deps, invites, channels } = harness(["U_ALWAYS"]);
  await handleSendvise(inbound("+919800000001", "Hi", "Asha"), "del-extra", deps);
  assert.equal(channels.length, 1);
  assert.deepEqual(
    invites.map((row) => row.user).sort(),
    ["U_ALWAYS", "U_B"],
  );
});

test("unmapped sender still opens a Slack channel; invalid phone stays unmapped", async () => {
  const { deps, posts, channels, store } = harness();
  await handleSendvise(inbound("+919999999999", "Hello", "Unknown"), "del-u1", deps);
  await handleSendvise(inbound("123", "Nope", "Bad"), "del-u2", deps);

  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "wa-unknown-9999");
  assert.equal(store.listMessageLogs("919999999999")[0].status, "delivered");
  assert.match(posts.at(-1).text, /Hello/);
  assert.equal(store.listMessageLogs("123")[0].status, "unmapped");
});

test("outbound-first keeps the template sender as assignee when the vendor replies", async () => {
  const { deps, invites, store } = harness();
  await startOutbound(
    {
      userId: "U_ME",
      assign: "me",
      headerText: "",
      headerMediaUrl: "",
      values: { 1: "Priya", 2: "#44" },
      meta: {
        name: "Deepu",
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
  assert.equal(store.getContact("919812345678").assignee_user_id, "U_ME");

  invites.length = 0;
  await handleSendvise(inbound("+919812345678", "Thanks"), "del-reply", deps);
  assert.equal(store.getContact("919812345678").assignee_user_id, "U_ME");
  // U_ME is already in the channel from the template send; only missing mapped users are invited.
  assert.deepEqual(
    [...new Set(invites.map((row) => row.user))].sort(),
    ["U_A", "U_B"],
  );
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
  const { deps, invites } = harness(["U_A", "U_B"]);
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
    [...new Set(invites.map((invite) => invite.user))],
    ["U_A", "U_DESK", "U_B"],
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

test("invite failures for one employee do not block delivery", async () => {
  const { deps, posts, store } = harness();
  const original = deps.slack.invite;
  deps.slack.invite = async (channel, user) => {
    if (user === "U_B") {
      const err = new Error("user_not_found");
      err.code = "user_not_found";
      throw err;
    }
    return original(channel, user);
  };
  await handleSendvise(inbound("+919812345678", "Hello"), "del-partial", deps);
  assert.ok(posts.some((post) => /Hello/.test(post.text || "")));
  assert.equal(store.getContact("919812345678").channel_id, "C_1");
});

test("round robin survives the store and wraps", () => {
  const store = createStore(":memory:");
  assert.equal(store.nextAssignee(["U1", "U2"]), "U1");
  assert.equal(store.nextAssignee(["U1", "U2"]), "U2");
  assert.equal(store.nextAssignee(["U1", "U2"]), "U1");
  assert.equal(store.nextAssignee([]), null);
});
