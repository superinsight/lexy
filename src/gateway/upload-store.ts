const UPLOAD_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000;

type UploadEntry = {
  data: Buffer;
  mimeType: string;
  fileName: string;
  createdAt: number;
};

const store = new Map<string, UploadEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    store.forEach((entry, id) => {
      if (now - entry.createdAt > UPLOAD_TTL_MS) {
        store.delete(id);
      }
    });
    if (store.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function storeUpload(data: Buffer, mimeType: string, fileName: string): string {
  const id = crypto.randomUUID();
  store.set(id, { data, mimeType, fileName, createdAt: Date.now() });
  ensureCleanupTimer();
  return id;
}

/**
 * Retrieve and consume an upload. Returns null if not found or expired.
 * The entry is deleted after retrieval (single-use).
 */
export function consumeUpload(
  uploadId: string,
): { data: Buffer; mimeType: string; fileName: string } | null {
  const entry = store.get(uploadId);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.createdAt > UPLOAD_TTL_MS) {
    store.delete(uploadId);
    return null;
  }
  store.delete(uploadId);
  return { data: entry.data, mimeType: entry.mimeType, fileName: entry.fileName };
}
