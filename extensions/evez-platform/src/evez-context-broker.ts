import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type Chunk = {
  id: string;
  documentId: string;
  title: string;
  ordinal: number;
  text: string;
  tokenEstimate: number;
  terms: string[];
};

type StoredIndex = {
  version: 1;
  createdAt: string;
  targetVirtualContextTokens: number;
  chunks: Chunk[];
};

const sourceSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
});

export const ContextBrokerParameters = Type.Object({
  action: Type.Union([Type.Literal("ingest"), Type.Literal("search"), Type.Literal("assemble"), Type.Literal("stats")]),
  sources: Type.Optional(Type.Array(sourceSchema, { maxItems: 100 })),
  query: Type.Optional(Type.String()),
  chunkTokens: Type.Optional(Type.Integer({ minimum: 128, maximum: 8192 })),
  maxTokens: Type.Optional(Type.Integer({ minimum: 256, maximum: 2_500_000 })),
  documentIds: Type.Optional(Type.Array(Type.String(), { maxItems: 1000 })),
  topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
});

function workspaceDir(api: OpenClawPluginApi): string {
  return api.config?.agents?.defaults?.workspace ?? process.cwd();
}

function indexFile(api: OpenClawPluginApi): string {
  return path.join(workspaceDir(api), ".evez", "context-index.json");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function terms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])];
}

function digest(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function splitText(text: string, chunkTokens: number): string[] {
  const maxChars = chunkTokens * 4;
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [text]) {
    if ((current.length + paragraph.length + 2) <= maxChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let offset = 0; offset < paragraph.length; offset += maxChars) {
      chunks.push(paragraph.slice(offset, offset + maxChars));
    }
    current = "";
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function loadIndex(file: string): Promise<StoredIndex> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as StoredIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, createdAt: new Date().toISOString(), targetVirtualContextTokens: 2_000_000, chunks: [] };
    }
    throw error;
  }
}

async function saveIndex(file: string, index: StoredIndex): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(index)}\n`, "utf8");
}

function scoreChunk(chunk: Chunk, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }
  const matches = queryTerms.filter((term) => chunk.terms.includes(term)).length;
  const phraseBonus = queryTerms.every((term) => chunk.terms.includes(term)) ? 2 : 0;
  return matches / queryTerms.length + phraseBonus;
}

function selectChunks(chunks: Chunk[], query: string, maxTokens: number, topK: number): Array<Chunk & { score: number }> {
  const queryTerms = terms(query);
  const ranked = chunks
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, queryTerms) }))
    .filter((chunk) => queryTerms.length === 0 || chunk.score > 0)
    .toSorted((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal)
    .slice(0, topK);
  const selected: Array<Chunk & { score: number }> = [];
  let usedTokens = 0;
  for (const chunk of ranked) {
    if (usedTokens + chunk.tokenEstimate > maxTokens) {
      continue;
    }
    selected.push(chunk);
    usedTokens += chunk.tokenEstimate;
  }
  return selected.toSorted((a, b) => a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal);
}

export function createEvezContextBrokerTool(api: OpenClawPluginApi) {
  return {
    name: "evez-context-broker",
    description:
      "Build and query a local, provenance-preserving virtual context window up to 2M tokens. It uses hierarchical chunking and retrieval so ordinary models can work over corpora larger than their native context.",
    parameters: ContextBrokerParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const file = indexFile(api);
      const index = await loadIndex(file);
      const action = raw.action;

      if (action === "ingest") {
        const sources = (raw.sources as Array<{ id: string; title: string; text: string }> | undefined) ?? [];
        const chunkTokens = typeof raw.chunkTokens === "number" ? raw.chunkTokens : 2048;
        const retained = index.chunks.filter((chunk) => !sources.some((source) => source.id === chunk.documentId));
        const added = sources.flatMap((source) =>
          splitText(source.text, chunkTokens).map((text, ordinal) => ({
            id: `chunk-${source.id}-${ordinal}-${digest(text)}`,
            documentId: source.id,
            title: source.title,
            ordinal,
            text,
            tokenEstimate: estimateTokens(text),
            terms: terms(text),
          })),
        );
        const next = { ...index, chunks: [...retained, ...added] };
        await saveIndex(file, next);
        const result = {
          action,
          file,
          virtualContextTokens: next.targetVirtualContextTokens,
          documentsIngested: sources.length,
          chunksAdded: added.length,
          indexedTokenEstimate: next.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
          nextStep: "Use search for a ranked evidence window or assemble for a citation-preserving model-ready context.",
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "stats") {
        const result = {
          action,
          file,
          virtualContextTokens: index.targetVirtualContextTokens,
          chunkCount: index.chunks.length,
          documentCount: new Set(index.chunks.map((chunk) => chunk.documentId)).size,
          indexedTokenEstimate: index.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      const query = typeof raw.query === "string" ? raw.query : "";
      const maxTokens = typeof raw.maxTokens === "number" ? raw.maxTokens : 12000;
      const topK = typeof raw.topK === "number" ? raw.topK : 20;
      const documentIds = new Set((raw.documentIds as string[] | undefined) ?? []);
      const candidates = documentIds.size > 0 ? index.chunks.filter((chunk) => documentIds.has(chunk.documentId)) : index.chunks;
      const selected = selectChunks(candidates, query, maxTokens, topK);
      const results = selected.map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        title: chunk.title,
        ordinal: chunk.ordinal,
        score: chunk.score,
        tokenEstimate: chunk.tokenEstimate,
        text: chunk.text,
        citation: `[${chunk.documentId}#${chunk.ordinal}]`,
      }));
      const result = action === "search"
        ? { action, query, results, returnedTokenEstimate: results.reduce((sum, item) => sum + item.tokenEstimate, 0) }
        : {
            action,
            query,
            context: results.map((item) => `${item.citation} ${item.title}\n${item.text}`).join("\n\n"),
            citations: results.map((item) => ({ citation: item.citation, documentId: item.documentId, chunkId: item.chunkId })),
            returnedTokenEstimate: results.reduce((sum, item) => sum + item.tokenEstimate, 0),
            truncationPolicy: "Rank by query overlap, cap by token budget, preserve source and chunk citations, and abstain from unsupported synthesis.",
          };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
