import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";

export type ParsedUpload = {
  fields: Record<string, string>;
  files: Array<{ fieldName: string; filename: string; path: string; size: number }>;
};

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^_+/, "") || "file";
}

function parseContentDisposition(header: string): { name: string; filename: string | null } {
  const name = /name="([^"]+)"/.exec(header)?.[1] ?? "";
  const filename = /filename="([^"]*)"/.exec(header)?.[1] ?? null;
  return { name, filename: filename && filename.length > 0 ? filename : null };
}

async function writeToStream(stream: WriteStream, chunk: Buffer): Promise<void> {
  if (chunk.length === 0) {
    return;
  }
  if (stream.write(chunk)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function closeWriteStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.once("error", reject);
  });
}

export async function parseMultipartUpload(req: Request, uploadDir: string): Promise<ParsedUpload> {
  const contentType = req.headers["content-type"] ?? "";
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1];
  if (!boundary) {
    throw new Error("multipart/form-data boundary is required");
  }

  await fs.mkdir(uploadDir, { recursive: true });
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const contentBoundaryBuffer = Buffer.from(`\r\n--${boundary}`);
  const fields: Record<string, string> = {};
  const files: ParsedUpload["files"] = [];
  let buffer = Buffer.alloc(0);
  let state: "initial" | "headers" | "content" | "done" = "initial";
  let current:
    | {
        fieldName: string;
        filename: string | null;
        chunks: Buffer[];
        stream: WriteStream | null;
        path: string | null;
        size: number;
      }
    | null = null;

  async function finishCurrent(content: Buffer): Promise<void> {
    if (!current) {
      return;
    }
    if (current.stream) {
      await writeToStream(current.stream, content);
      await closeWriteStream(current.stream);
      files.push({
        fieldName: current.fieldName,
        filename: current.filename ?? "upload.mp4",
        path: current.path ?? "",
        size: current.size + content.length,
      });
    } else {
      current.chunks.push(content);
      fields[current.fieldName] = Buffer.concat(current.chunks).toString("utf8");
    }
    current = null;
  }

  async function processBuffer(final = false): Promise<void> {
    while (state !== "done") {
      if (state === "initial") {
        const index = buffer.indexOf(boundaryBuffer);
        if (index === -1) {
          if (final) {
            state = "done";
          }
          return;
        }
        buffer = buffer.subarray(index + boundaryBuffer.length);
        if (buffer.subarray(0, 2).toString() === "\r\n") {
          buffer = buffer.subarray(2);
        }
        state = "headers";
      }

      if (state === "headers") {
        const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd === -1) {
          return;
        }

        const headerText = buffer.subarray(0, headerEnd).toString("utf8");
        buffer = buffer.subarray(headerEnd + 4);
        const disposition = headerText
          .split(/\r?\n/)
          .find((line) => line.toLowerCase().startsWith("content-disposition:"));
        if (!disposition) {
          throw new Error("Multipart part missing content-disposition");
        }

        const { name, filename } = parseContentDisposition(disposition);
        if (!name) {
          throw new Error("Multipart part missing name");
        }

        if (filename) {
          const storedName = `${safeName(path.basename(filename, path.extname(filename)))}_${randomUUID()}${path.extname(filename) || ".mp4"}`;
          const filePath = path.join(uploadDir, storedName);
          current = {
            fieldName: name,
            filename,
            chunks: [],
            stream: createWriteStream(filePath),
            path: filePath,
            size: 0,
          };
        } else {
          current = {
            fieldName: name,
            filename: null,
            chunks: [],
            stream: null,
            path: null,
            size: 0,
          };
        }
        state = "content";
      }

      if (state === "content") {
        const boundaryIndex = buffer.indexOf(contentBoundaryBuffer);
        if (boundaryIndex === -1) {
          const keepBytes = contentBoundaryBuffer.length + 4;
          if (buffer.length <= keepBytes && !final) {
            return;
          }
          const writableLength = final ? buffer.length : buffer.length - keepBytes;
          const writable = buffer.subarray(0, writableLength);
          if (current?.stream) {
            await writeToStream(current.stream, writable);
            current.size += writable.length;
          } else if (current) {
            current.chunks.push(writable);
          }
          buffer = buffer.subarray(writableLength);
          if (!final) {
            return;
          }
        } else {
          const content = buffer.subarray(0, boundaryIndex);
          await finishCurrent(content);
          buffer = buffer.subarray(boundaryIndex + contentBoundaryBuffer.length);
          if (buffer.subarray(0, 2).toString() === "--") {
            state = "done";
            return;
          }
          if (buffer.subarray(0, 2).toString() === "\r\n") {
            buffer = buffer.subarray(2);
          }
          state = "headers";
        }
      }
    }
  }

  for await (const chunk of req) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    await processBuffer();
  }
  await processBuffer(true);

  return { fields, files };
}
