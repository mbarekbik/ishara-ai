import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preprocessSequence } from '../../../shared/sign-preprocessing/preprocess.ts';
import { CONTRACT, FEATURE_WIDTH, SEQUENCE_LENGTH } from '../../../shared/sign-preprocessing/schema.ts';
import { type ExtractionBrowser } from './extractionBrowser.ts';
import { decodeRecording, probeRecording } from './extractionDecoder.ts';
import { emptyCoverage, countCoverage, type ExtractionResult } from './extractionFiles.ts';
import { serializeLandmarkFrame, validateLandmarkFrame, type ExtractionSample, type LandmarkFrame } from './extractionModel.ts';
import { serializeTensor } from './featureFiles.ts';
import { assertNoLinks, boundedPath, hashFile, REPOSITORY_ROOT, SOURCE_ROOT, sha256 } from './sourceFiles.ts';
import { v2SamplePath, type V2FeatureRecord } from './smokeV2.ts';
import { DIAGNOSTIC_ROOT, V2_EXTRACTION_ID, V2_LANDMARK_ROOT, V2_FEATURE_ROOT, encodeJson, readJson, validateV2Sequence, writeImmutable, type DiagnosticSample } from './smokeV2Files.ts';

export interface NewDerivation {
  extraction: ExtractionResult;
  trackingRunId: string;
  index: V2FeatureRecord;
  metrics: ReturnType<typeof preprocessSequence>['metrics'];
  diagnosticComparison: { sameQualityStatus: boolean; maximumCoverageDifference: number; semanticLandmarksExactlyEqual: boolean; maximumCoordinateDifference: number; frameCountEqual: boolean };
  deterministicPreprocessingVerified: boolean;
}

function compareDiagnostic(frames: LandmarkFrame[], prior: LandmarkFrame[]) {
  assert.equal(frames.length,prior.length,'Canonical frame count differs from diagnostic');
  let exact=true,maximum=0;
  const compare=(a:unknown,b:unknown):void=>{
    if(typeof a==='number'&&typeof b==='number') {maximum=Math.max(maximum,Math.abs(a-b));if(a!==b)exact=false;return;}
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object') {if(a!==b)exact=false;return;}
    if(Array.isArray(a)&&Array.isArray(b)) {assert.equal(a.length,b.length,'Diagnostic topology differs');a.forEach((x,i)=>compare(x,b[i]));return;}
    const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;
    if(JSON.stringify(Object.keys(aa))!==JSON.stringify(Object.keys(bb)))exact=false;
    for(const key of Object.keys(aa))compare(aa[key],bb[key]);
  };
  frames.forEach((frame,i)=>{
    assert.equal(frame.timestampMs,prior[i].timestampMs,'Canonical timestamps differ from diagnostic');
    assert.deepEqual(frame.source,prior[i].source);
    const {trackingRunId:_a,...a}=frame,{trackingRunId:_b,...b}=prior[i];void _a;void _b;compare(a,b);
  });
  return {semanticLandmarksExactlyEqual:exact,maximumCoordinateDifference:maximum,frameCountEqual:true};
}

/** Only approved new v2 IDs can reach the existing decoder/worker and preprocessing. */
export async function deriveLoveSample(sample:ExtractionSample,browser:ExtractionBrowser,diagnostic:DiagnosticSample,signal:AbortSignal):Promise<NewDerivation> {
  assert.equal(sample.classId,'love_like');assert.equal(sample.classIndex,4);assert(sample.sampleId.startsWith('mosl-smoke5-v2:'));
  assert.equal(sample.rawSourceLabel,'أَحَبَّ');assert.equal(sample.sourceEnglishGloss,'Love / Like');
  assert.equal(diagnostic.classId,sample.classId);assert.equal(diagnostic.sourceCsv,sample.sourceCsv);assert.equal(diagnostic.sourceRow,sample.sourceRow);
  assert.equal(diagnostic.sourceSHA256,sample.sha256);assert.equal(diagnostic.extractionStatus,'success');assert.equal(diagnostic.delegate,'GPU');
  const recordName=`records/${encodeURIComponent(sample.sampleId)}.json`;
  try {
    const existing=await readJson<NewDerivation>(V2_LANDMARK_ROOT,recordName);
    assert.equal(existing.extraction.sampleId,sample.sampleId);assert.equal(existing.extraction.sourceVideoSHA256,sample.sha256);
    await verifyNewDerivation(existing,sample);return existing;
  } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const source=boundedPath(SOURCE_ROOT,sample.localVideoRelativePath);await assertNoLinks(REPOSITORY_ROOT,source);
  assert.equal((await hashFile(source)).sha256,sample.sha256);
  const probe=await probeRecording(source,signal);
  assert.deepEqual({width:probe.width,height:probe.height},sample.resolution);assert.equal(probe.timestampsMs.length,sample.frameCount);
  assert(Math.abs(probe.durationSeconds-sample.duration)<0.00001,'Canonical source duration differs');
  const trackingRunId=`${V2_EXTRACTION_ID}:${sample.sampleId}`;
  const frames:LandmarkFrame[]=[];const inferenceMilliseconds={total:0,maximum:0};
  let callbackError:unknown;
  try {
    assert.equal(await browser.startSample(trackingRunId,'GPU'),'GPU','Consistent GPU delegate required');
    await decodeRecording(source,probe,async decoded=>{
      try {
      const started=performance.now();
      const frame=validateLandmarkFrame(await browser.infer(decoded.rgba,decoded.width,decoded.height,decoded.timestampMs,frames.length+1,trackingRunId),{trackingRunId,sequence:frames.length+1,timestampMs:decoded.timestampMs,width:decoded.width,height:decoded.height});
      const elapsed=performance.now()-started;inferenceMilliseconds.total+=elapsed;inferenceMilliseconds.maximum=Math.max(inferenceMilliseconds.maximum,elapsed);
      assert(!frames.length||frame.timestampMs>frames.at(-1)!.timestampMs);assert(frame.timestampMs>=probe.startTimeMs&&frame.timestampMs<=probe.endTimeMs);
      frames.push(frame);
      } catch(error) {callbackError=error;throw error;}
    },signal);
  } catch(error) {
    const cause=callbackError??error;
    const message=cause instanceof Error?cause.message.replaceAll(REPOSITORY_ROOT,'<repository>').slice(0,400):'UNKNOWN_CAPTURE_FAILURE';
    throw new Error(`Canonical sourceRow=${sample.sourceRow} frame=${frames.length+1}: ${message}`);
  } finally {await browser.endSample();}
  assert.equal(frames.length,probe.selectedIndices.length);assert(frames.length>0);
  const outputRelativePath=v2SamplePath(sample.sampleId,'jsonl');const text=frames.map(serializeLandmarkFrame).join('');
  const coverage=emptyCoverage();frames.forEach(frame=>countCoverage(coverage,frame));
  const extraction:ExtractionResult={sampleId:sample.sampleId,classId:sample.classId,classIndex:sample.classIndex,rawSourceLabel:sample.rawSourceLabel,sourceCsv:sample.sourceCsv,sourceRow:sample.sourceRow,declaredSignerId:sample.declaredSignerId,sourceVideoRelativePath:sample.localVideoRelativePath,sourceVideoSHA256:sample.sha256,sourceDurationSeconds:sample.duration,status:'success',delegate:'GPU',decodedSourceFrameCount:probe.timestampsMs.length,selectedSourceFrames:probe.selectedIndices.map(index=>({index,timestampMs:probe.timestampsMs[index]})),sourceDimensions:sample.resolution,sourceTimeBase:probe.timeBase,mediaStartMs:probe.startTimeMs,mediaEndMs:probe.endTimeMs,extractedLandmarkFrameCount:frames.length,firstMediaTimestampMs:frames[0].timestampMs,lastMediaTimestampMs:frames.at(-1)!.timestampMs,outputRelativePath,outputSHA256:sha256(text),coverage,warnings:[],error:null,inferenceMilliseconds};
  const processed=preprocessSequence(frames),repeated=preprocessSequence(frames);
  assert.deepEqual(processed,repeated,'New-class preprocessing regeneration differs');
  const bytes=processed.tensor?serializeTensor(processed.tensor):null;
  if(bytes)assert(bytes.equals(serializeTensor(repeated.tensor!)));
  const diagnosticPath=boundedPath(DIAGNOSTIC_ROOT,diagnostic.outputRelativePath);await assertNoLinks(REPOSITORY_ROOT,diagnosticPath);
  const diagnosticText=await readFile(diagnosticPath,'utf8');assert.equal(sha256(diagnosticText),diagnostic.outputSHA256);
  const prior=diagnosticText.trimEnd().split('\n').map(line=>JSON.parse(line) as LandmarkFrame);
  const geometryComparison=compareDiagnostic(frames,prior);
  const maximumCoverageDifference=Math.max(...(['anyHandCoverage','bodyAnchorCoverage','leftHandCoverage','rightHandCoverage'] as const).map(key=>Math.abs(processed.metrics[key]-diagnostic.quality.metrics[key])));
  const diagnosticComparison={sameQualityStatus:processed.qualityStatus===diagnostic.quality.qualityStatus,maximumCoverageDifference,...geometryComparison};
  // Review boundary declared before running: never accept a PASS/FAIL change or >1 percentage-point coverage drift silently.
  assert(diagnosticComparison.sameQualityStatus&&maximumCoverageDifference<=0.01,'STOP: canonical quality materially disagrees with diagnostic screening');
  const {bodyAnchorCoverage,anyHandCoverage,leftHandCoverage,rightHandCoverage,poseCoverage,faceCoverage}=processed.metrics;
  const index:V2FeatureRecord={sampleId:sample.sampleId,classId:sample.classId,classIndex:sample.classIndex,sourceCsv:sample.sourceCsv,sourceRow:sample.sourceRow,declaredSignerId:sample.declaredSignerId,sourceVideoSHA256:sample.sha256,sourceLandmarkRelativePath:`../landmarks-v1/${outputRelativePath}`,sourceLandmarkSha256:extraction.outputSHA256,preprocessingVersion:CONTRACT.preprocessingVersion,featureSchemaVersion:CONTRACT.featureSchemaVersion,sequenceLength:SEQUENCE_LENGTH,featureWidth:FEATURE_WIDTH,tensorRelativePath:bytes?v2SamplePath(sample.sampleId,'f32'):null,tensorSha256:bytes?sha256(bytes):null,qualityStatus:processed.qualityStatus,bodyAnchorCoverage,anyHandCoverage,leftHandCoverage,rightHandCoverage,poseCoverage,faceCoverage,sourceDurationSeconds:processed.sourceDurationSeconds,preprocessingWarnings:processed.warnings,failureReasons:processed.failureReasons,artifactOrigin:'derived_smoke5_v2',reusedFrom:null};
  const result:NewDerivation={extraction,trackingRunId,index,metrics:processed.metrics,diagnosticComparison,deterministicPreprocessingVerified:true};
  // Save no accepted output until the canonical quality and diagnostic comparison pass.
  await writeImmutable(V2_LANDMARK_ROOT,outputRelativePath,text);
  if(bytes)await writeImmutable(V2_FEATURE_ROOT,index.tensorRelativePath!,bytes);
  await writeImmutable(V2_LANDMARK_ROOT,recordName,encodeJson(result));
  assert.equal((await hashFile(source)).sha256,sample.sha256);return result;
}

export async function verifyNewDerivation(record:NewDerivation,sample:ExtractionSample):Promise<void> {
  assert.equal(sample.classId,'love_like');assert.equal(record.index.sampleId,sample.sampleId);
  assert.equal(record.trackingRunId,`${V2_EXTRACTION_ID}:${sample.sampleId}`);
  const frames=await validateV2Sequence(record.extraction,record.trackingRunId);
  // Only the new class is regenerated for deterministic verification; inherited artifacts never enter this function.
  const result=preprocessSequence(frames);assert.equal(result.qualityStatus,record.index.qualityStatus);assert.deepEqual(result.metrics,record.metrics);
  assert.deepEqual(result.failureReasons,record.index.failureReasons);
  if(result.tensor) {
    assert(record.index.tensorRelativePath);const bytes=await readFile(boundedPath(V2_FEATURE_ROOT,record.index.tensorRelativePath));
    assert(bytes.equals(serializeTensor(result.tensor)));assert.equal(sha256(bytes),record.index.tensorSha256);
  } else {assert.equal(record.index.tensorRelativePath,null);assert.equal(record.index.tensorSha256,null);}
}
