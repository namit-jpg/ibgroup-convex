import { escapeMrkdwn, normalizePhone, renderTemplate } from "./bridge.js";

const STATUS_LABEL = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  queued: "Sending",
};

function clip(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function channelLink(channelId) {
  return `https://slack.com/app_redirect?channel=${channelId}`;
}

function previewBlock(body) {
  return {
    type: "section",
    block_id: "preview",
    text: { type: "mrkdwn", text: `*They will see*\n${escapeMrkdwn(body)}` },
  };
}

export function buildHomeView({ cards = [], agentsConfigured = false }) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "WhatsApp", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Start a chat before the customer writes in. The first message has to be an *approved template*. When they reply, the conversation continues in its own channel.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "New message", emoji: true },
          action_id: "open_new_message",
        },
      ],
    },
  ];

  if (!cards.length) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*No conversations yet*\nSend a template and a channel opens with you in it. Reply there after the customer writes back.",
        },
      },
    );
  } else {
    blocks.push(
      { type: "divider" },
      { type: "header", text: { type: "plain_text", text: "Recent", emoji: true } },
    );
    for (const card of cards) blocks.push(...cardBlocks(card));
  }

  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: agentsConfigured
            ? "A customer who messages first is given to the next person on the rota. A chat you start stays with you, unless you hand the reply to the next person."
            : "Add Slack member IDs to SLACK_AGENT_USER_IDS so a customer who messages first is handed to someone automatically.",
        },
      ],
    },
  );

  return { type: "home", blocks };
}

function cardBlocks(card) {
  const name = card.name || "WhatsApp contact";
  const preview = clip(card.last_message || card.latest?.preview || "No message yet", 180);
  const status = STATUS_LABEL[card.latest?.status] || "";
  const bits = [];
  if (card.latest?.template_name) bits.push(`\`${escapeMrkdwn(card.latest.template_name)}\``);
  if (status) bits.push(status);
  if (card.latest?.status === "failed" && card.latest.error) bits.push(escapeMrkdwn(clip(card.latest.error, 80)));
  if (card.assignee_user_id) bits.push(`Assigned to <@${card.assignee_user_id}>`);
  const section = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${escapeMrkdwn(name)}*\n\`+${card.phone}\`\n${escapeMrkdwn(preview)}`,
    },
  };
  if (card.channel_id) {
    section.accessory = {
      type: "button",
      text: { type: "plain_text", text: "Open chat", emoji: true },
      url: channelLink(card.channel_id),
      action_id: `open_channel_${card.channel_id}`,
    };
  }
  const blocks = [section];
  if (bits.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: bits.join("  ·  ") }],
    });
  }
  return blocks;
}

export function loadingModal() {
  return {
    type: "modal",
    callback_id: "pick_template",
    title: { type: "plain_text", text: "New message" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Loading your approved templates…" },
      },
    ],
  };
}

export function composeModal(templates) {
  if (!templates.length) {
    return {
      type: "modal",
      callback_id: "pick_template",
      title: { type: "plain_text", text: "New message" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "There are no approved WhatsApp templates yet. Approve one in Sendvise, then come back here.",
          },
        },
      ],
    };
  }

  return {
    type: "modal",
    callback_id: "pick_template",
    title: { type: "plain_text", text: "New message" },
    submit: { type: "plain_text", text: "Continue" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Who is this for? You'll fill in the template on the next step and see it before it sends.",
        },
      },
      {
        type: "input",
        block_id: "name",
        optional: true,
        label: { type: "plain_text", text: "Name" },
        element: {
          type: "plain_text_input",
          action_id: "name",
          placeholder: { type: "plain_text", text: "Priya Sharma" },
        },
      },
      {
        type: "input",
        block_id: "phone",
        label: { type: "plain_text", text: "WhatsApp number" },
        hint: { type: "plain_text", text: "Country code, digits only. Example: 919812345678" },
        element: {
          type: "plain_text_input",
          action_id: "phone",
          placeholder: { type: "plain_text", text: "919812345678" },
        },
      },
      {
        type: "input",
        block_id: "template",
        label: { type: "plain_text", text: "Template" },
        element: {
          type: "static_select",
          action_id: "template",
          placeholder: { type: "plain_text", text: "Choose an approved template" },
          options: templates.slice(0, 100).map(templateOption),
        },
      },
    ],
  };
}

function templateOption(template) {
  const language = template.language && template.language !== "en" ? ` · ${template.language}` : "";
  const option = {
    text: { type: "plain_text", text: clip(`${template.name}${language}`, 75) },
    value: template.uuid,
  };
  const description = clip(String(template.body || template.category || "").replace(/\s+/g, " "), 75);
  if (description) option.description = { type: "plain_text", text: description };
  return option;
}

export function readCompose(view) {
  const values = view.state?.values || {};
  return {
    name: (values.name?.name?.value || "").trim(),
    phone: normalizePhone(values.phone?.phone?.value || ""),
    templateUuid: values.template?.template?.selected_option?.value || "",
  };
}

export function validateCompose(parsed) {
  const errors = {};
  if (!parsed.phone) errors.phone = "Enter the number with country code, digits only.";
  if (!parsed.templateUuid) errors.template = "Choose a template.";
  return Object.keys(errors).length ? errors : null;
}

export function variableLabel(body, key) {
  const source = String(body || "");
  const token = source.match(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`));
  if (!token || token.index == null) return `Blank ${key}`;
  const before = source
    .slice(0, token.index)
    .replace(/\{\{[^}]*\}\}/g, " ")
    .trim()
    .split(/\s+/)
    .slice(-3)
    .join(" ");
  const after = source
    .slice(token.index + token[0].length)
    .replace(/\{\{[^}]*\}\}/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  const phrase = `${before} ___ ${after}`.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return clip(phrase, 70) || `Blank ${key}`;
}

export function detailsModal({ meta, values = {}, headerText = "", headerMediaUrl = "", assign = "me", error = "" }) {
  const keys = meta.var_keys || [];
  const blocks = [];
  if (error) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `:warning: ${escapeMrkdwn(error)}` },
    });
  }
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${escapeMrkdwn(meta.name)}*  \`+${meta.phone}\`\nTemplate \`${escapeMrkdwn(meta.template_name)}\``,
    },
  });
  blocks.push(previewBlock(renderTemplate(meta.template_body, values)));

  for (const key of keys) {
    const element = {
      type: "plain_text_input",
      action_id: `var_${key}`,
      placeholder: { type: "plain_text", text: "Type the value" },
    };
    if (values[key]) element.initial_value = String(values[key]);
    blocks.push({
      type: "input",
      block_id: `var_${key}`,
      label: { type: "plain_text", text: variableLabel(meta.template_body, key) },
      element,
    });
  }

  if (meta.needs_header_text) {
    const element = {
      type: "plain_text_input",
      action_id: "header_text",
      placeholder: { type: "plain_text", text: "Header text" },
    };
    if (headerText) element.initial_value = headerText;
    blocks.push({
      type: "input",
      block_id: "header_text",
      label: { type: "plain_text", text: "Header" },
      element,
    });
  }

  if (meta.needs_header_media) {
    const element = {
      type: "plain_text_input",
      action_id: "header_media",
      placeholder: { type: "plain_text", text: "https://…" },
    };
    if (headerMediaUrl) element.initial_value = headerMediaUrl;
    blocks.push({
      type: "input",
      block_id: "header_media",
      label: { type: "plain_text", text: `${meta.header_format || "Media"} link` },
      hint: { type: "plain_text", text: "A public link WhatsApp can download." },
      element,
    });
  }

  if (meta.agents_configured) {
    const options = [
      { text: { type: "plain_text", text: "I'll handle the reply" }, value: "me" },
      { text: { type: "plain_text", text: "Hand the reply to the next person" }, value: "round_robin" },
    ];
    blocks.push({
      type: "input",
      block_id: "assignee",
      label: { type: "plain_text", text: "Who handles the reply?" },
      hint: { type: "plain_text", text: "You are added to the channel either way." },
      element: {
        type: "static_select",
        action_id: "assignee",
        options,
        initial_option: options.find((option) => option.value === assign) || options[0],
      },
    });
  } else {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "You'll be added to the channel, so the reply comes back to you." }],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Update preview", emoji: true },
        action_id: "refresh_preview",
      },
    ],
  });

  return {
    type: "modal",
    callback_id: "send_outbound",
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "Check and send" },
    submit: { type: "plain_text", text: "Send on WhatsApp" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

export function readDetails(view) {
  const meta = JSON.parse(view.private_metadata || "{}");
  const state = view.state?.values || {};
  const values = {};
  for (const key of meta.var_keys || []) {
    values[key] = state[`var_${key}`]?.[`var_${key}`]?.value || "";
  }
  return {
    meta,
    values,
    headerText: state.header_text?.header_text?.value || "",
    headerMediaUrl: state.header_media?.header_media?.value || "",
    assign: state.assignee?.assignee?.selected_option?.value || "me",
  };
}

export function validateDetails(parsed) {
  const errors = {};
  for (const key of parsed.meta.var_keys || []) {
    if (!String(parsed.values[key] || "").trim()) {
      errors[`var_${key}`] = "Fill this in so the message makes sense.";
    }
  }
  if (parsed.meta.needs_header_text && !parsed.headerText.trim()) {
    errors.header_text = "This template needs header text.";
  }
  if (parsed.meta.needs_header_media && !/^https?:\/\//i.test(parsed.headerMediaUrl.trim())) {
    errors.header_media = "Paste a public https link to the file.";
  }
  return Object.keys(errors).length ? errors : null;
}

export function previewFromState(view) {
  const parsed = readDetails(view);
  return detailsModal({
    meta: parsed.meta,
    values: parsed.values,
    headerText: parsed.headerText,
    headerMediaUrl: parsed.headerMediaUrl,
    assign: parsed.assign,
  });
}

export function sendingModal(meta) {
  return {
    type: "modal",
    callback_id: "send_outbound",
    title: { type: "plain_text", text: "Sending" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Sending *${escapeMrkdwn(meta.template_name)}* to *${escapeMrkdwn(meta.name)}*…` },
      },
    ],
  };
}

export function successModal({ name, rendered, channelId, handedOff }) {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Message sent" },
    close: { type: "plain_text", text: "Done" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escapeMrkdwn(name)}* will get this on WhatsApp:\n${escapeMrkdwn(rendered)}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: handedOff
            ? `${handedOff} is in the channel and will see the reply. You are in it too.`
            : "You're in the channel. When they reply, answer there — not in this tab.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Open chat", emoji: true },
            url: channelLink(channelId),
            action_id: `open_channel_${channelId}`,
          },
        ],
      },
    ],
  };
}

export async function publishHome(userId, deps) {
  if (!userId || !deps.slack.publishView) return;
  const cards = deps.store.listHomeCards(userId, 8);
  await deps.slack.publishView(
    userId,
    buildHomeView({ cards, agentsConfigured: deps.config.agentUserIds.length > 0 }),
  );
}
