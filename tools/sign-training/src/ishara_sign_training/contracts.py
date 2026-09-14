"""Immutable metadata only; sizes, vocabulary and fold order come from the protocol."""

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class ArtifactPins:
    protocol_sha256: str
    eligible_sha256: str
    folds_sha256: str


@dataclass(frozen=True, slots=True)
class TensorSpec:
    shape: tuple[int, int]
    dtype: str
    byte_order: str
    serialization: str
    byte_count: int

    @property
    def element_count(self) -> int:
        return self.shape[0] * self.shape[1]


@dataclass(frozen=True, slots=True)
class EligibleSampleRef:
    sample_id: str
    class_id: str
    class_index: int
    source_csv: str
    source_row: int
    tensor_reference: str
    tensor_sha256: str
    feature_dataset_id: str
    artifact_origin: str


@dataclass(frozen=True, slots=True)
class FoldDefinition:
    protocol_id: str
    fold_id: str
    fold_index: int
    seed: int
    train_sample_ids: tuple[str, ...]
    test_sample_id: str
    train_class_counts: tuple[int, ...]
    test_class_id: str


@dataclass(frozen=True, slots=True)
class FrozenTrainingProtocol:
    protocol_id: str
    dataset_id: str
    vocabulary_id: str
    feature_dataset_id: str
    task_type: str
    class_order: tuple[str, ...]
    class_counts: tuple[int, ...]
    global_seed: int
    excluded_count: int
    tensor_spec: TensorSpec
    feature_relative_root: str
    eligible: tuple[EligibleSampleRef, ...]
    folds: tuple[FoldDefinition, ...]
    artifact_hashes: Mapping[str, str]
    source_manifest_hashes: Mapping[str, str]
    source_integrity_hashes: Mapping[str, str]

