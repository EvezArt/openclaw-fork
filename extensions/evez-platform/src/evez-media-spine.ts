import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type Segment = {
  id: string;
  kind: "transcript" | "ocr" | "caption" | "audio-event" | "video-event" | "image-region" | "metadata";
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
  sourceModel?: string;
};

type MediaAsset = {
  assetId: string;
  kind: "audio" | "video" | "image" | "document" | "other";
  uri: string;
  contentHash: string;
  mimeType?: string;
  title?: string;
  capturedAt?: string;
  rights: "user-owned" | "licensed" | "public-domain" | "consented" | "unknown";
  sensitivity: "public" | "personal" | "confidential" | "restricted";
  segments: Segment[];
  derivativeOf?: string;
  createdAt: string;
};

type MediaIndex = { version: 1; assets: MediaAsset[] };

const segmentSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: Type.Union([
    Type.Literal("transcript"),
    Type.Literal("ocr"),
    Type.Literal("caption"),
    Type.Literal("audio-event"),
    Type.Literal("video-event"),
    Type.Literal("image-region"),
    Type.Literal("metadata"),
  ]),
  text: Type.String(),
  startMs: Type.Optional(Type.Integer({ minimum: 0 })),
  endMs: Type.Optional(Type.Integer({ minimum: 0 })),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  sourceModel: Type.Optional(Type.String()),
});

export const MediaSpineParameters = Type.Object({
  action: Type.Union([Type.Literal("register"), Type.Literal("search"), Type.Literal("lineage"), Type.Literal("stats")]),
  asset: Type.Optional(
    Type.Object({
      assetId: Type.Optional(Type.String()),
      kind: Type.Union([Type.Literal("audio"), Type.Literal("video"), Type.Literal("image"), Type.Literal("document"), Type.Literal("other")]),
      uri: Type.String({ minLength: 1 }),
      contentHash: Type.String({ minLength: 8 }),
      mimeType: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      capturedAt: Type.Optional(Type.String()),
      rights: Type.Union([
        Type.Literal("user-owned"),
        Type.Literal("licensed"),
        Type.Literal("public-domain"),
        Type.Literal("consented"),
        Type.Literal("unknown"),
      ]),
      sensitivity: Type.Union([Type.Literal("public"), Type.Literal("personal"), Type.Literal("confidential"), Type.Literal("restricted")]),
      segments: Type.Array(segmentSchema),
      derivativeOf: Type.Optional(Type.String()),
    }),
  ),
  query: Type.Optional(Type.String()),
  assetId: Type.Optional(Type.String()),
  includeRestricted: Type.Optional(Type.Boolean()),
});

function spineFile(api: OpenClawPluginApi): string {
  const workspace = api.config?.agents?.defaults?.workspace ?? process.cwd();
  return path.join(workspace, ".evez", "media-spine.json");
}

async function load(file: string): Promise<MediaIndex> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as MediaIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, assets: [] };
    }
    throw error;
  }
}

async function save(file: string, index: MediaIndex): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(index)}\n`, "utf8");
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function redactRestricted(asset: MediaAsset): Omit<MediaAsset, "segments"> & { segments: Segment[] } {
  if (asset.sensitivity !== "restricted") {
    return asset;
  }
  return {
    ...asset,
    uri: "[restricted asset withheld]",
    segments: asset.segments.map((segment) => ({ ...segment, text: "[restricted content withheld]" })),
  };
}

export function createEvezMediaSpineTool(api: OpenClawPluginApi) {
  return {
    name: "evez-media-spine",
    description:
      "Register and search normalized audio, video, image, and document evidence with transcripts, OCR, captions, events, timestamps, hashes, rights, sensitivity, and derivative lineage.",
    parameters: MediaSpineParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const file = spineFile(api);
      const index = await load(file);
      const action = raw.action;

      if (action === "register") {
        if (!raw.asset || typeof raw.asset !== "object") {
          throw new Error("asset required for register");
        }
        const input = raw.asset as Omit<MediaAsset, "assetId" | "createdAt"> & { assetId?: string };
        if (input.rights === "unknown" && input.sensitivity !== "public") {
          throw new Error("rights must be established before registering non-public media");
        }
        const asset: MediaAsset = {
          ...input,
          assetId: input.assetId ?? `asset-${digest(input).slice(0, 20)}`,
          createdAt: new Date().toISOString(),
        };
        const next = { ...index, assets: [...index.assets.filter((item) => item.assetId !== asset.assetId), asset] };
        await save(file, next);
        const result = {
          action,
          asset: redactRestricted(asset),
          lineageHash: digest({ assetId: asset.assetId, contentHash: asset.contentHash, derivativeOf: asset.derivativeOf ?? null }),
          nextStep: "Use a consented transcription, OCR, caption, or event extractor and register its output as segments with timestamps and sourceModel.",
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "stats") {
        const result = {
          action,
          file,
          assetCount: index.assets.length,
          byKind: Object.fromEntries(["audio", "video", "image", "document", "other"].map((kind) => [kind, index.assets.filter((asset) => asset.kind === kind).length])),
          segmentCount: index.assets.reduce((sum, asset) => sum + asset.segments.length, 0),
          restrictedCount: index.assets.filter((asset) => asset.sensitivity === "restricted").length,
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "lineage") {
        const assetId = String(raw.assetId ?? "");
        const chain: MediaAsset[] = [];
        let current = index.assets.find((asset) => asset.assetId === assetId);
        while (current) {
          chain.push(redactRestricted(current) as MediaAsset);
          current = current.derivativeOf ? index.assets.find((asset) => asset.assetId === current?.derivativeOf) : undefined;
        }
        const result = { action, assetId, chain, lineageHash: digest(chain.map((asset) => [asset.assetId, asset.contentHash])) };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      const query = normalizeText(String(raw.query ?? ""));
      const includeRestricted = raw.includeRestricted === true;
      const matches = index.assets
        .filter((asset) => includeRestricted || asset.sensitivity !== "restricted")
        .map((asset) => ({
          asset: redactRestricted(asset),
          segments: asset.segments.filter((segment) => !query || normalizeText(segment.text).includes(query)),
        }))
        .filter((match) => match.segments.length > 0 || !query);
      const result = { action, query, matches, notice: "Media interpretation is represented as attributable segments; generated summaries must preserve asset and segment references." };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
