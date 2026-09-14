import assert from 'node:assert/strict';
import { open, unlink, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTRACT } from '../../../shared/sign-preprocessing/schema.ts';
import { createExtractionBrowser, type ExtractionBrowser } from './extractionBrowser.ts';
import { mediaToolVersions } from './extractionDecoder.ts';
import { verifyVisionRuntime, readSafe } from './extractionFiles.ts';
import { assertNoLinks, boundedPath, REPOSITORY_ROOT, sha256 } from './sourceFiles.ts';
import { CURATION_OUTPUT_NAMES } from './curation.ts';
import { V2_ID, V2_REPLACEMENT, summarizeV2Records, type V2FeatureRecord } from './smokeV2.ts';
import { deriveLoveSample, verifyNewDerivation, type NewDerivation } from './smokeV2Derivation.ts';
import { loadV2Inputs, V2_ROOT, V2_CURATION_ROOT, V2_LANDMARK_ROOT, V2_FEATURE_ROOT, V1_LANDMARK_ROOT, V1_FEATURE_ROOT, V2_EXTRACTION_ID, V2_FEATURE_ID, copyInherited, encodeJson, writeImmutable, writeV2Curation, readJson, verifyHashes, validateV2Sequence, verifyIndexTensors, filesUnder, outputPath, type V2Inputs, type ParentLandmarks } from './smokeV2Files.ts';

type OriginLandmark=ParentLandmarks['samples'][number]&{trackingRunId:string;artifactOrigin:'inherited_smoke5_v1'|'derived_smoke5_v2';reusedFrom:{datasetId:string;sampleId:string;relativePath:string;sha256:string}|null};
interface State {schemaVersion:1;datasetId:string;inputSHA256:string;generationTimestamp:string;protectedSHA256:Record<string,string>}
interface Runtime {browserVersion:string;runtimeInfo:Record<string,unknown>;mediaTools:Record<string,string>}
const isMissing=(error:unknown)=> (error as NodeJS.ErrnoException).code==='ENOENT';
const repoPath=(root:string,name:string)=>relative(REPOSITORY_ROOT,boundedPath(root,name)).replaceAll('\\','/');

async function outputsFromSources(inputs:V2Inputs,newRecords:NewDerivation[]) {
  const extraction:OriginLandmark[]=[];const index:V2FeatureRecord[]=[];const quality=[];
  for(const sample of inputs.curation.samples) {
    if(sample.classIndex<4) {
      const source=inputs.landmarks.samples.find(r=>r.sampleId===sample.sampleId);assert(source?.outputRelativePath&&source.outputSHA256);
      const parentIndex=inputs.parentIndex.find(r=>r.sampleId===sample.sampleId),parentQuality=inputs.parentQuality.find(r=>r.sampleId===sample.sampleId);assert(parentIndex&&parentQuality);
      extraction.push({...source,trackingRunId:`${inputs.landmarks.extractionDatasetId}:${sample.sampleId}`,artifactOrigin:'inherited_smoke5_v1',reusedFrom:{datasetId:inputs.landmarks.extractionDatasetId,sampleId:sample.sampleId,relativePath:repoPath(V1_LANDMARK_ROOT,source.outputRelativePath),sha256:source.outputSHA256}});
      const record:V2FeatureRecord={...parentIndex,sourceVideoSHA256:sample.sha256,artifactOrigin:'inherited_smoke5_v1',reusedFrom:{datasetId:'mosl-smoke5-v1',sampleId:sample.sampleId,sourceLandmarkSha256:parentIndex.sourceLandmarkSha256!,tensorSha256:parentIndex.tensorSha256}};
      index.push(record);quality.push({...record,metrics:parentQuality.metrics});
    } else {
      const current=newRecords.find(r=>r.index.sampleId===sample.sampleId);assert(current);
      extraction.push({...current.extraction,trackingRunId:current.trackingRunId,artifactOrigin:'derived_smoke5_v2',reusedFrom:null});
      index.push(current.index);quality.push({...current.index,metrics:current.metrics});
    }
  }
  return {extraction,index,quality};
}

async function copyParentArtifacts(inputs:V2Inputs) {
  for(const sample of inputs.curation.samples.filter(s=>s.classIndex<4)) {
    const result=inputs.landmarks.samples.find(s=>s.sampleId===sample.sampleId);assert(result?.outputRelativePath&&result.outputSHA256);
    await copyInherited(V1_LANDMARK_ROOT,V2_LANDMARK_ROOT,result.outputRelativePath,result.outputSHA256);
    const record=inputs.parentIndex.find(s=>s.sampleId===sample.sampleId);assert(record);
    if(record.tensorRelativePath)await copyInherited(V1_FEATURE_ROOT,V2_FEATURE_ROOT,record.tensorRelativePath,record.tensorSha256!);
  }
}

async function buildManifests(inputs:V2Inputs,newRecords:NewDerivation[],state:State,runtime:Runtime) {
  const composite=await outputsFromSources(inputs,newRecords);
  await verifyHashes(state.protectedSHA256);
  const tensors=await verifyIndexTensors(composite.index);
  const summary=summarizeV2Records(composite.index,{sourceIntegrityVerified:true,unresolvedGenerationErrors:0,verifiedTensorSHA256:tensors});
  const curationSHA256=Object.fromEntries(CURATION_OUTPUT_NAMES.map(name=>[name,sha256(inputs.curation.outputs[name])]));
  const landmarkFiles:Record<string,Buffer>={};
  const newComparison=newRecords.map(r=>({sampleId:r.index.sampleId,sourceRow:r.index.sourceRow,qualityStatus:r.index.qualityStatus,anyHandCoverage:r.index.anyHandCoverage,...r.diagnosticComparison}));
  const landmarks={extractionDatasetId:V2_EXTRACTION_ID,extractionSchemaVersion:1,parentDataset:'mosl-smoke5-v1',replacement:V2_REPLACEMENT,sourceCurationId:V2_ID,sourceVocabularyId:V2_ID,classCount:5,sourceSampleCount:22,status:'COMPLETE',landmarkFrame:inputs.landmarks.landmarkFrame,vision:inputs.landmarks.vision,delegate:'GPU',targetExtractionFps:15,frameSelection:inputs.landmarks.frameSelection,maxImageLongEdge:960,browserVersion:runtime.browserVersion,browserRuntime:runtime.runtimeInfo,mediaTools:runtime.mediaTools,generationTimestamp:state.generationTimestamp,curationSHA256,parentManifestSHA256:sha256(await readFile(boundedPath(V1_LANDMARK_ROOT,'manifest.json'))),inheritedSampleCount:17,newlyExtractedSampleCount:newRecords.length,successfulExtractions:22,failedExtractions:0,pendingExtractions:0,totalLandmarkFrameCount:composite.extraction.reduce((n,r)=>n+r.extractedLandmarkFrameCount,0),newLandmarkFrameCount:newRecords.reduce((n,r)=>n+r.extraction.extractedLandmarkFrameCount,0),reusePolicy:'self-contained-byte-for-byte-copy-no-hardlinks-no-inherited-inference',diagnosticComparison:newComparison,samples:composite.extraction};
  landmarkFiles['extraction-report.json']=Buffer.from(encodeJson(landmarks));
  landmarkFiles['README.md']=Buffer.from(`# ${V2_EXTRACTION_ID}\n\n22 source recordings: 17 inherited sequences copied byte-for-byte from smoke5-v1, five newly extracted Love / Like sequences. Original v1 sample IDs and trackingRunIds are preserved in inherited files. Each manifest row records artifactOrigin and reusedFrom hashes. New sequences use v2 sample/run identities.\n\nOnly new-class videos were decoded and processed with the unchanged local Scope 4 GPU Holistic worker, actual presentation timestamps, greedy 15 FPS cap and unmirrored anatomical data. No diagnostic JSONL was promoted. Diagnostic outputs were read only for comparison.\n\nNo camera UI, preprocessing math, classifier, training, splits, ONNX or Sign → Text integration changed. Linguistic/identity review remains unverified. All artifacts are private and Git-ignored.\n`);
  landmarkFiles['manifest.json']=Buffer.from(encodeJson(landmarks));
  const featureFiles:Record<string,Buffer>={};
  featureFiles['dataset-index.jsonl']=Buffer.from(composite.quality.map(r=>JSON.stringify(r)).join('\n')+'\n');
  featureFiles['quality-report.json']=Buffer.from(encodeJson({tensorDatasetId:V2_FEATURE_ID,preprocessingVersion:CONTRACT.preprocessingVersion,qualityPolicyVersion:CONTRACT.qualityPolicyVersion,coverageSemantics:CONTRACT.coverage,...summary,samples:composite.quality}));
  featureFiles['README.md']=Buffer.from([
    '# smoke5-v2 five-class engineering tensor dataset','',
    'Class order: 0 good_morning; 1 father; 2 market; 3 gift; 4 love_like — أَحَبَّ — Love / Like.',
    `All 22 curated recordings remain in dataset-index.jsonl: ${summary.pass} PASS / ${summary.fail} FAIL. FAIL records have metrics and reasons but no tensor.`,
    'Self-contained reuse: 17 source identities and existing quality records inherited from smoke5-v1; 10 accepted tensors and 17 landmark sequences copied byte-for-byte. No inherited inference or preprocessing occurred. Each inherited row retains its v1 sampleId and carries reusedFrom provenance.',
    'Five new Love / Like recordings received fresh canonical v2 GPU Holistic extraction and unchanged shared preprocessing. New tensors were independently regenerated from persisted new landmarks. Diagnostic screening was comparison evidence only.',
    'Every samples/*.f32 is raw little-endian Float32, row-major [64,170], 10,880 finite values, exactly 43,520 bytes. No header or batch dimension. Consumers must use dataset-index.jsonl, select qualityStatus PASS, verify hashes and obey the frozen manifest class order.',
    `Contract: ${CONTRACT.preprocessingVersion}; feature ${CONTRACT.featureSchemaVersion}; temporal ${CONTRACT.temporalResamplingVersion}; quality ${CONTRACT.qualityPolicyVersion}.`,
    'Body >=85%, any hand >=70%, duration 0.75–10 seconds; max interpolation gap 250 ms. No threshold, trimming, normalization, masks or velocity changes.',
    `trainingReady=${summary.trainingReady} means engineering artifact readiness only. This is not a production vocabulary, linguistic validation, signer-independent benchmark or statistically adequate recognition evaluation. Each label has only one unverified declared signer ID.`,
    'Parent police_officer artifacts remain intact in smoke5-v1. No police_officer sample or sixth class exists here. No train split, model, augmentation, ONNX, browser inference or Sign → Text UI was created.',
    'Generate/resume: npm --prefix tools/sign-data run compose:smoke5-v2',
    'Validate (never recomputes inherited samples): npm --prefix tools/sign-data run verify:smoke5-v2','',
  ].join('\n'));
  const landmarkSHA256:Record<string,string>=Object.fromEntries(Object.entries(landmarkFiles).map(([name,bytes])=>[name,sha256(bytes)]));
  for(const row of composite.extraction)landmarkSHA256[row.outputRelativePath!]=row.outputSHA256!;
  for(const record of newRecords) {const name=`records/${encodeURIComponent(record.index.sampleId)}.json`;landmarkSHA256[name]=sha256(encodeJson(record));}
  const implementationSHA256:Record<string,string>={...inputs.features.implementationSHA256};
  for(const name of ['smokeV2.ts','smokeV2Files.ts','smokeV2Derivation.ts','compose-smoke5-v2.ts','extractionBrowser.ts','extractionDecoder.ts','extractionModel.ts'])implementationSHA256[`tools/sign-data/src/${name}`]=sha256(await readSafe(REPOSITORY_ROOT,`tools/sign-data/src/${name}`));
  const manifest={tensorDatasetId:V2_FEATURE_ID,tensorDatasetSchemaVersion:1,datasetId:V2_ID,parentDataset:'mosl-smoke5-v1',replacement:V2_REPLACEMENT,vocabularyId:V2_ID,sourceCurationId:V2_ID,sourceExtractionDatasetId:V2_EXTRACTION_ID,classOrdering:inputs.curation.vocabulary.classes.map(({classId,classIndex})=>({classId,classIndex})),sourceSampleCount:22,sourceLandmarkFrameCount:landmarks.totalLandmarkFrameCount,preprocessingAttemptCount:22,newPreprocessingAttemptCount:5,inheritedPreprocessingRecordCount:17,passCount:summary.pass,failCount:summary.fail,perClass:summary.perClass,inheritedArtifactCount:{landmarkSequences:17,qualityRecords:17,tensors:10},newlyDerivedArtifactCount:{landmarkSequences:5,qualityRecords:5,tensors:summary.pass-10},tensor:inputs.features.tensor,contract:CONTRACT,implementationToolVersion:'smoke5-v2-composition-1',implementationSHA256,generationTimestamp:state.generationTimestamp,sourceManifestHashes:{curation:curationSHA256,landmarks:landmarkSHA256,parentFeatures:sha256(await readFile(boundedPath(V1_FEATURE_ROOT,'manifest.json')))},outputSHA256:{...tensors,...Object.fromEntries(Object.entries(featureFiles).map(([name,bytes])=>[name,sha256(bytes)]))},status:'COMPLETE',trainingReady:summary.trainingReady,purpose:'ENGINEERING_SMOKE_TEST_ONLY',linguisticReviewStatus:'unverified',reusePolicy:'self-contained-byte-for-byte-copy-no-hardlinks',validation:{sourceIntegrity:true,finiteTensors:true,newClassDeterministicRegeneration:true,inheritedSamplesRecomputed:0,diagnosticComparison:newComparison,unresolvedGenerationErrors:0}};
  featureFiles['manifest.json']=Buffer.from(encodeJson(manifest));
  return {composite,landmarks,manifest,summary,landmarkFiles,featureFiles};
}

async function validatePublished(inputs:V2Inputs,state:State,runtime:Runtime,newRecords:NewDerivation[]) {
  for(const record of newRecords) {const sample=inputs.curation.samples.find(s=>s.sampleId===record.index.sampleId);assert(sample);await verifyNewDerivation(record,sample);}
  const built=await buildManifests(inputs,newRecords,state,runtime);
  for(const name of CURATION_OUTPUT_NAMES)assert.equal(await readSafe(V2_CURATION_ROOT,name),inputs.curation.outputs[name]);
  for(const record of built.composite.extraction) {
    await validateV2Sequence(record,record.trackingRunId);
    if(record.reusedFrom)assert((await readFile(boundedPath(V2_LANDMARK_ROOT,record.outputRelativePath!))).equals(await readFile(boundedPath(V1_LANDMARK_ROOT,record.outputRelativePath!))));
  }
  for(const [root,files]of [[V2_LANDMARK_ROOT,built.landmarkFiles],[V2_FEATURE_ROOT,built.featureFiles]] as const)for(const [name,bytes]of Object.entries(files))assert((await readFile(outputPath(root,name))).equals(bytes),`Published manifest differs: ${name}`);
  const expectedFeatures=Object.keys(built.manifest.outputSHA256).concat('manifest.json').sort();assert.deepEqual(await filesUnder(V2_FEATURE_ROOT),expectedFeatures,'Unexpected feature artifacts or FAIL tensor');
  assert.deepEqual(await filesUnder(V2_LANDMARK_ROOT),Object.keys(built.manifest.sourceManifestHashes.landmarks).sort(),'Unexpected landmark artifacts/scratch');
  for(const record of built.composite.index.filter(r=>r.artifactOrigin==='inherited_smoke5_v1'&&r.tensorRelativePath))assert((await readFile(outputPath(V2_FEATURE_ROOT,record.tensorRelativePath!))).equals(await readFile(boundedPath(V1_FEATURE_ROOT,record.tensorRelativePath!))));
  await verifyHashes(state.protectedSHA256);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:REPOSITORY_ROOT,encoding:'utf8',windowsHide:true}).trim();
  assert.equal(git('diff','HEAD','--name-only','--','apps','shared'),'','Production/shared changed');assert.equal(git('ls-files','--','data/scope5'),'','Private dataset tracked');
  for(const root of [V2_CURATION_ROOT,V2_ROOT])for(const name of await filesUnder(root))assert(git('check-ignore',repoPath(root,name)),`Private output not ignored: ${name}`);
  return built;
}

async function main() {
  assert(process.argv.slice(2).every(arg=>arg==='--verify'),'Only --verify is supported');
  const verifyOnly=process.argv.includes('--verify');const inputs=await loadV2Inputs();
  const vision=await verifyVisionRuntime();assert.deepEqual(vision,inputs.landmarks.vision,'Current detector differs from accepted v1');
  const inputSHA256=sha256(JSON.stringify({protected:inputs.protectedSHA256,curation:inputs.curation.outputs}));
  let state:State;
  try {state=await readJson<State>(V2_ROOT,'generation-state.json');assert.equal(state.inputSHA256,inputSHA256,'Source or composition changed since generation began');await verifyHashes(state.protectedSHA256);}
  catch(error) {if(!isMissing(error)||verifyOnly)throw error;state={schemaVersion:1,datasetId:V2_ID,inputSHA256,generationTimestamp:new Date().toISOString(),protectedSHA256:inputs.protectedSHA256};await writeImmutable(V2_ROOT,'generation-state.json',encodeJson(state));}
  if(verifyOnly) {
    const runtime=await readJson<Runtime>(V2_ROOT,'runtime.json');const records=[];
    for(const sample of inputs.curation.samples.filter(s=>s.classId==='love_like'))records.push(await readJson<NewDerivation>(V2_LANDMARK_ROOT,`records/${encodeURIComponent(sample.sampleId)}.json`));
    const verified=await validatePublished(inputs,state,runtime,records);console.log(encodeJson({status:'VERIFIED',...verified.summary}));return;
  }
  const lockPath=outputPath(V2_ROOT,'.compose.lock');await assertNoLinks(REPOSITORY_ROOT,lockPath);
  const lock=await open(lockPath,'wx');let browser:ExtractionBrowser|undefined;const cancellation=new AbortController();
  const cancel=()=>cancellation.abort(new Error('V2_GENERATION_CANCELLED'));process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {
    await writeV2Curation(inputs);await copyParentArtifacts(inputs);
    let runtime:Runtime|undefined;try {runtime=await readJson<Runtime>(V2_ROOT,'runtime.json');}catch(error){if(!isMissing(error))throw error;}
    const records:NewDerivation[]=[];
    for(const sample of inputs.curation.samples.filter(s=>s.classId==='love_like')) {
      if(cancellation.signal.aborted)throw cancellation.signal.reason;
      const name=`records/${encodeURIComponent(sample.sampleId)}.json`;
      try {const record=await readJson<NewDerivation>(V2_LANDMARK_ROOT,name);await verifyNewDerivation(record,sample);records.push(record);continue;}catch(error){if(!isMissing(error))throw error;}
      if(!browser) {
        browser=await createExtractionBrowser({datasetVersion:'smoke5-v2'});
        const actual={browserVersion:browser.browserVersion,runtimeInfo:browser.runtimeInfo,mediaTools:await mediaToolVersions()};
        assert.deepEqual(actual.runtimeInfo,inputs.landmarks.browserRuntime,'Accepted GPU/browser environment changed');
        assert.deepEqual(actual.runtimeInfo,inputs.diagnostic.runtimeInfo,'Diagnostic runtime differs');
        assert.deepEqual(actual.mediaTools,inputs.landmarks.mediaTools);
        if(runtime)assert.deepEqual(actual,runtime);else {runtime=actual;await writeImmutable(V2_ROOT,'runtime.json',encodeJson(runtime));}
      }
      const diagnostic=inputs.diagnostic.samples.find(s=>s.classId==='love_like'&&s.sourceRow===sample.sourceRow);assert(diagnostic);
      console.log(`Canonical love_like ${records.length+1}/5 sourceRow=${sample.sourceRow}`);
      const result=await deriveLoveSample(sample,browser,diagnostic,cancellation.signal);records.push(result);
      console.log(encodeJson({sourceRow:sample.sourceRow,frames:result.extraction.extractedLandmarkFrameCount,quality:result.index.qualityStatus,anyHandCoverage:result.index.anyHandCoverage,diagnosticComparison:result.diagnosticComparison}));
    }
    await browser?.close();browser=undefined;assert(runtime);
    const built=await buildManifests(inputs,records,state,runtime);
    for(const [name,bytes]of Object.entries(built.landmarkFiles))await writeImmutable(V2_LANDMARK_ROOT,name,bytes);
    for(const [name,bytes]of Object.entries(built.featureFiles))await writeImmutable(V2_FEATURE_ROOT,name,bytes);
    // Remove owned lock before the final complete-tree privacy check.
    await lock.close();await unlink(lockPath);
    const verified=await validatePublished(inputs,state,runtime,records);
    await writeImmutable(V2_ROOT,'validation.json',encodeJson({status:'VERIFIED',datasetId:V2_ID,trainingReady:verified.summary.trainingReady,protectedFileCount:Object.keys(state.protectedSHA256).length,allSourceHashesUnchanged:true,inheritedMediaPipeCalls:0,inheritedPreprocessingCalls:0,inheritedByteIdenticalLandmarks:17,inheritedByteIdenticalTensors:10,newCanonicalExtractions:5,newDeterministicPreprocessingChecks:5,finiteTensorCount:verified.summary.pass,noTensorForFailures:true,privateDataIgnored:true,temporaryFramesPersisted:false,runtimeCleaned:true,summary:verified.summary}));
    console.log(encodeJson({status:'COMPLETE',...verified.summary}));
  } finally {
    await browser?.close();await lock.close().catch(()=>undefined);await unlink(lockPath).catch(error=>{if(!isMissing(error))throw error;});
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message.replaceAll(REPOSITORY_ROOT,'<repository>'):'V2_GENERATION_FAILED');process.exitCode=1;});
