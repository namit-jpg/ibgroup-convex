import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFile,
  contactBody,
  contentDisposition,
  describeInboundFile,
  filenameFromDisposition,
  describeSlackFile,
  parseVcf,
  refineFileFromBytes,
  sniffBytes,
  vcfFromContacts,
  whatsappContentType,
  whatsappMediaType,
} from "../convex/lib/files.js";

function officeZip(marker) {
  return new TextEncoder().encode(`PK\u0003\u0004[Content_Types].xml ${marker}`);
}

test("office files, pictures, and contact cards are the allowed kinds", () => {
  assert.deepEqual(classifyFile({ name: "rates.xlsx" }), { kind: "document", ext: "xlsx" });
  assert.deepEqual(classifyFile({ name: "note.docx" }), { kind: "document", ext: "docx" });
  assert.deepEqual(classifyFile({ name: "invoice.pdf", mimetype: "application/pdf" }), { kind: "document", ext: "pdf" });
  assert.deepEqual(classifyFile({ name: "card.vcf" }), { kind: "contact", ext: "vcf" });
  assert.equal(classifyFile({ name: "photo.jpeg", mimetype: "image/jpeg" }).kind, "image");
  assert.equal(classifyFile({ name: "scan.gif" }).ext, "gif");
  assert.equal(classifyFile({ name: "shot.heic", mimetype: "image/heic" }).kind, "image");
  assert.deepEqual(classifyFile({ name: "deck.pptx" }), { kind: "document", ext: "pptx" });
  assert.deepEqual(classifyFile({ name: "deck.ppt", mimetype: "application/vnd.ms-powerpoint" }), { kind: "document", ext: "ppt" });
  assert.deepEqual(classifyFile({ name: "shops.csv", mimetype: "text/csv" }), { kind: "document", ext: "csv" });
  assert.equal(classifyFile({ name: "clip.mp4", mimetype: "video/mp4" }), null);
  assert.equal(classifyFile({ name: "bundle.zip" }), null);

  assert.equal(whatsappMediaType(classifyFile({ name: "photo.jpg" })), "image");
  assert.equal(whatsappMediaType(classifyFile({ name: "photo.png" })), "image");
  assert.equal(whatsappMediaType(classifyFile({ name: "anim.gif" })), "document");
  assert.equal(whatsappMediaType(classifyFile({ name: "invoice.pdf" })), "document");
  assert.equal(whatsappMediaType(classifyFile({ name: "card.vcf" })), "contacts");
});

test("a download keeps the original filename", () => {
  const header = contentDisposition("FinalABISProShop - khamla.csv");
  assert.match(header, /filename="FinalABISProShop - khamla\.csv"/);
  assert.equal(whatsappContentType("csv", "text/csv"), "text/plain");
  assert.equal(whatsappContentType("pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
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

test("magic bytes recover the real type when the CDN has no name", () => {
  assert.deepEqual(sniffBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), { kind: "document", ext: "pdf" });
  assert.deepEqual(sniffBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { kind: "image", ext: "png" });
  assert.deepEqual(sniffBytes(officeZip("wordprocessingml.document")), { kind: "document", ext: "docx" });
  assert.deepEqual(sniffBytes(officeZip("xl/workbook.xml spreadsheetml")), { kind: "document", ext: "xlsx" });
  assert.deepEqual(sniffBytes(officeZip("ppt/presentation.xml presentationml")), { kind: "document", ext: "pptx" });
  const refined = refineFileFromBytes(
    { filename: "file", ext: "", mime: "application/octet-stream", kind: "document" },
    new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
  );
  assert.equal(refined.filename, "file.pdf");
  assert.equal(refined.ext, "pdf");
  assert.equal(refined.mime, "application/pdf");
});

test("a storage bin name takes csv when the type is already known", () => {
  const described = describeInboundFile({
    type: "document",
    filename: "6d65b48b-1111-4111-8111-111111111111.bin",
    message: "6d65b48b-1111-4111-8111-111111111111.bin",
    mime_type: "text/csv",
    media_url: "https://cdn.example/6d65b48b-1111-4111-8111-111111111111.bin",
  });
  const refined = refineFileFromBytes(described, new TextEncoder().encode("shop,city\nKhamla,Nagpur\n"));
  assert.equal(refined.filename, "6d65b48b-1111-4111-8111-111111111111.csv");
  assert.equal(refined.ext, "csv");
  const named = refineFileFromBytes(
    { filename: "FinalABISProShop - khamla.csv", ext: "csv", mime: "text/csv", kind: "document" },
    new TextEncoder().encode("shop,city\n"),
  );
  assert.equal(named.filename, "FinalABISProShop - khamla.csv");
});

test("a storage id loses to the WhatsApp filename nested in the provider payload", () => {
  const file = describeInboundFile({
    type: "document",
    message: "[document]",
    media: {
      filename: "3db17247-00cc-4e37-8ff3-a442d935c842.bin",
      url: "https://cdn.example/media/264/conversations/1/3db17247-00cc-4e37-8ff3-a442d935c842.bin",
    },
    raw: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    type: "document",
                    document: { filename: "IB_NEXT.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  });
  assert.equal(file.filename, "IB_NEXT.pptx");
  assert.equal(file.ext, "pptx");
  assert.equal(
    filenameFromDisposition("attachment; filename=\"FinalABISProShop - khamla.csv\""),
    "FinalABISProShop - khamla.csv",
  );
  const wrapped = describeInboundFile({
    type: "document",
    message: "[document]",
    media: { filename: "6b305625-bb0b-42c2-af6d-87541ab07217.bin" },
    content: JSON.stringify({ filename: "open ai - ad.docx" }),
    media_url: "https://cdn.example/6b305625-bb0b-42c2-af6d-87541ab07217.bin",
  });
  assert.equal(wrapped.filename, "open ai - ad.docx");
});

test("a mime type is not used as the filename", () => {
  const word = describeInboundFile({
    type: "document",
    message: "[document]",
    filename: "5f0b603c-9a1f-4bc2-bb3b-61247a49bd24.bin",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    media_url: "https://cdn.example/5f0b603c-9a1f-4bc2-bb3b-61247a49bd24.bin",
  });
  assert.equal(word.filename, "5f0b603c-9a1f-4bc2-bb3b-61247a49bd24.bin");
  assert.equal(word.ext, "docx");
  const sheet = describeInboundFile({
    type: "document",
    message: "[document]",
    media: { filename: "80a3372a-2206-48e2-a634-ce2dd21dc1d1.bin" },
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    media_url: "https://cdn.example/80a3372a-2206-48e2-a634-ce2dd21dc1d1.bin",
  });
  assert.equal(sheet.filename, "80a3372a-2206-48e2-a634-ce2dd21dc1d1.bin");
  assert.equal(sheet.ext, "xlsx");
});

test("a stored uuid name loses to the filename the customer sent", () => {
  const file = describeInboundFile({
    type: "document",
    filename: "78fb2b91-124e-4965-b22b-b08ff4f34b2c.bin",
    message: "78fb2b91-124e-4965-b22b-b08ff4f34b2c.bin",
    document: { filename: "FinalABISProShop - Manish nagar - Copy.xlsx" },
    media_url: "https://cdn.example/78fb2b91-124e-4965-b22b-b08ff4f34b2c.bin",
  });
  assert.equal(file.filename, "FinalABISProShop - Manish nagar - Copy.xlsx");
  assert.equal(file.ext, "xlsx");
  assert.equal(file.caption, "");
  const kept = refineFileFromBytes(file, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  assert.equal(kept.filename, "FinalABISProShop - Manish nagar - Copy.xlsx");
});

test("a WhatsApp document without a filename is still a file, not a link", () => {
  const file = describeInboundFile({
    type: "document",
    media_url: "https://cdn.example/media/abc123",
  });
  assert.equal(file.kind, "document");
  assert.equal(file.filename, "file");
  assert.equal(file.url, "https://cdn.example/media/abc123");
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
