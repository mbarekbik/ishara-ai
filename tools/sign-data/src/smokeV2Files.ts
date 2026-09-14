import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { CONTRACT } from '../../../shared/sign-preprocessing/schema.ts';
import type { PreprocessingResult } from '../../../shared/sign-preprocessing/preprocess.ts';
import { CURATION_OUTPUT_NAMES, parseAuditInventory } from './curation.ts';
import { loadExtractionInputs, readSafe } from './extractionFiles.ts';
import { validateLandmarkFrame, serializeLandmarkFrame } from './extractionModel.ts';
import { validateExtractionCompatibility, deserializeTensor, type createIndexRecord } from './featureFiles.ts';
import type { buildExtractionManifest } from './extractionFiles.ts';
import { assertNoLinks, boundedPath, hashFile, REPOSITORY_ROOT, SOURCE_ROOT, sha256 } from './sourceFiles.ts';
import { buildV2Curation, v2SamplePath, type V2CurationEvidence, type V2ParentVocabulary, type V2FeatureRecord } from './smokeV2.ts';

export const V2_CURATION_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/curation/mosl-v1/smoke5-v2');
export const V2_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/derived/mosl-v1/smoke5-v2');
export const V2_LANDMARK_ROOT = boundedPath(V2_ROOT, 'landmarks-v1');
export const V2_FEATURE_ROOT = boundedPath(V2_ROOT, 'features-v1');
export const V1_CURATION_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/curation/mosl-v1/smoke5-v1');
export const V1_LANDMARK_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/derived/mosl-v1/smoke5-v1/landmarks-v1');
export const V1_FEATURE_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/derived/mosl-v1/smoke5-v1/features-v1');
export const DIAGNOSTIC_ROOT = boundedPath(REPOSITORY_ROOT, 'data/scope5/diagnostics/replacement-candidates-v1');
export const V2_EXTRACTION_ID = 'mosl-smoke5-v2-landmarks-v1';
export const V2_FEATURE_ID = 'mosl-smoke5-v2-features-v1';
export const encodeJson = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
export type ParentLandmarks = ReturnType<typeof buildExtractionManifest>;
export type ParentIndex = ReturnType<typeof createIndexRecord>;
export type ParentQuality = ParentIndex & { metrics: PreprocessingResult['metrics'] };
export interface ParentFeatures {
  tensorDatasetId: string; vocabularyId: string; status: string; contract: typeof CONTRACT;
  tensor: { shape: number[]; dtype: string; byteOrder: string; serialization: string; values: number; bytes: number };
  sourceSampleCount: number; passCount: number; failCount: number;
  outputSHA256: Record<string, string>; implementationSHA256: Record<string, string>;
  sourceManifestHashes: { curation: Record<string, string>; landmarks: Record<string, string> };
}
export interface DiagnosticSample {
  sampleId: string; classId: string; sourceCsv: string; sourceRow: number; sourceSHA256: string;
  extractionStatus: string; outputRelativePath: string; outputSHA256: string; delegate: string;
  quality: Omit<PreprocessingResult, 'tensor' | 'timestampsMs'>;
}
export interface DiagnosticScreening {
  status: string; configuration: { vision: ParentLandmarks['vision']; delegate: string };
  runtimeInfo: Record<string, unknown>; browserVersion: string;
  mediaTools: Record<string, string>; samples: DiagnosticSample[];
}

export function outputPath(root: string, name: string): string {
  assert([V2_ROOT,V2_CURATION_ROOT,V2_LANDMARK_ROOT,V2_FEATURE_ROOT].includes(root), 'Only smoke5-v2 output roots are writable');
  assert(!/[\\:\p{Cc}]/u.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe v2 output name');
  return boundedPath(root,name);
}
export async function writeImmutable(root: string, name: string, value: string | Buffer): Promise<void> {
  const target=outputPath(root,name);await assertNoLinks(REPOSITORY_ROOT,target);
  const bytes=typeof value==='string'?Buffer.from(value,'utf8'):value;
  try { assert((await readFile(target)).equals(bytes),`Existing v2 output differs: ${name}`); return; }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
  await mkdir(dirname(target),{recursive:true});
  const pending=outputPath(root,name+'.pending');await assertNoLinks(REPOSITORY_ROOT,pending);
  let owned=false;
  try {
    await writeFile(pending,bytes,{flag:'wx'});owned=true;
    // Exclusive byte copy avoids shared writable hardlinks and refuses overwriting an existing artifact.
    await copyFile(pending,target,constants.COPYFILE_EXCL);
    assert.equal((await hashFile(target)).sha256,sha256(bytes));
  } finally { if(owned)await unlink(pending); }
}
export async function copyInherited(sourceRoot: string, targetRoot: string, name: string, expectedSHA256: string): Promise<void> {
  assert(sourceRoot===V1_LANDMARK_ROOT || sourceRoot===V1_FEATURE_ROOT,'Unexpected inherited source root');
  assert(targetRoot===(sourceRoot===V1_LANDMARK_ROOT?V2_LANDMARK_ROOT:V2_FEATURE_ROOT));
  const source=boundedPath(sourceRoot,name),target=outputPath(targetRoot,name);
  await assertNoLinks(REPOSITORY_ROOT,source);await assertNoLinks(REPOSITORY_ROOT,target);
  assert.equal((await hashFile(source)).sha256,expectedSHA256,'Inherited source hash mismatch');
  await mkdir(dirname(target),{recursive:true});
  try { await copyFile(source,target,constants.COPYFILE_EXCL); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error; }
  assert.equal((await hashFile(target)).sha256,expectedSHA256,'Inherited destination differs');
  assert.equal((await hashFile(source)).sha256,expectedSHA256,'Inherited source changed during copy');
}
export async function readJson<T>(root: string,name: string): Promise<T> {return JSON.parse(await readSafe(root,name)) as T;}
export async function filesUnder(root: string): Promise<string[]> {
  const files: string[]=[];
  const visit=async(directory:string):Promise<void>=>{
    await assertNoLinks(REPOSITORY_ROOT,directory);
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=boundedPath(root,relative(root,boundedPath(directory,entry.name)));
      await assertNoLinks(REPOSITORY_ROOT,path);
      if(entry.isDirectory())await visit(path);else {assert(entry.isFile(),'Unexpected dataset entry');files.push(relative(root,path).replaceAll('\\','/'));}
    }
  };
  await visit(root);return files.sort();
}
export async function verifyHashes(hashes: Record<string,string>): Promise<void> {
  for(const [name,digest]of Object.entries(hashes)) {const path=boundedPath(REPOSITORY_ROOT,name);await assertNoLinks(REPOSITORY_ROOT,path);assert.equal((await hashFile(path)).sha256,digest,`Protected source changed: ${name}`);}
}

/** Validate persisted v1 bytes/records only. Never calls preprocessing or inference for inherited samples. */
export async function loadV2Inputs() {
  const parent=await loadExtractionInputs();
  const parentVocabulary=await readJson<V2ParentVocabulary>(V1_CURATION_ROOT,'vocabulary.json');
  const landmarks=await readJson<ParentLandmarks>(V1_LANDMARK_ROOT,'manifest.json');
  validateExtractionCompatibility(landmarks,parent);
  const features=await readJson<ParentFeatures>(V1_FEATURE_ROOT,'manifest.json');
  assert.equal(features.tensorDatasetId,'mosl-smoke5-features-v1');assert.equal(features.vocabularyId,'mosl-smoke5-v1');
  assert.equal(features.status,'COMPLETE');assert.deepEqual(features.contract,CONTRACT);
  assert.equal(features.sourceSampleCount,21);assert.equal(features.passCount,10);assert.equal(features.failCount,11);
  assert.deepEqual(features.sourceManifestHashes.curation,parent.curationSHA256);
  const protectedSHA256: Record<string,string>={};
  const protect=async(root:string,name:string,expected?:string)=>{const path=boundedPath(root,name);await assertNoLinks(REPOSITORY_ROOT,path);const digest=(await hashFile(path)).sha256;if(expected)assert.equal(digest,expected,`Parent hash mismatch: ${name}`);protectedSHA256[relative(REPOSITORY_ROOT,path).replaceAll('\\','/')]=digest;return digest;};
  for(const root of [V1_CURATION_ROOT,V1_LANDMARK_ROOT,V1_FEATURE_ROOT,boundedPath(REPOSITORY_ROOT,'shared/sign-preprocessing'),boundedPath(REPOSITORY_ROOT,'data/scope5/audit/mosl-v1')]) for(const name of await filesUnder(root))await protect(root,name);
  for(const [name,digest]of Object.entries(features.sourceManifestHashes.landmarks)) await protect(V1_LANDMARK_ROOT,name,digest);
  for(const [name,digest]of Object.entries(features.outputSHA256)) await protect(V1_FEATURE_ROOT,name,digest);
  for(const [name,digest]of Object.entries(features.implementationSHA256)) await protect(REPOSITORY_ROOT,name,digest);
  for(const [name,digest]of Object.entries(landmarks.vision.reusedSources)) await protect(REPOSITORY_ROOT,name,digest);
  const parentIndex=(await readSafe(V1_FEATURE_ROOT,'dataset-index.jsonl')).trimEnd().split('\n').map(line=>JSON.parse(line) as ParentIndex);
  const parentQuality=(await readJson<{samples:ParentQuality[]}>(V1_FEATURE_ROOT,'quality-report.json')).samples;
  assert.equal(parentIndex.length,21);assert.equal(parentQuality.length,21);
  for(const [i,sample]of parent.samples.entries()) {
    const record=parentIndex[i],quality=parentQuality[i];assert.equal(record.sampleId,sample.sampleId);
    const {metrics,...qualityIndex}=quality;assert.deepEqual(record,qualityIndex);assert.equal(metrics.anyHandCoverage,record.anyHandCoverage);
    assert.equal(record.sourceLandmarkSha256,landmarks.samples[i].outputSHA256);
    if(record.qualityStatus==='PASS') {assert(record.tensorRelativePath&&record.tensorSha256);assert.equal(features.outputSHA256[record.tensorRelativePath],record.tensorSha256);deserializeTensor(await readFile(boundedPath(V1_FEATURE_ROOT,record.tensorRelativePath)));}
    else {assert.equal(record.qualityStatus,'FAIL');assert.equal(record.tensorRelativePath,null);assert.equal(record.tensorSha256,null);}
    await protect(SOURCE_ROOT,sample.localVideoRelativePath,sample.sha256);
  }
  const auditRoot=boundedPath(REPOSITORY_ROOT,'data/scope5/audit/mosl-v1');
  const inventoryText=await readSafe(auditRoot,'inventory.jsonl');
  const records=parseAuditInventory(inventoryText);
  const csvChecks=(await readSafe(auditRoot,'checksums.sha256')).trimEnd().split(/\r?\n/u).filter(line=>line.endsWith('.csv'));
  assert.equal(csvChecks.length,5);
  for(const line of csvChecks) {const m=/^([0-9a-f]{64}) {2}(metadata\/.+\.csv)$/u.exec(line);assert(m);await protect(SOURCE_ROOT,m[2],m[1]);}
  const verifiedNewSources=[];
  for(const record of records.filter(r=>r.rawSignLabel==='أَحَبَّ')) {
    const path=boundedPath(SOURCE_ROOT,record.localVideoRelativePath);await assertNoLinks(REPOSITORY_ROOT,path);
    const digest=await hashFile(path);assert.equal(digest.sha256,record.sha256);assert.equal(digest.size,record.fileSizeActual);
    await protect(SOURCE_ROOT,record.localVideoRelativePath,record.sha256);
    verifiedNewSources.push({sourceCsv:record.sourceCsv,sourceRow:record.sourceRow,localVideoRelativePath:record.localVideoRelativePath,sha256:digest.sha256,size:digest.size});
  }
  const diagnostic=await readJson<DiagnosticScreening>(DIAGNOSTIC_ROOT,'screening-results.json');
  assert.equal(diagnostic.status,'SCREENING_COMPLETE');assert.deepEqual(diagnostic.configuration.vision,landmarks.vision);assert.equal(diagnostic.configuration.delegate,'GPU');
  await protect(DIAGNOSTIC_ROOT,'screening-results.json');await protect(DIAGNOSTIC_ROOT,'candidate-ranking.json');
  for(const sample of diagnostic.samples.filter(s=>s.classId==='love_like'))await protect(DIAGNOSTIC_ROOT,sample.outputRelativePath,sample.outputSHA256);
  const evidence: V2CurationEvidence={...parentVocabulary.evidence,auditInventorySHA256:sha256(inventoryText),parentCurationSHA256:parent.curationSHA256,verifiedNewSources};
  const curation=buildV2Curation(parentVocabulary,parent.samples,records,evidence);
  assert.equal(curation.samples.length,22);
  return {parent,parentVocabulary,landmarks,features,parentIndex,parentQuality,curation,diagnostic,protectedSHA256};
}
export type V2Inputs=Awaited<ReturnType<typeof loadV2Inputs>>;
export async function writeV2Curation(inputs:V2Inputs):Promise<void> {
  for(const name of CURATION_OUTPUT_NAMES)await writeImmutable(V2_CURATION_ROOT,name,inputs.curation.outputs[name]);
}
export async function validateV2Sequence(result: ParentLandmarks['samples'][number], trackingRunId: string) {
  assert.equal(result.outputRelativePath,v2SamplePath(result.sampleId,'jsonl'));
  const text=await readSafe(V2_LANDMARK_ROOT,result.outputRelativePath!);assert.equal(sha256(text),result.outputSHA256);
  assert(text.endsWith('\n'));const lines=text.trimEnd().split('\n');assert.equal(lines.length,result.extractedLandmarkFrameCount);
  let previous=-Infinity;
  return lines.map((line,i)=>{
    const frame=validateLandmarkFrame(JSON.parse(line),{trackingRunId,sequence:i+1,timestampMs:result.selectedSourceFrames[i].timestampMs,...result.sourceDimensions});
    assert(frame.timestampMs>previous&&frame.timestampMs>=result.mediaStartMs&&frame.timestampMs<=result.mediaEndMs);previous=frame.timestampMs;
    assert.equal(serializeLandmarkFrame(frame),line+'\n');return frame;
  });
}
export async function verifyIndexTensors(records:readonly V2FeatureRecord[]):Promise<Record<string,string>> {
  const hashes:Record<string,string>={};
  for(const record of records) {
    if(record.qualityStatus==='FAIL') {assert.equal(record.tensorRelativePath,null);assert.equal(record.tensorSha256,null);continue;}
    assert(record.tensorRelativePath&&record.tensorSha256);assert.equal(record.tensorRelativePath,v2SamplePath(record.sampleId,'f32'));
    const path=outputPath(V2_FEATURE_ROOT,record.tensorRelativePath);await assertNoLinks(REPOSITORY_ROOT,path);
    const bytes=await readFile(path);deserializeTensor(bytes);assert.equal(sha256(bytes),record.tensorSha256);hashes[record.tensorRelativePath]=record.tensorSha256;
  }
  return hashes;
}
