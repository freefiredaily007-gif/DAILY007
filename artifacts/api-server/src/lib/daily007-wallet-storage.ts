import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
export const MAX_WALLET_IMAGE_BYTES = 6 * 1024 * 1024;
const PRIVATE_STORAGE = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

function configuredPrivateDir(): string {
  const value = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!value) throw new Error("Private object storage is not configured.");
  return value.replace(/^gs:\/\//, "").replace(/^\/+|\/+$/g, "");
}

function splitObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.replace(/^gs:\/\//, "").replace(/^\/+|\/+$/g, "");
  const slash = normalized.indexOf("/");
  if (slash < 1 || slash === normalized.length - 1) {
    throw new Error("Invalid object storage path.");
  }
  return { bucketName: normalized.slice(0, slash), objectName: normalized.slice(slash + 1) };
}

async function signedUrl(
  path: string,
  method: "GET" | "PUT" | "HEAD",
  ttlSeconds: number,
): Promise<string> {
  const { bucketName, objectName } = splitObjectPath(path);
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object storage could not sign the ${method} URL (${response.status}).`);
  const result = await response.json() as { signed_url?: unknown };
  if (typeof result.signed_url !== "string" || !result.signed_url.startsWith("https://")) {
    throw new Error("Object storage returned an invalid signed URL.");
  }
  return result.signed_url;
}

export function isWalletObjectPath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/objects/uploads/daily007/") &&
    !path.includes("..") && !path.includes("\\");
}

export function isDaily007PaymentProofObjectPath(path: unknown, userId: string): path is string {
  const prefix = `/objects/uploads/daily007/payment-proofs/${userId}/`;
  return isWalletObjectPath(path) && path.startsWith(prefix) &&
    UUID_FILE.test(path.slice(prefix.length));
}

function fullPathFromEntity(objectPath: string): string {
  if (!isWalletObjectPath(objectPath)) throw new Error("Invalid wallet image path.");
  const relative = objectPath.slice("/objects/".length);
  return `${configuredPrivateDir()}/${relative}`;
}

export async function deleteDaily007PaymentProofObject(objectPath: string, userId: string): Promise<void> {
  if (!isDaily007PaymentProofObjectPath(objectPath, userId)) {
    throw new Error("Payment proof path is invalid or does not belong to this account.");
  }
  const fullPath = fullPathFromEntity(objectPath);
  const slash = fullPath.indexOf("/");
  if (slash < 1 || slash === fullPath.length - 1) {
    throw new Error("Payment proof storage path is invalid.");
  }
  const bucketName = fullPath.slice(0, slash);
  const objectName = fullPath.slice(slash + 1);
  await PRIVATE_STORAGE.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
}

export async function createWalletImageUpload({
  userId,
  purpose,
  contentType,
  size,
}: {
  userId: string;
  purpose: "payment-proof" | "wallet-qr";
  contentType: string;
  size: number;
}): Promise<{ uploadUrl: string; objectPath: string }> {
  const extension = ALLOWED_TYPES.get(contentType);
  if (!extension) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_WALLET_IMAGE_BYTES) {
    throw new Error("Image must be smaller than 6 MB.");
  }
  const folder = purpose === "payment-proof"
    ? `payment-proofs/${userId}`
    : "wallet-qr";
  const relativePath = `uploads/daily007/${folder}/${randomUUID()}.${extension}`;
  const fullPath = `${configuredPrivateDir()}/${relativePath}`;
  return {
    uploadUrl: await signedUrl(fullPath, "PUT", 15 * 60),
    objectPath: `/objects/${relativePath}`,
  };
}

export async function createWalletImageReadUrl(objectPath: string, ttlSeconds = 5 * 60): Promise<string> {
  return signedUrl(fullPathFromEntity(objectPath), "GET", ttlSeconds);
}

export async function validateUploadedWalletImage(
  objectPath: string,
  expectedOwnerId?: string,
): Promise<{ contentType: string; size: number }> {
  if (!isWalletObjectPath(objectPath)) throw new Error("A valid uploaded wallet image is required.");
  if (expectedOwnerId && !objectPath.startsWith(`/objects/uploads/daily007/payment-proofs/${expectedOwnerId}/`)) {
    throw new Error("The payment proof must belong to the signed-in account.");
  }

  const path = fullPathFromEntity(objectPath);
  const headUrl = await signedUrl(path, "HEAD", 60);
  const head = await fetch(headUrl, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
  if (!head.ok) throw new Error("Upload the payment image before submitting the request.");
  const contentType = head.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const size = Number(head.headers.get("content-length"));
  if (!ALLOWED_TYPES.has(contentType) || !Number.isSafeInteger(size) || size < 1 || size > MAX_WALLET_IMAGE_BYTES) {
    throw new Error("The uploaded file must be a JPG, PNG, or WebP image smaller than 6 MB.");
  }

  const readUrl = await signedUrl(path, "GET", 60);
  const sample = await fetch(readUrl, {
    headers: { Range: "bytes=0-15" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!sample.ok) throw new Error("Could not verify the uploaded image.");
  const bytes = new Uint8Array(await sample.arrayBuffer());
  const valid = contentType === "image/jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : contentType === "image/png"
      ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      : contentType === "image/webp"
        ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
        : false;
  if (!valid) throw new Error("The uploaded file does not contain a valid image.");
  return { contentType, size };
}