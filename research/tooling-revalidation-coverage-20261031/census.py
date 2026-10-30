"""Census helpers for the repository-wide packet verification audit.

The frozen ``scripts/revalidate_all.py`` invokes every packet verifier with no
packet-specific arguments and summarises the result as pass, fail or skip. This
module measures what that summary cannot show: which verifiers were never
executed because they require an argument, and whether the inputs an unexecuted
verifier needs are retained in the repository at all.
"""
from __future__ import annotations

import ast
import gzip
import hashlib
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Iterable, Iterator, Optional

HEX = frozenset('0123456789abcdef')
IMAGE_SUFFIXES = ('.so', '.elf', '.bin')
IMAGE_NAME_SUFFIXES = tuple(suffix for base in IMAGE_SUFFIXES
                            for suffix in (base, base + '.gz'))
GZ_SUFFIX = '.gz'
REPORT_NAMES = ('report.json', 'report.json.gz')


@dataclass(frozen=True)
class Packet:
    """One research packet directory and the files that decide its audit."""

    name: str
    directory: Path

    @property
    def verify_path(self) -> Path:
        return self.directory / 'verify.py'


@dataclass(frozen=True)
class VerifierContract:
    """The command-line arguments a packet verifier cannot run without."""

    required: tuple[str, ...]
    error: Optional[str] = None


def discover_packets(research_dir: Path) -> list[Packet]:
    """Every non-hidden directory under ``research/``, as the audit sees them."""
    return [Packet(path.name, path) for path in sorted(research_dir.iterdir())
            if path.is_dir() and not path.name.startswith('.')]


def is_sha256(value: str) -> bool:
    return len(value) == 64 and set(value) <= HEX


def required_options(source: str) -> VerifierContract:
    """Extract ``add_argument`` options declared ``required=True``.

    Only literal ``required=True`` counts. A computed condition is reported as
    unknown rather than guessed, because the census must not overstate which
    verifiers can be invoked without arguments.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return VerifierContract((), f'syntax error: {error.msg}')
    names: set[str] = set()
    unknown = False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr != 'add_argument':
            continue
        options = [arg.value for arg in node.args
                   if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
                   and arg.value.startswith('-')]
        requirement = next((kw.value for kw in node.keywords
                            if kw.arg == 'required'), None)
        if requirement is None:
            continue
        if isinstance(requirement, ast.Constant) and requirement.value is True:
            names.update(options)
        else:
            unknown = True
    error = 'required condition is computed' if unknown else None
    return VerifierContract(tuple(sorted(names)), error)


def report_payloads(packet: Packet) -> Iterator[dict]:
    """Yield JSON reports a packet retains under ``runtime/``."""
    runtime = packet.directory / 'runtime'
    if not runtime.is_dir():
        return
    for path in sorted(runtime.rglob('report*.json*')):
        try:
            payload = load_json(path)
        except (OSError, ValueError):
            continue
        if isinstance(payload, dict):
            yield payload


def load_json(path: Path) -> object:
    raw = path.read_bytes()
    if path.name.endswith(GZ_SUFFIX):
        raw = gzip.decompress(raw)
    return json.loads(raw)


def image_hashes(packet: Packet) -> tuple[dict[str, str], bool]:
    """Image hashes a packet records, and whether any report records them.

    The two published schemas are ``images`` and ``image_sha256``; both map a
    role such as ``original`` or ``candidate`` to a sha256.
    """
    recorded = False
    for payload in report_payloads(packet):
        for key in ('images', 'image_sha256'):
            value = payload.get(key)
            if isinstance(value, dict) and value and all(
                    isinstance(item, str) and is_sha256(item)
                    for item in value.values()):
                recorded = True
                return dict(value), recorded
    return {}, recorded


def binary_candidates(root: Path) -> Iterator[Path]:
    """Files that could hold a Solana program image."""
    for suffix in IMAGE_SUFFIXES:
        for path in root.rglob(f'*{suffix}'):
            if path.is_file():
                yield path
        for path in root.rglob(f'*{suffix}{GZ_SUFFIX}'):
            if path.is_file():
                yield path


def all_candidates(root: Path) -> Iterator[Path]:
    """Every regular file outside ``.git`` that could hold an image."""
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        try:
            parts = path.relative_to(root).parts
        except ValueError:
            continue
        if '.git' in parts:
            continue
        yield path


def digest_bytes(path: Path) -> Optional[str]:
    """sha256 of the file, decompressing a single gzip layer when present."""
    try:
        raw = path.read_bytes()
        if path.name.endswith(GZ_SUFFIX):
            raw = gzip.decompress(raw)
    except (OSError, EOFError, gzip.BadGzipFile):
        return None
    return hashlib.sha256(raw).hexdigest()


def index_images(root: Path, *, exhaustive: bool = False,
                 paths: Optional[Iterable[Path]] = None) -> dict[str, list[str]]:
    """Map image sha256 to the repository paths that hold those bytes."""
    index: dict[str, list[str]] = {}
    if paths is not None:
        candidates: Iterable[Path] = paths
    else:
        candidates = (all_candidates(root) if exhaustive
                      else binary_candidates(root))
    for path in candidates:
        digest = digest_bytes(path)
        if digest is None:
            continue
        index.setdefault(digest, []).append(
            path.relative_to(root).as_posix())
    return index


def resolve_images(hashes: dict[str, str],
                   index: dict[str, list[str]]) -> dict[str, Optional[str]]:
    return {role: (index[digest][0] if digest in index else None)
            for role, digest in sorted(hashes.items())}
