import { apiFetch } from "../api";
import type {
  CreateRecordResourceInput,
  RecordResourceItem,
  RecordResourceObjectType,
  RecordResourcesResponse
} from "../recordResourcesTypes";

type UploadPresignResponse = {
  url: string;
  fields: Record<string, string>;
  storage_key: string;
  object_url: string;
};

export async function listRecordResources(token: string, objectType: RecordResourceObjectType, objectId: string) {
  return apiFetch<RecordResourcesResponse>(`/api/record-resources/${objectType}/${objectId}`, token);
}

export async function createRecordResource(
  token: string,
  objectType: RecordResourceObjectType,
  objectId: string,
  input: CreateRecordResourceInput
) {
  return apiFetch<RecordResourceItem>(`/api/record-resources/${objectType}/${objectId}/items`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteRecordResource(
  token: string,
  objectType: RecordResourceObjectType,
  objectId: string,
  resourceId: string
) {
  return apiFetch<void>(`/api/record-resources/${objectType}/${objectId}/items/${resourceId}`, token, {
    method: "DELETE"
  });
}

export async function uploadRecordResourceFile(
  token: string,
  file: File,
  objectType: RecordResourceObjectType,
  objectId: string
) {
  const presign = await apiFetch<UploadPresignResponse>("/api/uploads/presign", token, {
    method: "POST",
    body: JSON.stringify({
      content_type: file.type || "application/octet-stream",
      resource_type: `record_resource_${objectType}`,
      resource_id: objectId
    })
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(presign.fields)) {
    form.append(key, value);
  }
  form.append("file", file);

  const uploadResponse = await fetch(presign.url, {
    method: "POST",
    body: form
  });
  if (!uploadResponse.ok) {
    throw new Error("We couldn't upload that file right now.");
  }

  return {
    storage_key: presign.storage_key,
    url: presign.object_url,
    content_type: file.type || null,
    file_size_bytes: file.size
  };
}
