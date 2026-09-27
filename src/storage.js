import crypto from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultMediaRoot = path.join(__dirname, "..", "storage");
const bundledCinematicThumbnail = path.join(__dirname, "..", "assets", "seed", "cinematic-frames.png");

export const cinematicThumbnailStorageKey = "system/thumbnails/cinematic-frames.png";

export const mediaRoot = path.resolve(process.env.MEDIA_ROOT || defaultMediaRoot);
const configuredLimit = Number(process.env.MAX_UPLOAD_BYTES);
export const maxUploadBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
  ? configuredLimit
  : 20 * 1024 * 1024 * 1024;

fs.mkdirSync(mediaRoot, { recursive: true });

function checksumFileSync(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function seedCinematicThumbnail() {
  if (!fs.existsSync(bundledCinematicThumbnail)) {
    throw new Error(`Bundled cinematic thumbnail is missing: ${bundledCinematicThumbnail}`);
  }

  const destination = absoluteStoragePath(cinematicThumbnailStorageKey);
  const sourceChecksum = checksumFileSync(bundledCinematicThumbnail);
  const destinationIsCurrent = fs.existsSync(destination) && checksumFileSync(destination) === sourceChecksum;

  if (!destinationIsCurrent) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(bundledCinematicThumbnail, destination);
  }

  return sourceChecksum;
}

function normalizedExtension(originalName) {
  const extension = path.extname(path.basename(String(originalName || ""))).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : "";
}

export function safeOriginalName(value) {
  const name = path.basename(String(value || "resource"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (name || "resource").slice(0, 255);
}

function uploadStorage(folder) {
  return multer.diskStorage({
    destination(request, _file, callback) {
      const itemFolder = folder === "asset-library" ? "" : String(Number(request.params.id));
      const destination = path.join(mediaRoot, folder, itemFolder);
      fs.mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename(_request, file, callback) {
      callback(null, `${crypto.randomUUID()}${normalizedExtension(file.originalname)}`);
    }
  });
}

export const uploadResourceFile = multer({
  storage: uploadStorage("plans"),
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
    fields: 5,
    parts: 6,
    fieldNameSize: 80,
    fieldSize: 8 * 1024,
    headerPairs: 100
  },
  defParamCharset: "utf8"
}).single("file");

const libraryLimits = {
  fileSize: maxUploadBytes,
  files: 1,
  fields: 6,
  parts: 7,
  fieldNameSize: 80,
  fieldSize: 32 * 1024,
  headerPairs: 100
};

export const uploadPromptAssetFile = multer({
  storage: uploadStorage("prompt-library"),
  limits: libraryLimits,
  defParamCharset: "utf8"
}).single("file");

export const uploadAssetLibraryFile = multer({
  storage: uploadStorage("asset-library"),
  limits: libraryLimits,
  defParamCharset: "utf8"
}).single("file");

export function resourceKind(mimeType = "", originalName = "") {
  const mime = String(mimeType).toLowerCase();
  const extension = path.extname(String(originalName)).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || mime === "application/pdf" || [".pdf", ".doc", ".docx", ".txt", ".md", ".json", ".csv"].includes(extension)) return "document";
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(extension)) return "archive";
  return "other";
}

export function storageKeyForFile(filePath) {
  const key = path.relative(mediaRoot, path.resolve(filePath));
  if (!key || key.startsWith("..") || path.isAbsolute(key)) throw new Error("Invalid storage path");
  return key.split(path.sep).join("/");
}

export function absoluteStoragePath(storageKey) {
  const resolved = path.resolve(mediaRoot, String(storageKey || ""));
  if (resolved !== mediaRoot && !resolved.startsWith(`${mediaRoot}${path.sep}`)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

export const cinematicThumbnailChecksum = seedCinematicThumbnail();

export async function checksumFile(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function removeStoredFile(storageKey) {
  const filePath = absoluteStoragePath(storageKey);
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const inlineTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm"
]);

export function canPreviewInline(mimeType) {
  return inlineTypes.has(String(mimeType || "").toLowerCase());
}

export function contentDisposition(filename, inline = false) {
  const safeName = safeOriginalName(filename);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
