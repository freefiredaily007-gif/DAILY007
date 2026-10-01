import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Api } from "./api";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadWalletImage(
  asset: ImagePicker.ImagePickerAsset,
  purpose: "payment-proof" | "wallet-qr",
): Promise<string> {
  const contentType = String(asset.mimeType || "image/jpeg").toLowerCase();
  const size = Number(asset.fileSize || 0);
  if (!size || size > MAX_IMAGE_BYTES) throw new Error("Choose an image smaller than 6 MB.");
  if (!IMAGE_TYPES.includes(contentType)) throw new Error("Choose a JPG, PNG, or WebP image.");

  const upload = await Api.walletUploadUrl({ purpose, contentType, size });
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    const response = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!response.ok) throw new Error("Image upload failed. Please try again.");
  } else {
    const response = await FileSystem.uploadAsync(upload.uploadUrl, asset.uri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": contentType },
    });
    if (response.status < 200 || response.status >= 300) throw new Error("Image upload failed. Please try again.");
  }
  return String(upload.objectPath);
}