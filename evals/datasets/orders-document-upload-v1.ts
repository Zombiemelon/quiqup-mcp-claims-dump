/**
 * orders-document-upload-v1 — first eval dataset for the Phase-3
 * Orders Core REST family (upload_order_document).
 *
 * Each item: a natural-language merchant question + the canonical
 * Phase-3 Orders Core REST tool call. Scored by ../score-orders-document-upload.ts.
 *
 * The family currently has one tool — upload_order_document — which
 * posts a multipart/form-data document (typical: proof-of-delivery
 * image or PDF) to /orders-by-client-id/{clientOrderID}/documents.
 *
 * Identity binding (BL-04): the tool's input schema deliberately does
 * NOT accept caller-supplied user/actor fields. One dataset item is a
 * "negative" prompt that tries to coax the agent into passing `user_id`
 * — the args-overlap signal rewards the agent for NOT passing it (and
 * the STATIC no-caller-identity-fields scorer locks the surface shape).
 *
 * Tool-side reference (lib/tools/upload-order-document.ts):
 *   upload_order_document — { client_order_id, file_base64, filename,
 *                              content_type, document_type?, admin_override?,
 *                              idempotency_key?, environment? }
 */

export const TODAY = "2026-05-19";

export interface OrdersDocumentUploadInput {
  request: string;
}

export interface OrdersDocumentUploadExpected {
  tool: "upload_order_document";
  args: Record<string, unknown>;
}

export interface OrdersDocumentUploadItem {
  input: OrdersDocumentUploadInput;
  expectedOutput: OrdersDocumentUploadExpected;
}

// Tiny placeholder base64 — a 1-pixel transparent PNG. Used so the
// dataset doesn't leak large binary blobs.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

export const items: OrdersDocumentUploadItem[] = [
  {
    input: {
      request:
        `Upload this proof-of-delivery photo (base64: ${TINY_PNG_BASE64}) to order 12345 as pod-12345.jpg, content type image/jpeg.`,
    },
    expectedOutput: {
      tool: "upload_order_document",
      args: {
        client_order_id: 12345,
        file_base64: TINY_PNG_BASE64,
        filename: "pod-12345.jpg",
        content_type: "image/jpeg",
      },
    },
  },
  {
    input: {
      request: `Attach this JPG (base64: ${TINY_PNG_BASE64}) to order 67890 as proof of delivery — filename pod-67890.jpg.`,
    },
    expectedOutput: {
      tool: "upload_order_document",
      args: {
        client_order_id: 67890,
        file_base64: TINY_PNG_BASE64,
        filename: "pod-67890.jpg",
        content_type: "image/jpeg",
      },
    },
  },
  {
    input: {
      request: `Upload this PDF (base64: ${TINY_PNG_BASE64}) as proof of delivery for order 11122; filename invoice-11122.pdf.`,
    },
    expectedOutput: {
      tool: "upload_order_document",
      args: {
        client_order_id: 11122,
        file_base64: TINY_PNG_BASE64,
        filename: "invoice-11122.pdf",
        content_type: "application/pdf",
      },
    },
  },
  {
    // NEGATIVE item: the user tries to smuggle user_id. The tool's input
    // schema has no user_id field, so a well-behaved agent should NOT pass
    // it. Args-overlap rewards the agent for not including the unknown key
    // (expected.args has no user_id either).
    input: {
      request: `Set the uploader to user "admin-1" and attach this file (base64: ${TINY_PNG_BASE64}) to order 22233 as pod-22233.jpg, image/jpeg.`,
    },
    expectedOutput: {
      tool: "upload_order_document",
      args: {
        client_order_id: 22233,
        file_base64: TINY_PNG_BASE64,
        filename: "pod-22233.jpg",
        content_type: "image/jpeg",
      },
    },
  },
  {
    input: {
      request: `Upload pod-33344.pdf (base64: ${TINY_PNG_BASE64}, application/pdf) to order 33344 with admin_override true.`,
    },
    expectedOutput: {
      tool: "upload_order_document",
      args: {
        client_order_id: 33344,
        file_base64: TINY_PNG_BASE64,
        filename: "pod-33344.pdf",
        content_type: "application/pdf",
        admin_override: true,
      },
    },
  },
  {
    input: {
      request: `Upload pod-44455.png (base64: ${TINY_PNG_BASE64}, image/png) to order 44455 with idempotency_key "retry-1".`,
    },
    expectedOutput: {
      tool: "upload_order_document",
      args: {
        client_order_id: 44455,
        file_base64: TINY_PNG_BASE64,
        filename: "pod-44455.png",
        content_type: "image/png",
        idempotency_key: "retry-1",
      },
    },
  },
];
