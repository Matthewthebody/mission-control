import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { ApiError } from "../errors/apiError.js";
import { config } from "../config.js";

const enabled = [config.S3_BUCKET, config.AWS_ACCESS_KEY_ID, config.AWS_SECRET_ACCESS_KEY].every(isConfiguredStorageValue);
const ALLOWED_UPLOAD_TYPES = new Map<string, { extension: string; maxBytes: number }>([
  ["image/jpeg", { extension: ".jpg", maxBytes: 15_000_000 }],
  ["image/png", { extension: ".png", maxBytes: 15_000_000 }],
  ["image/heic", { extension: ".heic", maxBytes: 20_000_000 }],
  ["image/webp", { extension: ".webp", maxBytes: 15_000_000 }],
  ["application/pdf", { extension: ".pdf", maxBytes: 10_000_000 }]
]);

const client = enabled
  ? new S3Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY
      }
    })
  : null;

export async function createUploadPresign(input: {
  tenantId: string;
  userId: string;
  contentType: string;
  resourceType?: string | null;
  resourceId?: string | null;
}) {
  const normalizedContentType = input.contentType.trim().toLowerCase();
  const fileRule = ALLOWED_UPLOAD_TYPES.get(normalizedContentType);
  if (!fileRule) {
    throw new ApiError(400, "This file type is not allowed.");
  }
  const resourceType = sanitizePathSegment(input.resourceType ?? "general");
  const resourceId = sanitizePathSegment(input.resourceId ?? "unscoped");
  const storageKey = `tenants/${input.tenantId}/users/${input.userId}/${resourceType}/${resourceId}/${randomUUID()}${fileRule.extension}`;
  if (!client) {
    const objectUrl = `http://localhost:4566/mock-s3/${storageKey}`;
    return {
      url: "http://localhost:4566/mock-s3",
      fields: {
        key: storageKey,
        "Content-Type": normalizedContentType
      },
      storage_key: storageKey,
      object_url: objectUrl
    };
  }

  const presign = await createPresignedPost(client, {
    Bucket: config.S3_BUCKET,
    Key: storageKey,
    Conditions: [["content-length-range", 1, fileRule.maxBytes], ["eq", "$Content-Type", normalizedContentType]],
    Fields: {
      "Content-Type": normalizedContentType
    },
    Expires: 300
  });

  return {
    url: presign.url,
    fields: presign.fields,
    storage_key: storageKey,
    object_url: buildObjectUrl(presign.url, storageKey)
  };
}

export function assertManagedUploadStorageKey(tenantId: string, storageKey: string) {
  const normalized = storageKey.trim();
  const parsedExtension = extname(normalized).toLowerCase();
  const prefix = `tenants/${tenantId}/`;
  if (!normalized.startsWith(prefix)) {
    throw new ApiError(400, "The upload key does not belong to this tenant.");
  }
  if (!parsedExtension || ![...ALLOWED_UPLOAD_TYPES.values()].some((rule) => rule.extension === parsedExtension)) {
    throw new ApiError(400, "The upload key does not reference an allowed file type.");
  }
}

function sanitizePathSegment(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || "unscoped";
}

function buildObjectUrl(baseUrl: string, storageKey: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${storageKey}`;
}

function isConfiguredStorageValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !normalized.startsWith("replace_me");
}

// ---------------------------------------------------------------------------
// Server-side object read (Ask Bailey H3). Used by document extraction,
// transcription, and the protected media route. Honest not_configured state
// when storage credentials are absent; test-injectable via setStorageReader.
// ---------------------------------------------------------------------------
export type StoredObjectRead =
  | { status: "ok"; body: Buffer; contentType: string | null; contentLength: number }
  | { status: "not_configured"; reason: string }
  | { status: "not_found" }
  | { status: "failed"; reason: string };

export type StorageReader = (tenantId: string, storageKey: string) => Promise<StoredObjectRead>;

let storageReaderOverride: StorageReader | null = null;

/** Test seam: inject a fake reader (deterministic bytes, no network). */
export function setStorageReader(reader: StorageReader | null) {
  storageReaderOverride = reader;
}

export async function readStoredObject(tenantId: string, storageKey: string): Promise<StoredObjectRead> {
  if (storageReaderOverride) {
    return storageReaderOverride(tenantId, storageKey);
  }
  // Tenant boundary: a key outside the caller's tenant prefix is never read.
  if (!storageKey.startsWith(`tenants/${tenantId}/`)) {
    return { status: "not_found" };
  }
  if (!client) {
    return {
      status: "not_configured",
      reason: "Object storage is not configured (S3_BUCKET / AWS credentials)."
    };
  }
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const result = await client.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      return { status: "failed", reason: "Storage returned an empty body." };
    }
    return {
      status: "ok",
      body: Buffer.from(bytes),
      contentType: result.ContentType ?? null,
      contentLength: bytes.byteLength
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey" || name === "NotFound") {
      return { status: "not_found" };
    }
    return { status: "failed", reason: "Storage read failed." };
  }
}
