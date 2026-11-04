/** Test-only fixture protocol. Never import this file from production src/. */
import { readFileSync } from 'fs';
import { resolve, sep } from 'path';
import type {
  ContextSnippet, GateContext, Omission, PublicationReceipt,
  ReviewInput, ReviewResult, ReadFileAtRef,
} from '../../src/review/contracts';

export interface Snapshot {
  file: string;
  ref: string;
  contentFile?: string;
  error?: 'NOT_FOUND' | 'FORBIDDEN';
}
export type ModelAttempt = {
  file: string;
  outcome: 'response' | 'timeout' | 'rate-limit' | 'service-error';
  content: string | null;
  choices: number;
  elapsedMs: number;
  usage: { inputTokens: number; outputTokens: number } | null;
};
export interface SprintFixture {
  id: string;
  title: string;
  owners: string[];
  split: 'development' | 'reserved';
  purpose: string;
  input: ReviewInput;
  /** Raw invalid configurations deliberately appear in configuration error cases. */
  config: unknown;
  snapshots: Snapshot[];
  modelAttempts: ModelAttempt[];
  gateContext: GateContext;
  preflight: {
    measuredInputTokens: number | null;
    remainingCalls: number | null;
    remainingAnalysisMs?: number | null;
  };
  github: {
    existingCommentId: number | null;
    publishError: string | null;
  };
  expected: {
    context: { snippets: ContextSnippet[]; omissions: Omission[] };
    result: ReviewResult;
    publication: PublicationReceipt;
    report: { contains: string[]; mustNotContain: string[]; maxCharacters: number; action: string };
    shouldCallModel: boolean;
    configValid: boolean;
  };
  notes: string[];
}
export interface FixtureEntry { id: string; file: string; owners: string[]; split: 'development' | 'reserved' }
export const fixtureRoot = resolve(__dirname, '../fixtures/sprint1');
export const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, 'manifest.json'), 'utf8')) as {
  schemaVersion: string; scenarios: FixtureEntry[];
};
function confinedPath(base: string, file: string): string {
  const target = resolve(base, file);
  if (!target.startsWith(base + sep)) throw new Error('Fixture path escapes its directory');
  return target;
}
export function loadFixture(entry: FixtureEntry): SprintFixture {
  return JSON.parse(readFileSync(confinedPath(fixtureRoot, entry.file), 'utf8')) as SprintFixture;
}
export function fixtureDirectory(entry: FixtureEntry): string {
  return resolve(confinedPath(fixtureRoot, entry.file), '..');
}
/** Reads actual snapshot files. A typo or wrong SHA must fail, never fall back to head. */
export function createSnapshotReader(fixture: SprintFixture, directory: string): ReadFileAtRef {
  return async (file, ref) => {
    const snapshot = fixture.snapshots.find((item) => item.file === file && item.ref === ref);
    if (!snapshot) throw new Error(`UNSCRIPTED_READ ${ref}:${file}`);
    if (snapshot.error) throw new Error(`${snapshot.error} ${ref}:${file}`);
    if (!snapshot.contentFile) throw new Error('Missing snapshot contentFile');
    return readFileSync(confinedPath(directory, snapshot.contentFile), 'utf8');
  };
}
/** Returns RAW scripted provider responses, never expected findings/risk/gate. */
export function createScriptedModel(fixture: SprintFixture) {
  let cursor = 0;
  return {
    async complete(file: string): Promise<ModelAttempt> {
      const attempt = fixture.modelAttempts[cursor];
      if (!attempt || attempt.file !== file) throw new Error(`UNSCRIPTED_CALL ${file}`);
      cursor += 1;
      if (attempt.outcome !== 'response') throw new Error(attempt.outcome);
      return JSON.parse(JSON.stringify(attempt)) as ModelAttempt;
    },
    get calls() { return cursor; },
  };
}
