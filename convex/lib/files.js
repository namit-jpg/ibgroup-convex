export const FILE_TYPES_NOTE =
  "WhatsApp can take images, PDF, Word (.docx), Excel (.xlsx), PowerPoint (.ppt, .pptx), CSV, and contact cards (.vcf).";

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "pjpeg",
  "pjp",
  "png",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
  "svg",
  "svgz",
  "ico",
  "jp2",
  "jxl",
]);
const DOCUMENT_EXT = new Set(["pdf", "docx", "xlsx", "ppt", "pptx", "csv"]);
const INLINE_IMAGE_EXT = new Set(["jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "png"]);

const EXT_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  svg: "image/svg+xml",
  svgz: "image/svg+xml",
  ico: "image/x-icon",
  jp2: "image/jp2",
  jxl: "image/jxl",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/plain",
  vcf: "text/vcard",
};

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/tif": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/jp2": "jp2",
  "image/jxl": "jxl",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/comma-separated-values": "csv",
  "text/vcard": "vcf",
  "text/x-vcard": "vcf",
  "text/directory": "vcf",
};

const GENERIC_MIME = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/x-binary",
  "application/download",
  "application/force-download",
  "application/x-download",
]);

const IMAGE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_BYTES = 100 * 1024 * 1024;

export function extensionOf(name = "") {
  const base = String(name).split("?")[0].split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function safeFilename(name, fallback = "file") {
  const base = String(name || fallback)
    .split(/[/\\]/)
    .pop()
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 180);
  return base || fallback;
}

function cleanMime(mime) {
  return String(mime || "").split(";")[0].trim().toLowerCase();
}

function extFromMime(mime) {
  const clean = cleanMime(mime);
  if (MIME_EXT[clean]) return MIME_EXT[clean];
  if (clean.startsWith("image/")) {
    const sub = clean.slice("image/".length).replace(/^x-/, "").replace(/\+.*/, "");
    if (/^[a-z0-9]+$/.test(sub)) return sub === "jpeg" ? "jpg" : sub;
  }
  return "";
}

export function contentTypeFor(ext, mime = "") {
  const clean = cleanMime(mime);
  if (clean && !GENERIC_MIME.has(clean)) return clean;
  return EXT_MIME[ext] || "application/octet-stream";
}

export function whatsappContentType(ext, mime = "") {
  if (ext === "csv") return "text/plain";
  return contentTypeFor(ext, mime);
}

export function contentDisposition(filename) {
  const safe = String(filename || "file").replace(/["\r\n]/g, "");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_") || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function asBytes(bytes) {
  if (!bytes) return null;
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return null;
}

function hasAscii(bytes, text, limit = 65536) {
  const needle = [];
  for (let i = 0; i < text.length; i += 1) needle.push(text.charCodeAt(i));
  const end = Math.min(bytes.length, limit);
  if (end < needle.length) return false;
  for (let i = 0; i <= end - needle.length; i += 1) {
    let found = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        found = false;
        break;
      }
    }
    if (found) return true;
  }
  return false;
}

export function sniffBytes(bytes) {
  const b = asBytes(bytes);
  if (!b?.byteLength) return null;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { kind: "document", ext: "pdf" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", ext: "png" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: "image", ext: "jpg" };
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", ext: "gif" };
  if (b.length >= 12 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { kind: "image", ext: "webp" };
  }
  if (startsWith(b, [0x42, 0x4d])) return { kind: "image", ext: "bmp" };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]) || startsWith(b, [0x50, 0x4b, 0x07, 0x08])) {
    if (hasAscii(b, "word/") || hasAscii(b, "wordprocessingml")) return { kind: "document", ext: "docx" };
    if (hasAscii(b, "xl/") || hasAscii(b, "spreadsheetml")) return { kind: "document", ext: "xlsx" };
    if (hasAscii(b, "ppt/") || hasAscii(b, "presentationml")) return { kind: "document", ext: "pptx" };
  }
  if (hasAscii(b, "BEGIN:VCARD", 256)) return { kind: "contact", ext: "vcf" };
  return null;
}

function replaceExtension(name, ext, fallback) {
  const safe = safeFilename(name, fallback);
  if (!ext) return safe;
  const current = extensionOf(safe);
  if (current === ext) return safe;
  const base = current ? safe.slice(0, safe.lastIndexOf(".")) : safe;
  return `${base || "file"}.${ext}`;
}

const STORAGE_STEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStorageName(name) {
  const base = String(name || "").split(/[/\\]/).pop().split("?")[0];
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return STORAGE_STEM.test(stem);
}

function genericExtension(name) {
  const ext = extensionOf(name);
  return !ext || ext === "bin" || ext === "octet";
}

export function refineFileFromBytes(file, bytes) {
  let sniffed = null;
  try {
    sniffed = sniffBytes(bytes);
  } catch {
    sniffed = null;
  }
  if (!sniffed || !genericExtension(file.filename)) return { ...file, bytes };
  return {
    ...file,
    bytes,
    kind: sniffed.kind,
    ext: sniffed.ext,
    filename: replaceExtension(file.filename, sniffed.ext, `file.${sniffed.ext}`),
    mime: EXT_MIME[sniffed.ext] || file.mime,
  };
}

export function classifyFile({ name = "", mimetype = "", filetype = "" } = {}) {
  const mime = cleanMime(mimetype);
  const fromName = extensionOf(name);
  const fromType = String(filetype || "").toLowerCase().replace(/^\./, "");
  const fromMime = extFromMime(mime);
  if (fromName === "vcf" || fromType === "vcf" || mime === "text/vcard" || mime === "text/x-vcard") {
    return { kind: "contact", ext: "vcf" };
  }
  if (mime.startsWith("image/") || IMAGE_EXT.has(fromName) || IMAGE_EXT.has(fromType)) {
    const ext = IMAGE_EXT.has(fromName) ? fromName : IMAGE_EXT.has(fromType) ? fromType : fromMime || "jpg";
    return { kind: "image", ext: ext === "jpeg" ? "jpg" : ext };
  }
  const docExt = [fromName, fromType, fromMime].find((ext) => DOCUMENT_EXT.has(ext));
  if (docExt) return { kind: "document", ext: docExt };
  return null;
}

export function whatsappMediaType(file) {
  if (file?.kind === "contact") return "contacts";
  // WhatsApp shows jpeg and png inline. Other pictures still go through as documents.
  if (file?.kind === "image" && INLINE_IMAGE_EXT.has(file.ext)) return "image";
  return "document";
}

export function maxBytes(file) {
  return whatsappMediaType(file) === "image" ? IMAGE_BYTES : DOCUMENT_BYTES;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function httpsOrHttp(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim()) ? value.trim() : "";
}

function mediaUrlOf(data) {
  return (
    httpsOrHttp(data.media_url) ||
    httpsOrHttp(data.media?.url) ||
    httpsOrHttp(data.media?.link) ||
    httpsOrHttp(data.document?.url) ||
    httpsOrHttp(data.document?.link) ||
    httpsOrHttp(data.image?.url) ||
    httpsOrHttp(data.image?.link) ||
    httpsOrHttp(data.sticker?.url) ||
    httpsOrHttp(data.sticker?.link) ||
    httpsOrHttp(data.file?.url) ||
    httpsOrHttp(data.url)
  );
}

function looksLikeFilename(value) {
  const base = String(value || "").trim();
  if (!base || base.length > 180 || /[\r\n]/.test(base)) return false;
  const ext = extensionOf(base);
  return /^[a-z0-9]{1,8}$/.test(ext);
}

function collectFilenames(value, key, out, depth) {
  if (depth > 5 || value == null) return;
  if (typeof value === "string") {
    if (/filename|file_name|original_name|document_name/i.test(key)) {
      const trimmed = value.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed)) out.push(trimmed);
    }
    return;
  }
  if (key === "contact" || key === "contacts") return;
  if (Array.isArray(value)) {
    for (const item of value) collectFilenames(item, key, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      collectFilenames(child, childKey, out, depth + 1);
    }
  }
}

function filenameOf(data) {
  const names = [];
  collectFilenames(data, "", names, 0);
  const message = firstString(data.message);
  if (looksLikeFilename(message)) names.push(message.trim());
  const human = names.find((name) => !isStorageName(name));
  if (human) return human;
  if (names[0]) return names[0];
  const url = mediaUrlOf(data);
  if (!url) return "";
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    if (extensionOf(base)) return base;
  } catch {
    return "";
  }
  return "";
}

function mimeOf(data) {
  return firstString(
    data.mime_type,
    data.mimetype,
    data.document?.mime_type,
    data.image?.mime_type,
    data.file?.mime_type,
    data.media?.mime_type,
    data.sticker?.mime_type,
  );
}

function captionOf(data) {
  const explicit = firstString(data.caption, data.image?.caption, data.document?.caption, data.media?.caption, data.file?.caption);
  if (explicit) return explicit;
  const message = firstString(data.message);
  if (!message) return "";
  const filename = filenameOf(data);
  const type = String(data.type || "").toLowerCase();
  if (message === filename || isStorageName(message) || message === `(${type})` || message === `[${type}]`) return "";
  return message;
}

function collectPhones(raw) {
  const values = [];
  if (Array.isArray(raw.phones)) {
    for (const phone of raw.phones) {
      if (typeof phone === "string") values.push(phone);
      else if (phone?.phone) values.push(phone.phone);
      else if (phone?.wa_id) values.push(String(phone.wa_id));
    }
  }
  if (typeof raw.phone === "string") values.push(raw.phone);
  const seen = new Set();
  const phones = [];
  for (const value of values) {
    const phone = String(value).trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    phones.push({ phone, type: "CELL" });
  }
  return phones;
}

function collectEmails(raw) {
  const values = [];
  if (Array.isArray(raw.emails)) {
    for (const email of raw.emails) {
      if (typeof email === "string") values.push(email);
      else if (email?.email) values.push(email.email);
    }
  }
  if (typeof raw.email === "string") values.push(raw.email);
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const email = String(value).trim();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push({ email, type: "WORK" });
  }
  return emails;
}

function normalizeCard(raw) {
  if (!raw || typeof raw !== "object" || raw.profile) return null;
  const nameObj = raw.name && typeof raw.name === "object" ? raw.name : null;
  const formatted = firstString(
    nameObj?.formatted_name,
    nameObj?.formattedName,
    typeof raw.name === "string" ? raw.name : "",
    raw.formatted_name,
  );
  const first = firstString(nameObj?.first_name, raw.first_name);
  const last = firstString(nameObj?.last_name, raw.last_name);
  const phones = collectPhones(raw);
  const emails = collectEmails(raw);
  const company = firstString(typeof raw.org === "string" ? raw.org : raw.org?.company, raw.company);
  if (!formatted && !first && !last && !phones.length && !emails.length && !company) return null;
  const formattedName = formatted || [first, last].filter(Boolean).join(" ") || company || "Contact";
  const firstName = first || formattedName.split(/\s+/)[0] || formattedName;
  const lastName = last || (formattedName.includes(" ") ? formattedName.split(/\s+/).slice(1).join(" ") : "");
  return {
    name: { formatted_name: formattedName, first_name: firstName, last_name: lastName },
    phones,
    emails,
    ...(company ? { org: { company } } : {}),
  };
}

export function contactBody(contacts) {
  return contacts
    .map((card) => {
      const lines = [card.name?.formatted_name];
      for (const phone of card.phones || []) lines.push(phone.phone);
      for (const email of card.emails || []) lines.push(email.email);
      if (card.org?.company) lines.push(card.org.company);
      return lines.filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function escapeVcard(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeVcard(value) {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function vcfFilename(name) {
  const base = safeFilename(name, "contact").replace(/\.vcf$/i, "") || "contact";
  return `${base}.vcf`;
}

export function vcfFromContacts(contacts) {
  return contacts
    .map((card) => {
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcard(card.name.formatted_name)}`];
      lines.push(`N:${escapeVcard(card.name.last_name || "")};${escapeVcard(card.name.first_name || "")};;;`);
      for (const phone of card.phones || []) lines.push(`TEL;TYPE=CELL:${escapeVcard(phone.phone)}`);
      for (const email of card.emails || []) lines.push(`EMAIL;TYPE=WORK:${escapeVcard(email.email)}`);
      if (card.org?.company) lines.push(`ORG:${escapeVcard(card.org.company)}`);
      lines.push("END:VCARD");
      return lines.join("\r\n");
    })
    .join("\r\n");
}

function unfoldVcard(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function propParts(line) {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const left = line.slice(0, idx);
  const [rawName] = left.split(";");
  const name = rawName.split(".").pop().toUpperCase();
  return { name, value: unescapeVcard(line.slice(idx + 1).trim()) };
}

export function parseVcf(value) {
  const text = unfoldVcard(value);
  if (!/BEGIN:VCARD/i.test(text)) return [];
  const cards = [];
  for (const chunk of text.split(/END:VCARD/i)) {
    if (!/BEGIN:VCARD/i.test(chunk)) continue;
    const card = { fn: "", first: "", last: "", phones: [], emails: [], org: "" };
    for (const line of chunk.split("\n")) {
      const prop = propParts(line.trim());
      if (!prop || !prop.value) continue;
      if (prop.name === "FN") card.fn = prop.value;
      else if (prop.name === "N") {
        const [last = "", first = ""] = prop.value.split(";");
        card.last = last;
        card.first = first;
        if (!card.fn) card.fn = [first, last].filter(Boolean).join(" ");
      } else if (prop.name === "TEL") card.phones.push(prop.value);
      else if (prop.name === "EMAIL") card.emails.push(prop.value);
      else if (prop.name === "ORG") card.org = prop.value.split(";")[0];
    }
    const normalized = normalizeCard({
      name: { formatted_name: card.fn, first_name: card.first, last_name: card.last },
      phones: card.phones,
      emails: card.emails,
      org: card.org,
    });
    if (normalized) cards.push(normalized);
  }
  return cards;
}

function inboundContacts(data) {
  const type = String(data.type || "").toLowerCase();
  const vcard = firstString(typeof data.vcard === "string" ? data.vcard : "", typeof data.vcf === "string" ? data.vcf : "");
  if (vcard) return parseVcf(vcard);
  const list = Array.isArray(data.contacts) ? data.contacts : Array.isArray(data.contact_cards) ? data.contact_cards : [];
  const cards = list.map(normalizeCard).filter(Boolean);
  if (type === "contacts" || type === "contact") return cards;
  return cards.some((card) => card.phones.length || card.emails.length) ? cards : [];
}

function withExtension(name, ext, fallback) {
  const safe = safeFilename(name, fallback);
  if (extensionOf(safe)) return safe;
  if (!ext) return safe;
  return `${safe}.${ext}`;
}

export function describeInboundFile(data) {
  if (!data || typeof data !== "object") return null;
  const type = String(data.type || "").toLowerCase();
  if (["location", "interactive", "text", "reaction", "video", "audio"].includes(type)) return null;
  const contacts = inboundContacts(data);
  if (type === "contacts" || type === "contact" || contacts.length) {
    const filename = contacts.length === 1 ? vcfFilename(contacts[0].name.formatted_name) : "contacts.vcf";
    const summary = contactBody(contacts);
    return {
      kind: "contact",
      ext: "vcf",
      filename,
      mime: "text/vcard",
      url: mediaUrlOf(data),
      caption: captionOf(data),
      summary,
      vcf: contacts.length ? vcfFromContacts(contacts) : "",
    };
  }

  const name = filenameOf(data);
  const mime = mimeOf(data);
  let classified = classifyFile({ name, mimetype: mime, filetype: type === "image" || type === "sticker" ? "" : type });
  if (!classified && (type === "image" || type === "sticker")) classified = { kind: "image", ext: extFromMime(mime) || "jpg" };
  if (!classified && (type === "document" || type === "file" || mediaUrlOf(data))) {
    const ext = extFromMime(mime) || extensionOf(name);
    const kind = IMAGE_EXT.has(ext) ? "image" : ext === "vcf" ? "contact" : "document";
    classified = { kind, ext };
  }
  if (!classified) return null;
  const fallback = classified.ext
    ? `${classified.kind === "image" ? "image" : "file"}.${classified.ext}`
    : classified.kind === "image"
      ? "image"
      : "file";
  return {
    kind: classified.kind,
    ext: classified.ext,
    filename: withExtension(name, classified.ext, fallback),
    mime: contentTypeFor(classified.ext, mime),
    url: mediaUrlOf(data),
    caption: captionOf(data),
    summary: "",
    vcf: "",
  };
}

export function slackFileName(file) {
  const name = firstString(file?.name, file?.title, "file");
  if (extensionOf(name)) return name;
  const ext = String(file?.filetype || "").toLowerCase().replace(/^\./, "");
  return ext ? `${name}.${ext}` : name;
}

export function describeSlackFile(file) {
  if (!file || typeof file !== "object") return null;
  const name = slackFileName(file);
  const classified = classifyFile({
    name,
    mimetype: file.mimetype || file.mime_type || "",
    filetype: file.filetype || "",
  });
  if (!classified) return null;
  const filename = withExtension(name, classified.ext, classified.kind === "contact" ? "contact.vcf" : `file.${classified.ext}`);
  return {
    kind: classified.kind,
    ext: classified.ext,
    filename: classified.kind === "contact" ? vcfFilename(filename) : filename,
    mime: contentTypeFor(classified.ext, file.mimetype || file.mime_type || ""),
    url: httpsOrHttp(file.url_private_download) || httpsOrHttp(file.url_private) || "",
    size: Number(file.size) || 0,
  };
}
