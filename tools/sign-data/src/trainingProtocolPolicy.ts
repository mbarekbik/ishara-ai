import assert from 'node:assert/strict';

export const GLOBAL_SEED = 20260913;

/** The literal type prevents edits in TypeScript; recursive freezing also rejects runtime mutation. */
function freezePolicy<const T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezePolicy(child);
  }
  return Object.freeze(value);
}

/** Evaluation rules only. Experiment architectures and fitting belong to later, separately authorized work. */
export const PROTOCOL_POLICY = freezePolicy({
  protocolVersion: 1,
  taskType: 'closed_set_5_class_engineering',
  classOrder: ['good_morning', 'father', 'market', 'gift', 'love_like'],
  expectedCounts: { attempted: 22, eligible: 14, excludedQualityFail: 8, perClass: [3, 2, 3, 2, 4] },
  inputContract: {
    datasetId: 'mosl-smoke5-v2', vocabularyId: 'mosl-smoke5-v2', featureDatasetId: 'mosl-smoke5-v2-features-v1',
    authoritativeFeatureDirectory: 'data/scope5/derived/mosl-v1/smoke5-v2/features-v1',
    shape: [64, 170], dtype: 'Float32', serialization: 'headerless-little-endian-raw-Float32', bytesPerTensor: 43520,
    preprocessingVersion: 'sign-features-170-v1', featureSchemaVersion: 'anatomical-170-v1',
    temporalResamplingVersion: 'uniform64-adjacent-supported-v1', qualityPolicyVersion: 'supported-time-85body-70hand-v1',
    eligibility: 'Only the 14 hash-verified, finite PASS tensors in the frozen eligible manifest qualify. Every FAIL tensor reference must be absent.',
    invariantFailure: 'STOP. Reject changed counts, order, class identity, source hashes, tensor shape, size, finiteness, or eligibility; never design around an inconsistent dataset.',
    policeOfficerPermitted: false,
  },
  evaluation: {
    method: 'LOOCV', foldCount: 14, trainSamplesPerFold: 13, testSamplesPerFold: 1,
    composition: 'One test sample per fold in frozen eligible-sample order; the other thirteen samples form the train side. No randomized fold composition.',
    testAppearancesPerEligibleSample: 1, trainAppearancesPerEligibleSample: 13,
    minimumTrainingExamplesPerClass: 1,
    rejectMissingTrainingClass: true, rejectTrainTestOverlap: true, rejectOmittedOrDuplicateSamples: true,
    ordinaryRandomSplit: 'No random 80/20 split: fourteen recordings and class supports of two to four cannot provide a stable, adequately supported holdout. LOOCV gives every eligible recording one held-out prediction while retaining every class in training.',
    interpretation: 'Within-dataset closed-set engineering behavior only.',
  },
  signerGeneralizationLimitation: 'LOOCV does not solve the signer problem. Each exact class has only one declared signer ID, and those IDs are not verified global identities. A held-out recording may share its declared signer and source conditions with the training recordings of its class. Class and signer metadata are confounded; signer-independent generalization cannot be evaluated.',
  leakagePolicy: {
    testIsValidation: false,
    heldOutTensorAccess: 'After input-integrity validation, the training component must receive only train sample references. The held-out tensor may be loaded by the prediction/evaluation component only after that fold model has completed its frozen training schedule.',
    integrityValidationException: 'Read-only tensor size, hash, shape and finiteness checks before training are allowed solely to validate inputs. They must not expose held-out values or statistics to model fitting or configuration selection.',
    prohibitedHeldOutInfluence: [
      'model fitting', 'early stopping', 'learning-rate scheduling decisions', 'epoch count selection',
      'architecture selection', 'feature selection', 'normalization fitting', 'augmentation selection',
      'hyperparameter tuning', 'threshold tuning',
    ],
    schedule: 'Predeclare a fixed training schedule, including epoch count and any predetermined learning-rate schedule, before examining held-out predictions.',
    earlyStopping: false,
    validationSplit: 'No inner validation split in protocol v1. Never invent a split that leaves a training class unsupported.',
    innerCrossValidation: 'Requires a new protocol version or an explicitly versioned extension before use.',
    architectureRequirement: 'Future loaders and fitting interfaces must separate train-only access from post-training held-out prediction; documentation alone is insufficient enforcement.',
  },
  scalerPolicy: {
    additionalDatasetFittedScaler: 'none', useAcceptedTensorsDirectly: true,
    globalMeanStdFromAllEligibleSamples: false,
    reason: 'Accepted preprocessing is deterministic and per sequence; protocol v1 consumes those unchanged tensors directly.',
    futureFittedNormalization: 'Requires an explicit versioned policy change and a frozen model requirement; fit statistics only on the thirteen TRAIN tensors of each fold, never on its held-out sample.',
  },
  modelSelectionPolicy: {
    freezeBeforeHeldOutPredictions: true,
    freezeItems: ['experiment identity', 'configuration', 'architecture', 'features', 'hyperparameters', 'epoch count', 'learning-rate schedule', 'seed policy'],
    configurationBinding: 'Persist and hash the complete experiment configuration before generating or examining that experiment\'s LOOCV predictions.',
    repeatedOutcomeDrivenTuning: false,
    afterErrorInspection: 'Changes motivated by observed LOOCV errors are exploratory. Preserve prior results and use a new experiment/protocol version before claiming a clean evaluation; versioning does not erase exposure to prior errors.',
    initialExperimentRelationship: 'The pipeline sanity baseline and the predefined temporal CNN are distinct, predeclared experiments. Freeze both configurations before inspecting either experiment\'s held-out predictions; do not use baseline errors to select the supposedly predefined CNN.',
    metricBasedWinnerClaims: 'Comparisons are engineering diagnostics; a tiny count or percentage difference is not evidence that one architecture is generally better.',
  },
  globalSeed: GLOBAL_SEED,
  randomnessPolicy: {
    policyVersion: 'global-20260913-fold-index-v1',
    foldSeedRule: '(globalSeed + zeroBasedFoldIndex) modulo 2^32',
    foldIndexRange: [0, 13],
    foldIndexBasis: 'The deterministic frozen eligible-sample ordering used by folds.json.',
    resetBeforeEachFold: 'Instantiate a fresh model and reset every applicable random generator to the fold seed before initializing or fitting that fold; do not carry weights, optimizer state or RNG progression across folds.',
    applicableGenerators: ['Python random', 'NumPy', 'PyTorch CPU', 'PyTorch CUDA when used', 'DataLoader generators'],
    dataLoaderWorkers: 'If workers are used, freeze deterministic worker-seed derivation in the experiment configuration and record the resulting seed policy before evaluation.',
    unspecifiedDefaultsPermitted: false,
    runtime: 'Use deterministic/reproducible operations where supported. Record hardware, operating system, runtime/library versions, device/delegate, deterministic settings, seed manifest and any unsupported operations or determinism limitations.',
    crossRuntimeGuarantee: 'Exact floating-point equality across different hardware or runtime versions is not guaranteed. Record observed reproducibility checks and differences honestly.',
  },
  classImbalancePolicy: {
    observedClassCounts: [3, 2, 3, 2, 4], preserveObservedDistribution: true,
    duplicateMinorityExamples: false, randomOversampling: false, automaticClassWeights: false,
    futureExplicitClassWeights: 'Only a later model experiment may explicitly predeclare class weights before held-out evaluation; no automatic weighting is permitted in the first baseline.',
  },
  augmentation: 'none',
  augmentationPolicy: {
    enabled: false,
    forbidden: [
      'horizontal mirroring', 'left/right swapping', 'temporal reversal', 'arbitrary coordinate rotations',
      'arbitrary hand swapping', 'synthetic missing landmarks', 'uncontrolled time warping', 'noise injection', 'SMOTE-like tensor synthesis',
    ],
    reason: 'Linguistic semantics are unreviewed and anatomical left/right has meaning; these transformations can change a sign or create invalid examples.',
    futureRequirements: 'Explicit design and versioning are required. Apply approved augmentation only within the TRAIN fold; never augment held-out samples. No augmentation is designed or implemented in this phase.',
  },
  unknownClass: false,
  backgroundTraining: false,
  closedSetPolicy: {
    outputClassCount: 5, prediction: 'Every evaluated prediction selects exactly one frozen vocabulary class.',
    sixthUnknownLabelPermitted: false, unknownRejectionClaimPermitted: false, openSetMetricsPermitted: false,
    reason: 'No trained Unknown class and no negative/background dataset exist.',
    futureWork: 'Unknown/background data and rejection calibration require a later, separately versioned phase.',
  },
  primaryMetrics: ['overall_correct', 'overall_accuracy', 'per_class_recall', 'macro_recall', 'confusion_matrix', 'per_sample_predictions'],
  metricsPolicy: {
    aggregation: 'Calculate the engineering evaluation only after all fourteen held-out predictions are available; aggregate across samples first. Single-sample fold accuracy is not a meaningful standalone performance measure.',
    overall: { correct: 'Count of correctly predicted held-out samples.', support: 14, accuracy: 'overall_correct / 14' },
    perClass: { requiredFields: ['classId', 'classIndex', 'support', 'correct', 'recall'], recall: 'class_correct / class_support', expectedSupport: [3, 2, 3, 2, 4] },
    macroRecall: 'Arithmetic mean of the five per-class recalls in frozen vocabulary order.',
    confusionMatrix: { shape: [5, 5], rows: 'true class', columns: 'predicted class', ordering: 'Frozen classOrder for both axes; alphabetical and runtime-discovered orders are forbidden.', values: 'Integer held-out recording counts; sum must equal fourteen.' },
    perSample: 'Exactly one record per eligible sample, carrying its fold, source tensor hash, true class and predicted class.',
    rawCountsRequired: true, percentages: 'Every reported percentage must show its raw numerator and denominator/support next to it.',
    additionalMetrics: 'none', pValues: false, significanceClaims: false,
  },
  claimsPolicy: {
    allowedWording: [
      'Closed-set LOOCV engineering result on the 14 eligible smoke5-v2 recordings.',
      'Pipeline smoke-test result on smoke5-v2.',
    ],
    forbiddenClaims: [
      'Moroccan Sign Language recognition accuracy', 'generalizes to unseen users', 'signer-independent performance',
      'population generalization', 'validated sign-language recognizer', 'linguistic validation',
      'production readiness', 'production accuracy', 'statistically reliable benchmarking', 'statistical significance',
    ],
    mandatoryScope: 'All protocol and future evaluation reports must identify this as closed-set engineering smoke evaluation on fourteen smoke5-v2 recordings, with class supports 3/2/3/2/4 and unverified signer identities and linguistic review.',
    tinyDifferences: 'For example, 10/14 versus 11/14 correct must not automatically be called a meaningful improvement. Model comparisons remain engineering diagnostics.',
    trainingReadyMeaning: 'Engineering pipeline readiness only; it makes none of the forbidden claims.',
  },
  failedSamplePolicy: {
    excludedCount: 8, use: 'Dataset provenance and diagnostic artifacts only.',
    prohibitedUses: ['model fitting', 'negatives', 'Unknown examples', 'background data', 'validation samples', 'test samples', 'LOOCV'],
    futureUse: 'Requires an explicit new data policy; FAIL recordings cannot silently enter the frozen eligible manifest.',
  },
  futureExperiments: {
    baseline: { experimentId: 'baseline-v1', purpose: 'Intentionally simple pipeline sanity check: tensor reader → labels → folds → training loop → prediction → evaluation.', architecture: 'Deferred to a later task; no baseline model is selected or fitted by this protocol.', finalModelClaim: false },
    temporalCnn: { experimentId: 'temporal-cnn-v1', purpose: 'Predefined temporal CNN engineering experiment evaluated under the same frozen rules.', architecture: 'Conceptual temporal Conv1D, pooling and five-class classifier only; implementation details and configuration are deferred and must be frozen before predictions are examined.' },
    executionAuthorizedByThisFreeze: false,
  },
  finalModelPolicy: {
    evaluationTraining: { modelsPerExperiment: 14, trainSamplesPerModel: 13, purpose: 'Generate the fourteen held-out engineering predictions.' },
    futureAllDataTraining: { modelCount: 1, trainSamples: 14, independentTestResult: false, seed: GLOBAL_SEED + 14, seedRule: '(globalSeed + 14) modulo 2^32', purpose: 'Future browser integration after architecture and configuration are frozen; not an independently evaluated model.' },
    transferOfEvaluationClaim: 'LOOCV describes the predeclared fitting procedure on held-out recordings; it is not an independent test score for the separate all-data fitted model.',
    trainNow: false,
  },
  futureTrainingOutputContract: {
    artifacts: ['experiment-manifest.json', 'fold-status.jsonl', 'held-out-predictions.jsonl', 'metrics.json', 'README.md'],
    requiredIdentityFields: ['experimentId', 'protocolId', 'datasetId', 'featureDatasetId', 'vocabularyId', 'classOrder'],
    requiredHashBindings: [
      'sourceManifestSHA256', 'eligibleSamplesSHA256', 'sourceTensorSHA256', 'protocolSHA256', 'foldsSHA256',
      'frozenExperimentConfigurationSHA256', 'runtimeEnvironmentSHA256', 'seedManifestSHA256',
      'trainingImplementationSHA256', 'evaluationImplementationSHA256', 'outputArtifactSHA256',
    ],
    runtimeManifest: 'Record actual hardware/device, operating system, Python/library versions where applicable, deterministic settings and limitations; persist and hash this manifest.',
    seedManifest: 'Record global seed, deterministic fold seeds, applicable RNG seeds and worker-seed policy; persist and hash this manifest.',
    heldOutPredictionCount: 14,
    predictionFields: ['experimentId', 'protocolId', 'foldId', 'sampleId', 'sourceTensorSHA256', 'trueClassId', 'trueClassIndex', 'predictedClassId', 'predictedClassIndex'],
    foldStatus: 'Record every fold attempt, completion/failure, error details, actual seed and configuration binding. No silent fold dropping, substitution, fabricated prediction or unreported retry.',
    completion: 'COMPLETE requires exactly one genuine held-out prediction for each of the fourteen eligible samples, all integrity bindings verified, and no unresolved fold or generation error.',
    failures: 'If fitting or prediction fails, preserve honest INCOMPLETE/FAILED status and diagnostics. Partial genuine predictions may be retained with explicit incomplete status; do not present them as the frozen complete fourteen-sample evaluation.',
    metricsPublication: 'Publish aggregate metrics only for the validated complete fourteen-prediction evaluation. Do not invent predictions, impute failures as results, or select favorable reruns.',
    reproducibility: 'Report performed checks, actual output hashes and observed differences; never claim exact deterministic training merely because a seed was set.',
    allDataModel: 'Any later all-data artifact must have a distinct identity and state that it has no independent test result.',
    noMetricsNow: 'The protocol freeze produces no model, predictions, accuracy fields, fabricated metrics or numerical metric placeholders.',
  },
  integrityPolicy: {
    immutableInputs: ['smoke5-v2 curation', 'landmarks-v1', 'features-v1', 'all fourteen PASS tensors', 'shared preprocessing', 'raw source videos and CSVs'],
    verification: 'Verify relevant hashes before and after protocol generation and preserve source hashes in protocol provenance. Future fitting must revalidate the frozen protocol, eligible manifest, folds and tensor hashes before access.',
    unexpectedMutation: 'STOP. Reject source mutation, changed eligible sets, changed folds or changed rules under the same protocol version.',
    privateArtifacts: 'Sample-specific protocol manifests remain under Git-ignored data/scope5/training/mosl-v1/smoke5-v2/protocol-v1; no private raw dataset content is copied into tracked or public/product directories.',
    protocolImmutability: 'Persist deterministic, hash-verifiable protocol and fold artifacts. A changed source set, evaluation rule or declared extension requires an explicit version; never overwrite a different artifact under the same frozen identity.',
  },
  currentPhase: {
    purpose: 'Training protocol and data-evaluation design freeze only.',
    forbiddenWork: ['model fitting', 'baseline implementation', 'PyTorch environment creation', 'ML framework dependency installation', 'temporal CNN implementation', 'ONNX export', 'browser inference changes', 'production UI changes', 'tensor modification', 'synthetic sample creation', 'dataset/fold loader implementation'],
    stopAfter: 'Freeze and validate protocol-v1. Deterministic dataset and LOOCV fold loader implementation is a later task requiring separate authorization.',
  },
} as const);

export type TrainingProtocolPolicy = typeof PROTOCOL_POLICY;
export interface ProtocolReadmeInput {
  protocolId: string;
  protocolSHA256: string;
  eligibleSHA256: string;
  foldsSHA256: string;
}

/** Private artifact documentation; hashes bind the prose to the exact generated protocol and manifests. */
export function protocolReadme(input: ProtocolReadmeInput): string {
  assert.equal(input.protocolId, 'smoke5-v2-training-protocol-v1', 'Unexpected frozen training protocol identity');
  for (const [name, digest] of Object.entries(input)) {
    if (name !== 'protocolId') assert(/^[0-9a-f]{64}$/u.test(digest), `Invalid README hash: ${name}`);
  }
  return [
    '# smoke5-v2 training protocol v1', '',
    `Protocol: ${input.protocolId}. Dataset and vocabulary: mosl-smoke5-v2. Task: closed_set_5_class_engineering.`, '',
    'This artifact freezes evaluation rules before model fitting. No model has been trained, no ML environment has been created, and no predictions or model metrics exist.', '',
    'Input: fourteen accepted [64,170] tensors, each headerless little-endian Float32 with 43,520 bytes. The eight quality FAIL recordings remain in source provenance and are excluded from training, validation, testing, negatives, Unknown and background use.', '',
    '| Index | Class | Eligible tensors |', '|---:|---|---:|',
    ...PROTOCOL_POLICY.classOrder.map((classId, index) => `| ${index} | ${classId} | ${PROTOCOL_POLICY.expectedCounts.perClass[index]} |`), '',
    'Preprocessing remains sign-features-170-v1; feature layout anatomical-170-v1; temporal resampling uniform64-adjacent-supported-v1; quality policy supported-time-85body-70hand-v1. Accepted tensors are consumed directly with no fitted dataset scaler.', '',
    '## Evaluation and leakage', '',
    'The protocol uses fourteen deterministic LOOCV folds. Each fold trains a fresh model on thirteen recordings and holds out exactly one. Every recording is tested once and appears in training thirteen times. Each training fold must retain at least one example of every class; overlap, omissions, duplicates or an unsupported class reject the protocol.', '',
    PROTOCOL_POLICY.evaluation.ordinaryRandomSplit, '',
    'TEST != VALIDATION. The held-out recording cannot influence fitting, early stopping, learning-rate decisions, epoch count, architecture, feature selection, normalization, augmentation, hyperparameters or thresholds. Initial experiments use a predeclared fixed schedule and no early stopping or inner validation split.', '',
    PROTOCOL_POLICY.leakagePolicy.heldOutTensorAccess,
    PROTOCOL_POLICY.leakagePolicy.integrityValidationException, '',
    'Future loader and fitting interfaces must enforce train-only access. No global mean/std is fitted across the fourteen samples. A future scaler, inner cross-validation or other policy extension requires explicit versioning, and fitted statistics may use only each fold\'s TRAIN side.', '',
    '## Experiments and randomness', '',
    'baseline-v1 is reserved for a simple pipeline sanity check. temporal-cnn-v1 is reserved for a predefined temporal CNN experiment. Neither architecture is implemented or selected in detail here. Freeze and hash both complete configurations before examining either experiment\'s held-out predictions. Repeated tuning against LOOCV outcomes is prohibited; changes after error inspection are exploratory and require a new experiment/protocol version before any clean-evaluation claim.', '',
    `Global seed: ${GLOBAL_SEED}. Fold seed: (global seed + zero-based fold index) modulo 2^32, with indices 0–13 from the frozen eligible ordering. A future separate all-data model uses (global seed + 14) modulo 2^32 = ${GLOBAL_SEED + 14}. Reset applicable Python random, NumPy, PyTorch CPU/CUDA and DataLoader generators before each fresh fold model. Freeze deterministic worker-seed derivation if workers are used. No unspecified default randomness is permitted.`, '',
    PROTOCOL_POLICY.randomnessPolicy.runtime,
    PROTOCOL_POLICY.randomnessPolicy.crossRuntimeGuarantee, '',
    'Class counts remain 3/2/3/2/4. No example duplication, random oversampling or automatic class weighting is introduced. Any later explicit weighting must be predeclared in its model experiment before evaluation.', '',
    '## Augmentation and closed-set scope', '',
    'Augmentation is NONE. Mirroring, left/right or hand swapping, temporal reversal, arbitrary rotations, synthetic missing landmarks, uncontrolled time warping, noise injection and SMOTE-like synthesis are forbidden. Unreviewed sign semantics and anatomical left/right information make such transformations potentially invalid. Future augmentation requires explicit design and versioning, applies only to training folds, and never changes held-out recordings.', '',
    'There are exactly five outputs in the frozen order. Unknown is absent because no trained Unknown class or negative/background dataset exists. No sixth label, Unknown-rejection claim or open-set metric is permitted. Unknown/background data and rejection calibration belong to a later versioned phase.', '',
    '## Future evaluation output', '',
    'Future training must generate all fourteen genuine held-out predictions before publishing an aggregate engineering evaluation. Report total correct / 14 and accuracy; each class\'s support, correct count and recall; macro recall; a 5×5 integer confusion matrix; and every per-sample prediction. Do not treat one-observation fold accuracy as a standalone performance estimate.', '',
    'Confusion matrix rows are true classes and columns are predicted classes. Both axes use the exact vocabulary order shown above. Every percentage must have its raw count and denominator visible, because supports of two to four recordings make percentages easy to overinterpret. No secondary metric collection, p-values or significance claims are included.', '',
    'The future output contract requires experiment, source dataset, vocabulary and protocol identities; source-manifest and tensor hashes; eligible/protocol/fold hashes; configuration, runtime, seed and implementation hashes; and output hashes. Predictions identify experiment, protocol, fold, sample, tensor hash, true class/index and predicted class/index. Record all fold failures and retries honestly. Missing predictions or unresolved errors require INCOMPLETE/FAILED status; no fabricated values, favorable-rerun selection or partial-result substitution for the complete evaluation is permitted.', '',
    'Evaluation training creates fourteen fold models per experiment, each fitted on thirteen recordings. A later final engineering model may train on all fourteen after its architecture is frozen for browser integration. That separate all-data model has no independent test result. Neither form of training occurs in this task.', '',
    '## Mandatory interpretation', '',
    PROTOCOL_POLICY.signerGeneralizationLimitation, '',
    'Allowed wording: "Closed-set LOOCV engineering result on the 14 eligible smoke5-v2 recordings" or "Pipeline smoke-test result on smoke5-v2." This extremely small dataset does not support Moroccan Sign Language recognition accuracy, unseen-user or population generalization, signer-independent performance, linguistic validation, production readiness or statistically reliable benchmarking. A difference such as 10/14 versus 11/14 is an engineering diagnostic, not proof of a generally better architecture.', '',
    '## Frozen files and integrity', '',
    'protocol.json contains the machine-readable rules and source provenance. eligible-samples.jsonl lists the fourteen eligible identities and tensor hashes. folds.json persists all fourteen folds. validation.json records input, tensor, class-order, fold and protocol integrity checks and readiness for later implementation. README.md explains the same scope. No model metric placeholders are created.', '',
    '| Artifact | SHA-256 |', '|---|---|',
    `| protocol.json | ${input.protocolSHA256} |`,
    `| eligible-samples.jsonl | ${input.eligibleSHA256} |`,
    `| folds.json | ${input.foldsSHA256} |`, '',
    'All sample-specific artifacts remain private under Git-ignored data/scope5/training/mosl-v1/smoke5-v2/protocol-v1. Source curation, landmarks, features, PASS tensors, raw sources and shared preprocessing remain unchanged. Verify their relevant hashes before and after generation and reject unexpected mutation. Later training must verify these exact protocol, eligible, fold and tensor hashes again; altered inputs or rules cannot silently reuse this frozen protocol version.', '',
    'Stop after this freeze is validated. Deterministic dataset and LOOCV fold loader implementation is the next separately authorized step. No loader, training environment, baseline, CNN, ONNX model, browser classifier or production UI is implemented by this phase.', '',
  ].join('\n');
}
