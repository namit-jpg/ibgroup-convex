import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomeView,
  composeModal,
  detailsModal,
  readCompose,
  readDetails,
  validateCompose,
  validateDetails,
  variableLabel,
} from "../convex/lib/home.js";

const meta = {
  name: "Priya Sharma",
  phone: "919812345678",
  template_name: "order_update",
  template_body: "Hi {{1}}, your table {{2}} is ready.",
  language: "en",
  var_keys: ["1", "2"],
  needs_header_text: false,
  needs_header_media: false,
  agents_configured: true,
};

test("home explains outbound-first and offers one primary action", () => {
  const empty = buildHomeView({ cards: [], agentsConfigured: true });
  const flat = JSON.stringify(empty);
  assert.match(flat, /New message/);
  assert.match(flat, /approved template/);
  assert.match(flat, /No conversations yet/);
  assert.doesNotMatch(flat, /\/whatsapp/);

  const filled = buildHomeView({
    agentsConfigured: true,
    cards: [
      {
        name: "Priya Sharma",
        phone: "919812345678",
        channel_id: "C123",
        assignee_user_id: "U1",
        last_message: "Hi Priya, your table 4 is ready.",
        latest: { template_name: "order_update", status: "delivered" },
      },
    ],
  });
  const text = JSON.stringify(filled);
  assert.match(text, /Priya Sharma/);
  assert.match(text, /Open chat/);
  assert.match(text, /slack.com\/app_redirect\?channel=C123/);
  assert.match(text, /Delivered/);
});

test("compose step collects who and which template", () => {
  const view = composeModal([
    { uuid: "tmpl-1", name: "order_update", status: "approved", body: "Hi {{1}}" },
  ]);
  assert.equal(view.submit.text, "Continue");
  assert.equal(view.blocks.find((block) => block.block_id === "template").element.options[0].value, "tmpl-1");

  const errors = validateCompose(readCompose({ state: { values: { phone: { phone: { value: "123" } } } } }));
  assert.match(errors.phone, /country code/);
  assert.equal(errors.template != null, true);
});

test("the send step labels blanks from the sentence and previews them", () => {
  assert.equal(variableLabel(meta.template_body, "1"), "Hi ___, your table");
  const view = detailsModal({ meta, values: { 1: "Priya" } });
  assert.match(JSON.stringify(view), /Hi Priya, your table ___ is ready/);
  assert.equal(view.submit.text, "Send on WhatsApp");
  const assignee = view.blocks.find((block) => block.block_id === "assignee");
  assert.deepEqual(
    assignee.element.options.map((option) => option.value),
    ["me", "round_robin"],
  );

  const parsed = readDetails({
    private_metadata: JSON.stringify(meta),
    state: {
      values: {
        var_1: { var_1: { value: "Priya" } },
        var_2: { var_2: { value: "" } },
        assignee: { assignee: { selected_option: { value: "me" } } },
      },
    },
  });
  assert.equal(validateDetails(parsed).var_2 != null, true);
  parsed.values[2] = "4";
  assert.equal(validateDetails(parsed), null);
});

test("an empty template list tells the person what to do", () => {
  const view = composeModal([]);
  assert.equal(view.submit, undefined);
  assert.match(JSON.stringify(view), /no approved WhatsApp templates/);
});
