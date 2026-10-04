import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
export const MAX_PAYMENT_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const PAYMENT_SCREENSHOT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class PaymentScreenshotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PaymentScreenshotError";
  }
}

const STAGING_PATH_PATTERN = /^\/objects\/payments\/staging\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function privateObjectLocation() {
  const directory = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!directory) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured for private payment screenshots.");
  }
  const segments = directory.replace(/^\/+/, "").split("/");
  const bucketName = segments.shift();
  if (!bucketName || segments.some((segment) => !segment)) {
    throw new Error("PRIVATE_OBJECT_DIR is not a valid private object directory.");
  }
  return { bucketName, prefix: segments.join("/") };
}

function locationForScreenshotPath(path: string, userId: string) {
  const match = path.match(STAGING_PATH_PATTERN);
  if (!match || match[1] !== userId) {
    throw new PaymentScreenshotError("Screenshot path is invalid or does not belong to this account.", 403);
  }
  const { bucketName, prefix } = privateObjectLocation();
  return {
    bucketName,
    objectName: [prefix, "payments", "staging", userId, match[2]].filter(Boolean).join("/"),
  };
}

export function confirmedPaymentScreenshotPath(userId: string, stagingPath: string) {
  const match = stagingPath.match(STAGING_PATH_PATTERN);
  if (!match || match[1] !== userId) {
    throw new PaymentScreenshotError("Screenshot path is invalid or does not belong to this account.", 403);
  }
  const confirmedPath = `/objects/payment-receipts/confirmed/${userId}/${match[2]}`;
  locationForConfirmedScreenshotPath(confirmedPath, userId);
  return confirmedPath;
}

function locationForConfirmedScreenshotPath(path: string, userId: string) {
  const match = path.match(/^\/objects\/payment-receipts\/confirmed\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (!match || match[1] !== userId) {
    throw new PaymentScreenshotError("Screenshot path is invalid or does not belong to this account.", 403);
  }
  const { bucketName, prefix } = privateObjectLocation();
  return {
    bucketName,
    objectName: [prefix, "payment-receipts", "confirmed", userId, match[2]].filter(Boolean).join("/"),
  };
}

async function signObjectUrl(bucketName: string, objectName: string, method: "PUT" | "GET") {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to sign private payment screenshot URL (${response.status}).`);
  }
  const payload = await response.json() as { signed_url?: unknown };
  if (typeof payload.signed_url !== "string") {
    throw new Error("Object storage returned an invalid signed URL.");
  }
  return payload.signed_url;
}

export async function createPaymentScreenshotUpload(userId: string) {
  const uuid = randomUUID();
  const screenshotPath = `/objects/payments/staging/${userId}/${uuid}`;
  const { bucketName, objectName } = locationForScreenshotPath(screenshotPath, userId);
  return { uploadUrl: await signObjectUrl(bucketName, objectName, "PUT"), screenshotPath };
}

function mimeFromImageSignature(contents: Buffer): string | null {
  if (contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff) {
    return "image/jpeg";
  }
  if (contents.length >= 8 &&
      contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (contents.length >= 12 &&
      contents.toString("ascii", 0, 4) === "RIFF" &&
      contents.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function snapshotPaymentScreenshot(userId: string, stagingPath: string) {
  const { bucketName, objectName } = locationForScreenshotPath(stagingPath, userId);
  const bucket = objectStorageClient.bucket(bucketName);
  const sourceFile = bucket.file(objectName);
  const confirmedPath = confirmedPaymentScreenshotPath(userId, stagingPath);
  const destination = locationForConfirmedScreenshotPath(confirmedPath, userId);
  const confirmedFile = bucket.file(destination.objectName);
  let metadata: { contentType?: string; size?: string | number };
  try {
    await sourceFile.copy(confirmedFile);
    [metadata] = await confirmedFile.getMetadata();
  } catch (cause) {
    if (String((cause as { code?: unknown })?.code) === "404") {
      throw new PaymentScreenshotError("Uploaded screenshot was not found.", 400);
    }
    throw cause;
  }
  const size = Number(metadata.size);
  if (!PAYMENT_SCREENSHOT_TYPES.has(metadata.contentType ?? "") ||
      !Number.isFinite(size) || size <= 0 || size > MAX_PAYMENT_SCREENSHOT_BYTES) {
    await confirmedFile.delete({ ignoreNotFound: true });
    throw new PaymentScreenshotError("Screenshot must be a JPEG, PNG, or WebP image no larger than 5 MB.", 400);
  }

  const [contents] = await confirmedFile.download();
  if (mimeFromImageSignature(contents) !== metadata.contentType) {
    await confirmedFile.delete({ ignoreNotFound: true });
    throw new PaymentScreenshotError("Screenshot bytes do not match the uploaded image MIME type.", 400);
  }
  return confirmedPath;
}

export async function createPaymentScreenshotReadUrl(screenshotPath: string, userId: string) {
  const { bucketName, objectName } = locationForConfirmedScreenshotPath(screenshotPath, userId);
  return signObjectUrl(bucketName, objectName, "GET");
}