import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import type { FirmwareFileAccess } from "./FirmwareFiles.js";
import { publishFirmwareExtraction } from "./FirmwarePublication.js";

it("returns the normalized published path for a decomposed source name", async () => {
  const outputDirectory = await createTestTempDirectory(
    "rea-firmware-publication-",
  );
  const sourceName = "cafe\u0301.txt";
  const publishedName = "café.txt";
  const digest = "a".repeat(64);
  const files = {
    hash: vi.fn(async () => digest),
    publish: vi.fn(async () => ({ relativePath: publishedName })),
  } as unknown as FirmwareFileAccess;

  const result = await publishFirmwareExtraction({
    files,
    workspacePath: outputDirectory,
    outputDirectory: join(outputDirectory, "published"),
    deadline: {
      phase: "publication",
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      expiresAtMs: performance.now() + 1_000,
    },
    analysisTimeoutMs: 1_000,
    entries: [
      {
        path: join(outputDirectory, sourceName),
        relativePath: sourceName,
        size: 6,
        kind: "file",
        linkTarget: null,
      },
    ],
    normalized: {
      files: new Map(),
      sizes: new Map(),
      chunks: [],
      derivations: [],
      depth_limited_paths: [],
      failed_extraction_stages: [],
      unclassified_ranges: [],
      diagnostics: [],
      missing_dependencies: [],
      chunk_missing_dependencies: [],
      coverage: "complete",
    },
    selection: { offset: 0, length: 6, sha256: digest },
    maxDepth: 3,
    engine: {
      name: "unblob",
      version: "fixture",
      executable_path: "/fixture/unblob",
      executable_sha256: digest,
      source_revision: null,
      worker_count: 1,
    },
    signal: new AbortController().signal,
    retainCleanup: vi.fn(),
  });

  expect(result.files).toMatchObject([
    {
      relative_path: publishedName,
      path: join(outputDirectory, "published", publishedName),
    },
  ]);
});
