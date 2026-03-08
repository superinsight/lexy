import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import { getBearerToken } from "./http-utils.js";
import { storeUpload } from "./upload-store.js";

const UPLOAD_PATH = "/api/chat/upload";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB raw file limit

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res: ServerResponse, req: IncomingMessage) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-File-Name");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export type UploadRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createUploadHttpHandler(deps: {
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
}): UploadRequestHandler {
  return async function handleUploadRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== UPLOAD_PATH) {
      return false;
    }

    setCorsHeaders(res, req);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST, OPTIONS");
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return true;
    }

    if (deps.resolvedAuth.mode !== "none") {
      const bearerToken = getBearerToken(req);
      const authResult = await authorizeHttpGatewayConnect({
        auth: deps.resolvedAuth,
        connectAuth: bearerToken ? { token: bearerToken, password: bearerToken } : null,
        req,
        trustedProxies: deps.trustedProxies ?? [],
        allowRealIpFallback: deps.allowRealIpFallback ?? false,
      });
      if (!authResult.ok) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return true;
      }
    }

    const fileName = decodeURIComponent((req.headers["x-file-name"] as string) || "upload");
    const mimeType = (req.headers["content-type"] || "application/octet-stream")
      .split(";")[0]
      .trim();

    let body: Buffer;
    try {
      body = await readRawBody(req, MAX_UPLOAD_BYTES);
    } catch {
      sendJson(res, 413, {
        ok: false,
        error: `file exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
      });
      return true;
    }

    if (body.length === 0) {
      sendJson(res, 400, { ok: false, error: "empty body" });
      return true;
    }

    const uploadId = storeUpload(body, mimeType, fileName);
    sendJson(res, 200, {
      ok: true,
      uploadId,
      fileName,
      mimeType,
      size: body.length,
    });
    return true;
  };
}
