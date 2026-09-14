"""Failures identify the operation and identity without disclosing tensor values."""


class DataAccessError(ValueError):
    code = "DATA_ACCESS_ERROR"

    def __init__(self, operation: str, reason: str, identity: str | None = None):
        self.operation = operation
        self.identity = identity
        super().__init__(f"{self.code}: {operation}" + (f" [{identity}]" if identity else "") + f": {reason}")


class ProtocolIntegrityError(DataAccessError):
    code = "PROTOCOL_INTEGRITY"


class ManifestSchemaError(DataAccessError):
    code = "MANIFEST_SCHEMA"


class UnsafePathError(DataAccessError):
    code = "UNSAFE_PATH"


class TensorMissingError(DataAccessError):
    code = "TENSOR_MISSING"


class TensorHashError(DataAccessError):
    code = "TENSOR_HASH_MISMATCH"


class TensorFormatError(DataAccessError):
    code = "TENSOR_FORMAT"


class NonFiniteTensorError(TensorFormatError):
    code = "NONFINITE_TENSOR"


class FoldIntegrityError(DataAccessError):
    code = "FOLD_INTEGRITY"


class ClassIdentityError(ManifestSchemaError):
    code = "CLASS_IDENTITY"
