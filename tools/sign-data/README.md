# MoSL v1 audit export

Offline audit, approved engineering-subset curation, and explicitly invoked landmark extraction tooling. It does not select a production/final MVP vocabulary, train models, or enter the application runtime. No additional dependencies or npm workspace changes are needed. Use the repository's installed TypeScript and Node 22.16+ with built-in experimental type stripping.

From `C:\Users\peaqock\ishara-ai`:

```powershell
npm --prefix tools/sign-data run test
npm --prefix tools/sign-data run typecheck
npm --prefix tools/sign-data run export
npm --prefix tools/sign-data run verify
```

The source and destination are fixed relative to this repository. Sources are read only under `data/scope5/source/mosl-v1/`; the nine generated artifacts go only to `data/scope5/audit/mosl-v1/`. All `data/scope5/` is Git-ignored. No raw source is renamed or rewritten.

The exporter is pinned to the two previously verified source SHA-256 aggregate digests. It stops before publishing if either digest or count differs. Per-file hashes and lightweight FFprobe properties are regenerated because the preceding read-only audit did not persist them. The successful full-decode result is carried forward only for identical source bytes; `nb_frames` header evidence is labelled separately. A full frame count is requested only if a container lacks it. Source integrity is checked again before export, and `verify` checks source bytes after export without decoding.

EXACT comparisons preserve raw Unicode. UNICODE_EQUIVALENT uses NFC solely as a comparison rule. Remaining suffix candidates are accepted only when unclaimed row/file associations are mutually unique and media properties agree. Numeric copy suffixes are not interpreted as linguistic variants. Ambiguous courtyard rows retain two candidates each. No duplicate is deleted or chosen as linguistically canonical.

The JSONL inventory counts candidate pairs: 2,218 records represent 2,216 metadata rows and 2,216 videos. Summary match counts are per metadata row. `usableForLaterCuration` means a resolved technical association with valid media and no combining-mark-only label; it does not mean approved meaning, identity, vocabulary, or training eligibility. All records retain `reviewRequired: true`.

Output strings preserve original filenames and labels. Ordering uses ordinal UTF-16 comparison, numeric source-row order, UTF-8 encoding and LF endings. An existing audit date is retained on rerun; stable outputs assume the same tool versions and source bytes. The exporter builds the package twice in memory to check determinism. Eight artifact hashes are recorded in `summary.json`, which is published last. `verify` rejects incomplete/mixed or modified packages.

No secrets or environment files are read. Production model directories are not ignored by this change. The audit package remains private/generated, while the small reusable tooling can be reviewed in Git.

## Five-sign engineering curation

After the audit export exists, run from the same repository root:

```powershell
npm --prefix tools/sign-data run curate:smoke5
npm --prefix tools/sign-data run verify:smoke5
```

The first command freezes `data/scope5/curation/mosl-v1/smoke5-v1/`: `vocabulary.json`, `samples.jsonl`, `exclusions.json`, `coverage.json`, and `review.md`. The second command verifies existing output without writing. Both reuse the completed audit and its checksum evidence; neither invokes FFprobe, MediaPipe, or training. All source hashes are checked against the two existing aggregates; selected rows are checked against their original CSV and each video against its audit SHA-256 and byte size. No source is copied or changed.

`curation.ts` owns the fixed class order, exact raw-label comparisons, sample eligibility and pure manifest generation. `curationFiles.ts` owns bounded reads, source verification and publication. `curate-smoke5.ts` is the narrow command entry point. No app imports or dependencies were added.

Sample IDs hash the version and exact source reference, not a translated label. Within-class duplicate content uses one eligible source reference ordered by ordinal CSV path, physical row number, then ordinal video path. Other copies remain explicit exclusions with all provenance. Content shared by different raw labels is excluded pending review. A class with fewer than two unique eligible recordings blocks freezing; alternatives require human choice. Missing or changed expected label counts also stop without normalization or substitution.

Class IDs and order are fixed for `mosl-smoke5-v1`. A rerun must produce byte-identical manifests or fail before replacing any existing output. Coverage hashes the other four files and is published last. Files are staged exclusively and linked atomically in the same directory; concurrent writers cannot overwrite each other. Partial publication can be resumed only if every existing artifact matches. A damaged or changed frozen artifact requires investigation and a reviewed version decision.

All classes remain linguistically unverified. The declared signer metadata is not verified identity and does not support signer-independent evaluation. This subset only prepares the next engineering phase; no vocabulary for production, split, landmarks, tensors, model, or browser integration is created.

## Explicit offline landmark extraction

From `C:\Users\peaqock\ishara-ai`:

```powershell
npm --prefix tools/sign-data run extract:smoke5
npm --prefix tools/sign-data run verify:landmarks
```

Only the extraction command runs MediaPipe. It requires the frozen 21-sample curation, installed FFmpeg/FFprobe, installed desktop Chrome or Edge, and the existing prepared Scope 4 model/WASM assets. It does not download a browser, install packages, scan for extra source videos, rerun the dataset audit, or change the vocabulary. A complete existing extraction is verified rather than repeated. An interrupted run resumes verified successful per-sample sequences from its progress report; failed samples are never substituted. A published output that fails validation requires explicit review, not overwriting.

`extractionModel.ts` validates curation and the existing `LandmarkFrame` type, selects presentation timestamps, and serializes frames. `extractionDecoder.ts` probes actual PTS/time-base and streams RGBA through bounded buffers. `extractionBrowser.ts` builds the small offline browser entry using installed Vite with application config, environment-file loading and public-directory serving disabled. A private loopback server serves only static runtime assets; frames travel in memory over the private browser connection. It reuses the unchanged Scope 4 worker, detector options, adapter, local model and WASM. The first recording uses the existing GPU-first/CPU fallback behavior; subsequent recordings force the selected delegate. Model/source/WASM hashes and graphics/runtime details are recorded.

`extractionFiles.ts` verifies selected source hashes, extracts detector-option provenance from the actual worker source, validates outputs, and writes only under `data/scope5/derived/mosl-v1/smoke5-v1/landmarks-v1/`. `extract-smoke5.ts` owns recording order, per-recording cleanup, progress, final publication and verification. Each selected frame is awaited before advancing; the live camera freshness discard is intentionally absent. The production camera, scheduler, UI and worker ownership are unchanged.

Outputs are `manifest.json`, `extraction-report.json`, `README.md`, and one JSONL in `samples/` per exact curated sample ID. The colon in a sample ID is percent-encoded in its filename for Windows compatibility; IDs inside the artifacts are unchanged. Actual PTS determines the greedy maximum-15-FPS selection, which may yield a lower cadence on discrete source grids. No 64-timestep resampling or classifier feature normalization occurs. The manifest records missing-anatomy coverage without excluding samples on that basis.

Normal focused tests use synthetic metadata, streams and landmarks, never the private videos or an installed browser. Run the existing tooling test/typecheck commands, plus `node node_modules/typescript/bin/tsc -p tools/sign-data/browser/tsconfig.json` from the repository root for the browser entry. The offline typecheck permits the existing production type file's parameter-property syntax; it is imported as a type only and is erased from Node execution. No Scope 4 source refactor was needed.

Decoded images are never written. The browser profile/build scratch directory is private and deleted after close. All raw source and frozen curation bytes remain unchanged. These outputs are raw tracking sequences only: no tensors, splits, trained model, ONNX, production vocabulary, or Sign-to-Text inference is created.

## Shared preprocessing and fixed tensors

From the repository root:

```powershell
npm --prefix tools/sign-data run test:preprocessing
npm --prefix tools/sign-data run typecheck
node node_modules/typescript/bin/tsc -p shared/sign-preprocessing/tsconfig.json
npm --prefix tools/sign-data run preprocess:smoke5
npm --prefix tools/sign-data run verify:features
```

The authoritative mathematics live in `shared/sign-preprocessing/`, a small pure TypeScript source module with a type-only dependency on the existing LandmarkFrame contract. The standalone module has no DOM/Node runtime dependency. Future browser recognition must call that same implementation; this phase does not add any application caller. Full feature offsets, equations, component masks, interval coverage and version policies are documented in that module's README and schema.

`featureFiles.ts` reads only the frozen curation and manifest-listed landmark files, validates their identities/hashes, serializes little-endian Float32, and publishes exclusively under `data/scope5/derived/mosl-v1/smoke5-v1/features-v1/`. `preprocess-smoke5.ts` invokes the core on each recording in frozen order, regenerates it for deterministic comparison, checks source integrity, and writes the final manifest last. `--verify` independently regenerates outputs without writing. Existing differing outputs cause failure instead of overwrite; an incompatible version must be reviewed explicitly. All 21 original videos, five curation artifacts, and all landmark artifacts are hashed again after generation/verification. No audit, curation or extraction is rerun.

Each quality-PASS sample produces one headerless row-major `[64,170]` little-endian Float32 file (43,520 bytes). Every attempted sample, including FAIL, remains in `dataset-index.jsonl` and `quality-report.json`; no FAIL sample has a training tensor. Missing data stays explicit and source gaps over 250 ms cannot bridge. Body coverage >=85%, any hand >=70%, and duration 0.75..10 seconds are fixed generic gates. No learned transforms, augmentation, rest trimming, split, training or ONNX are performed.

The first real `smoke5-v1` run attempted all 21 recordings: 10 PASS and 11 FAIL, all failures due to hand coverage below 70%. PASS counts are good_morning 3, father 2, market 3, gift 2, police_officer 0. Completion of this engineering phase does not make five-class training ready: the last class has no eligible tensors and needs a reviewed data-quality decision. No threshold was weakened, class replaced or failed sample silently retained. Each class still has only one declared signer and linguistic review remains unverified.
