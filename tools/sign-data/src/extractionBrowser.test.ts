import assert from 'node:assert/strict';
import test from 'node:test';
import { createExtractionBrowser } from './extractionBrowser.ts';

test('unsafe diagnostic scratch identifiers fail before allocation', async () => {
  for (const diagnosticRunId of ['../escape', 'a/b', 'a\\b', 'C:\\escape', '', '.runtime-x']) {
    await assert.rejects(createExtractionBrowser({ diagnosticRunId }), /Invalid diagnostic run identifier/);
  }
});
test('accepted and diagnostic scratch locations cannot be combined', async () => {
  await assert.rejects(createExtractionBrowser({ datasetVersion: 'smoke5-v2', diagnosticRunId: 'test-run' }), /exclusive/);
});
test('unreviewed accepted dataset versions fail before allocation', async () => {
  await assert.rejects(createExtractionBrowser({ datasetVersion: 'smoke5-v1' as 'smoke5-v2' }), /Unsupported accepted extraction version/);
});
