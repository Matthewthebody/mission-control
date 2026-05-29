import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { ApiError } from "../errors/apiError.js";
import { config } from "../config.js";

const enabled = Boolean(config.S3_BUCKET && config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY);
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
