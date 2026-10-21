import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFile,
  contactBody,
  describeSlackFile,
  parseVcf,
  vcfFromContacts,
  whatsappMediaType,
} from "../convex/lib/files.js";

test("office files, pictures, and contact cards are the allowed kinds", () => {
  assert.deepEqual(classifyFile({ name: "rates.xlsx" }), { kind: "document", ext: "xlsx" });
  assert.deepEqual(classifyFile({ name: "note.docx" }), { kind: "document", ext: "docx" });
  assert.deepEqual(classifyFile({ name: "invoice.pdf", mimetype: "application/pdf" }), { kind: "document", ext: "pdf" });
  assert.deepEqual(classifyFile({ name: "card.vcf" }), { kind: "contact", ext: "vcf" });
  assert.equal(classifyFile({ name: "photo.jpeg", mimetype: "image/jpeg" }).kind, "image");
  assert.equal(classifyFile({ name: "scan.gif" }).ext, "gif");
  assert.equal(classifyFile({ name: "shot.heic", mimetype: "image/heic" }).kind, "image");
  assert.equal(classifyFile({ name: "clip.mp4", mimetype: "video/mp4" }), null);
  assert.equal(classifyFile({ name: "bundle.zip" }), null);

  assert.equal(whatsappMediaType(classifyFile({ name: "photo.jpg" })), "image");
  assert.equal(whatsappMediaType(classifyFile({ name: "photo.png" })), "image");
  assert.equal(whatsappMediaType(classifyFile({ name: "anim.gif" })), "document");
  assert.equal(whatsappMediaType(classifyFile({ name: "invoice.pdf" })), "document");
  assert.equal(whatsappMediaType(classifyFile({ name: "card.vcf" })), "contacts");
});

test("a slack file keeps its name and private link", () => {
  const file = describeSlackFile({
    name: "invoice.pdf",
    mimetype: "application/pdf",
    filetype: "pdf",
    size: 1200,
    url_private_download: "https://files.slack.com/files-pri/T1/download/invoice.pdf",
  });
  assert.equal(file.filename, "invoice.pdf");
  assert.equal(file.kind, "document");
  assert.equal(file.url, "https://files.slack.com/files-pri/T1/download/invoice.pdf");
  assert.equal(describeSlackFile({ name: "notes.txt", mimetype: "text/plain" }), null);
});

test("contact cards round-trip through vcard text", () => {
  const contacts = parseVcf(
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ravi Kumar\r\nN:Kumar;Ravi;;;\r\nTEL;TYPE=CELL:+919800001111\r\nEMAIL;TYPE=WORK:ravi@example.com\r\nORG:Acme\r\nEND:VCARD\r\n",
  );
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name.formatted_name, "Ravi Kumar");
  assert.equal(contacts[0].phones[0].phone, "+919800001111");
  assert.match(contactBody(contacts), /Acme/);
  const again = parseVcf(vcfFromContacts(contacts));
  assert.equal(again[0].name.formatted_name, "Ravi Kumar");
  assert.equal(again[0].phones[0].phone, "+919800001111");
  assert.equal(again[0].emails[0].email, "ravi@example.com");
  assert.equal(again[0].org.company, "Acme");
});
