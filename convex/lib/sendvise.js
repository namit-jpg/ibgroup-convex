export function createSendvise({ apiKey, baseUrl, phoneNumberId }) {
  async function request(path, { method = "GET", payload } = {}) {
    const body = payload ? { ...payload } : null;
    if (body && phoneNumberId && Number.isFinite(Number(phoneNumberId))) {
      body.phone_number_id = Number(phoneNumberId);
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const err = new Error(json.message || `Sendvise request failed (${res.status})`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json.data ?? {};
  }

  return {
    sendText(to, text) {
      return request("/v1/external/messages/send", {
        method: "POST",
        payload: { to, type: "text", text },
      });
    },
    sendTemplate(to, templateName, variables, language, extras = {}) {
      const payload = { to, template_name: templateName, language };
      if (variables?.length) payload.variables = variables;
      if (extras.headerText) payload.header_text = extras.headerText;
      if (extras.headerMediaUrl) {
        payload.header_media_url = extras.headerMediaUrl;
        if (extras.headerMediaType) payload.header_media_type = extras.headerMediaType;
      }
      return request("/v1/external/messages/send-template", { method: "POST", payload });
    },
    async listTemplates() {
      const data = await request("/v1/external/templates");
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.templates)) return data.templates;
      return [];
    },
    getTemplate(uuid) {
      return request(`/v1/external/templates/${encodeURIComponent(uuid)}`);
    },
  };
}

export function createTemplateSource(sendvise, ttlMs = 60_000) {
  let fetchedAt = 0;
  let rows = [];
  return {
    async approved() {
      if (rows.length && Date.now() - fetchedAt < ttlMs) return rows;
      const all = await sendvise.listTemplates();
      rows = all.filter((template) => template.status === "approved" && template.uuid && template.name);
      fetchedAt = Date.now();
      return rows;
    },
    async get(uuid) {
      const cached = rows.find((template) => template.uuid === uuid);
      if (cached?.body) return cached;
      return sendvise.getTemplate(uuid);
    },
  };
}
