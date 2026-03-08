import type { ChatAttachment } from "../chat-attachments.js";
import { consumeUpload } from "../upload-store.js";

export type RpcAttachmentInput = {
  type?: unknown;
  mimeType?: unknown;
  fileName?: unknown;
  content?: unknown;
  uploadId?: unknown;
};

export function normalizeRpcAttachmentsToChatAttachments(
  attachments: RpcAttachmentInput[] | undefined,
): ChatAttachment[] {
  return (
    attachments
      ?.map((a) => {
        // Resolve upload references from the HTTP upload store
        if (typeof a?.uploadId === "string" && a.uploadId) {
          const upload = consumeUpload(a.uploadId);
          if (!upload) {
            return {
              type: typeof a.type === "string" ? a.type : undefined,
              mimeType: typeof a.mimeType === "string" ? a.mimeType : undefined,
              fileName: typeof a.fileName === "string" ? a.fileName : undefined,
              content: undefined,
            };
          }
          return {
            type: typeof a.type === "string" ? a.type : undefined,
            mimeType: upload.mimeType,
            fileName: upload.fileName,
            content: upload.data.toString("base64"),
          };
        }

        return {
          type: typeof a?.type === "string" ? a.type : undefined,
          mimeType: typeof a?.mimeType === "string" ? a.mimeType : undefined,
          fileName: typeof a?.fileName === "string" ? a.fileName : undefined,
          content:
            typeof a?.content === "string"
              ? a.content
              : ArrayBuffer.isView(a?.content)
                ? Buffer.from(
                    a.content.buffer,
                    a.content.byteOffset,
                    a.content.byteLength,
                  ).toString("base64")
                : a?.content instanceof ArrayBuffer
                  ? Buffer.from(a.content).toString("base64")
                  : undefined,
        };
      })
      .filter((a) => a.content) ?? []
  );
}
