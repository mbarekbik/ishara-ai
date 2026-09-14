"""Canonical containment with conservative rejection of links and Windows aliases."""

import os
from pathlib import Path, PureWindowsPath
import re

from .errors import UnsafePathError


def validate_relative(reference: str, *, operation: str, identity: str | None = None) -> None:
    if not isinstance(reference, str) or not reference:
        raise UnsafePathError(operation, "expected a nonempty relative reference", identity)
    parts = reference.split("/")
    if (
        PureWindowsPath(reference).is_absolute()
        or PureWindowsPath(reference).drive
        or reference.startswith("/")
        or re.search(r"[\\:\x00-\x1f\x7f]", reference)
        or any(part in ("", ".", "..") or part.endswith((".", " ")) for part in parts)
        or any(re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part, re.I) for part in parts)
    ):
        raise UnsafePathError(operation, "unsafe relative reference", identity)


def contained_path(root: Path, reference: str, *, operation: str, identity: str | None = None) -> Path:
    validate_relative(reference, operation=operation, identity=identity)
    base = Path(os.path.abspath(root))
    target = base.joinpath(*reference.split("/"))
    # Reject junctions/symlinks even if they happen to point back inside the root today.
    for component in (*reversed(target.parents), target):
        if component.is_symlink() or component.is_junction():
            raise UnsafePathError(operation, "symlink/junction references are not permitted", identity)
    canonical_base = base.resolve(strict=False)
    canonical_target = target.resolve(strict=False)
    if not canonical_target.is_relative_to(canonical_base) or canonical_target == canonical_base:
        raise UnsafePathError(operation, "reference escapes its approved root", identity)
    return canonical_target
