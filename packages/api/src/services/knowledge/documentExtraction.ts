import { segmentDocumentText, type DocumentSegmentDraft } from "./knowledgeIngestion.js";

// Real document extraction (charter H3-B).
//
// Supported and VERIFIED formats only:
//   - text/markdown and plain text (heading/section locators);
//   - PDF via pdf-parse (page locators).
// Anything else reports an honest `unsupported` state — never an empty
// "success". Extracted text is untrusted data: it is segmented and stored,
// never executed, and rendered as plain text downstream.

export type DocumentExtractionResult =
  | { status: "ok"; segments: DocumentSegmentDraft[]; extractor: string }
  | { status: "unsupported"; reason: string }
  | { status: "failed"; reason: string };

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];
const MAX_DOCUMENT_BYTES = 25_000_000;

function looksLikeText(contentType: string | null, fileName: string | null): boolean {
  const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (TEXT_TYPES.has(type)) return true;
  const name = (fileName ?? "").toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function looksLikePdf(contentType: string | null, fileName: string | null, bytes: Buffer): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("application/pdf")) return true;
  if ((fileName ?? "").toLowerCase().endsWith(".pdf")) return true;
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Segment per-page PDF text with stable `Page N` locators. */
export function segmentPdfPages(pages: string[]): DocumentSegmentDraft[] {
  const segments: DocumentSegmentDraft[] = [];
  for (const [index, pageText] of pages.entries()) {
    const pageNumber = index + 1;
    const pageSegments = segmentDocumentText(pageText);
    for (const [partIndex, draft] of pageSegments.entries()) {
      segments.push({
        ordinal: segments.length,
        heading: draft.heading,
        locatorLabel:
          pageSegments.length === 1 ? `Page ${pageNumber}` : `Page ${pageNumber} (part ${partIndex + 1})`,
        content: draft.content
      });
    }
  }
  return segments;
}

export async function extractDocumentText(
  bytes: Buffer,
  contentType: string | null,
  fileName: string | null
): Promise<DocumentExtractionResult> {
  if (bytes.length === 0) {
    return { status: "failed", reason: "The stored document is empty." };
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return { status: "failed", reason: "The stored document exceeds the extraction size limit." };
  }

  if (looksLikePdf(contentType, fileName, bytes)) {
    try {
      // Import the library file directly: the package index runs a debug
      // block under ESM (module.parent is undefined) that reads a test file.
      const pdfModule = (await import("pdf-parse/lib/pdf-parse.js")) as unknown as {
        default: (data: Buffer, options?: Record<string, unknown>) => Promise<{ numpages: number; text: string }>;
      };
      const pdfParse = pdfModule.default ?? (pdfModule as unknown as typeof pdfModule.default);
      const pages: string[] = [];
      await pdfParse(bytes, {
        pagerender: (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) =>
          pageData.getTextContent().then((content) => {
            const text = content.items.map((item) => item.str).join(" ");
            pages.push(text);
            return text;
          })
      });
      const segments = segmentPdfPages(pages);
      if (segments.length === 0) {
        return {
          status: "failed",
          reason: "No extractable text found in the PDF (it may be image-only; OCR is not implemented)."
        };
      }
      return { status: "ok", segments, extractor: "pdf-parse" };
    } catch {
      return { status: "failed", reason: "PDF text extraction failed for this file." };
    }
  }

  if (looksLikeText(contentType, fileName)) {
    const text = bytes.toString("utf8").replace(/^﻿/, "");
    const segments = segmentDocumentText(text);
    if (segments.length === 0) {
      return { status: "failed", reason: "The stored text document contains no extractable content." };
    }
    return { status: "ok", segments, extractor: "text" };
  }

  return {
    status: "unsupported",
    reason: `Document extraction is implemented for text/markdown and PDF only; '${contentType ?? fileName ?? "unknown type"}' is not supported yet (DOCX/PPTX extraction is a future slice).`
  };
}
