"""zip_guard — a defensive .zip upload inspector/extractor (Python standard library only).

Protections (each one is explained in README.md):

  1. Uncompressed size  — at most 10 MiB of ACTUAL decompressed bytes per upload, counted while
                          streaming every member in small chunks. Header sizes are only a fast
                          pre-check; they are never trusted.
  2. Nesting depth      — a member that IS a zip (by magic bytes, not by extension) is inspected
                          recursively in memory; the outer file is depth 1, depth 6 is rejected.
                          The size budget and the deadline are shared across every level.
  3. Processing time    — a monotonic deadline (5 s) checked before parsing, between members and
                          between chunks. Optional hard wall-clock kill: run_with_hard_timeout().
  4. Fail closed        — the first limit hit stops the work and raises a ZipRejected subclass with
                          a machine code and a user-facing message. Files already written are
                          removed.
  5. .zip only          — extension AND magic bytes AND a parseable central directory; encrypted
                          members, absolute paths, ``..`` traversal, symlinks/special files,
                          duplicate names and compression methods other than stored/deflate are
                          refused.
  6. Monitoring         — one structured JSON log line per attempt (accepted or rejected) with the
                          reason code, sizes, member count, depth, elapsed ms, the upload's sha256
                          and a caller-supplied request id. File contents are never logged; names
                          are sanitized (no control characters, truncated).

Typical use::

    from zip_guard import extract_zip_upload, ZipRejected

    try:
        result = extract_zip_upload(data, filename, request_id=req_id)   # in memory
        # or: extract_zip_upload(data, filename, dest_dir=fresh_empty_dir)
    except ZipRejected as e:
        return http_error(e.http_status, {"error": e.user_message, "code": e.code})
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import logging
import os
import stat
import struct
import time
import zipfile
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

__all__ = [
    "Limits",
    "ExtractionResult",
    "ZipRejected",
    "ZipLimitExceeded",
    "UnsafeZipContent",
    "InvalidZipFile",
    "extract_zip_upload",
    "run_with_hard_timeout",
]

LOGGER_NAME = "zip_guard"
log = logging.getLogger(LOGGER_NAME)

MiB = 1024 * 1024

# Local file header, empty-archive end-of-central-directory. A spanned-archive marker
# (PK\x07\x08) or anything else at offset 0 is not accepted as a standalone upload.
ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06")
EOCD_SIG = b"PK\x05\x06"
ZIP64_LOCATOR_SIG = b"PK\x06\x07"
ZIP64_EOCD_SIG = b"PK\x06\x06"

ALLOWED_METHODS = {zipfile.ZIP_STORED: "stored", zipfile.ZIP_DEFLATED: "deflate"}
FLAG_ENCRYPTED = 0x0001
FLAG_STRONG_ENCRYPTION = 0x0040


# ── Limits ───────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Limits:
    max_total_bytes: int = 10 * MiB      # requirement 1: actual decompressed bytes, all levels
    max_depth: int = 5                   # requirement 2: outer archive = 1
    max_seconds: float = 5.0             # requirement 3: one deadline per upload
    max_upload_bytes: int = 10 * MiB     # the compressed upload itself (cap it at the edge too)
    max_members: int = 1000              # entries per archive, checked before zipfile parses
    max_ratio: Optional[float] = 100.0   # per-member decompressed/compressed (None = off) ...
    ratio_floor: int = 256 * 1024        # ... applied once a member has produced this many bytes
    chunk_size: int = 64 * 1024          # bytes of output per read() — bounds the work per step
    max_name_length: int = 1024
    max_component_length: int = 255


# ── Errors ───────────────────────────────────────────────────────────────────────────────────


class ZipRejected(Exception):
    """Base class. ``code`` is for machines/metrics, ``user_message`` is safe to show a user."""

    http_status = 422
    default_message = "This file can't be accepted."

    def __init__(self, code: str, user_message: Optional[str] = None, *, detail: str = "",
                 member: Optional[str] = None):
        self.code = code
        self.user_message = user_message or self.default_message
        self.detail = detail          # internal, for logs (never file contents)
        self.member = member          # raw member name, sanitized before logging
        super().__init__(f"{code}: {self.user_message}")

    def __reduce__(self):  # survive pickling across the hard-timeout process boundary
        return (_rebuild_error, (type(self).__name__, self.code, self.user_message, self.detail, self.member))


class ZipLimitExceeded(ZipRejected):
    http_status = 413
    default_message = "This archive is too large to unpack safely."


class UnsafeZipContent(ZipRejected):
    default_message = "This archive contains entries that can't be unpacked safely."


class InvalidZipFile(ZipRejected):
    http_status = 415
    default_message = "Only valid .zip files are accepted."


def _rebuild_error(cls_name, code, user_message, detail, member):
    cls = {c.__name__: c for c in (ZipRejected, ZipLimitExceeded, UnsafeZipContent, InvalidZipFile)}[cls_name]
    return cls(code, user_message, detail=detail, member=member)


MESSAGES = {
    "uncompressed_size_exceeded": "This archive unpacks to more than {mb} MB. Upload a smaller archive.",
    "compression_ratio_exceeded": "This archive is compressed too aggressively to unpack safely.",
    "nesting_depth_exceeded": "This archive contains archives nested more than {depth} levels deep.",
    "time_exceeded": "This archive took too long to process and was rejected.",
    "too_many_members": "This archive contains more than {members} files.",
    "upload_too_large": "This upload is larger than {mb} MB.",
    "bad_extension": "Only .zip files are accepted.",
    "not_a_zip": "This file is not a valid .zip archive.",
    "corrupt": "This .zip file is damaged and can't be read.",
    "header_mismatch": "This .zip file's headers don't match its contents.",
    "encrypted": "Password-protected archives aren't accepted. Remove the password and try again.",
    "unsupported_compression": "This archive uses a compression method that isn't supported (use standard zip/deflate).",
    "absolute_path": "This archive contains a file with an absolute path.",
    "path_traversal": "This archive contains a file path that points outside the archive.",
    "unsafe_path": "This archive contains a file name that isn't allowed.",
    "symlink": "This archive contains a symbolic link, which isn't allowed.",
    "special_file": "This archive contains a device or other special file, which isn't allowed.",
    "duplicate_name": "This archive contains two files with the same name.",
}


def _msg(code: str, limits: Optional[Limits] = None) -> str:
    limits = limits or Limits()
    return MESSAGES[code].format(
        mb=(limits.max_upload_bytes if code == "upload_too_large" else limits.max_total_bytes) // MiB,
        depth=limits.max_depth, members=limits.max_members)


# ── Result ───────────────────────────────────────────────────────────────────────────────────


@dataclass
class ExtractionResult:
    files: Dict[str, bytes] = field(default_factory=dict)    # in-memory mode
    written: List[Path] = field(default_factory=list)        # dest_dir mode
    total_bytes: int = 0
    member_count: int = 0
    max_depth: int = 0
    elapsed_ms: int = 0
    sha256: str = ""


# ── Internal state: ONE budget + ONE deadline per upload ─────────────────────────────────────


class _State:
    def __init__(self, limits: Limits, clock: Callable[[], float]):
        self.limits = limits
        self.clock = clock
        self.started = clock()
        self.deadline = self.started + limits.max_seconds
        self.total = 0               # actual decompressed bytes, every level
        self.members = 0             # members processed, every level
        self.depth = 0               # deepest archive opened
        self.outputs: Dict[str, str] = {}   # casefolded output path -> "file" | "dir"

    def claim(self, out: str, is_dir: bool, raw: str) -> None:
        """Refuse two entries that would land on the same path — exact duplicates, names that differ
        only by case (they collide on macOS/Windows), and a file that is also a directory ("a" and
        "a/b.txt"), at any nesting level."""
        parts = out.casefold().split("/")
        for i in range(1, len(parts)):
            anc = "/".join(parts[:i])
            if self.outputs.get(anc) == "file":
                raise UnsafeZipContent("duplicate_name", _msg("duplicate_name"), member=raw)
            self.outputs[anc] = "dir"
        key = "/".join(parts)
        prior = self.outputs.get(key)
        if (prior and not is_dir) or (prior == "file" and is_dir):
            raise UnsafeZipContent("duplicate_name", _msg("duplicate_name"), member=raw)
        self.outputs[key] = "dir" if is_dir else "file"

    def check_time(self) -> None:
        if self.clock() > self.deadline:
            raise ZipLimitExceeded("time_exceeded", _msg("time_exceeded", self.limits),
                                   detail=f"deadline {self.limits.max_seconds}s")

    def charge(self, n: int, member: str) -> None:
        """Count n ACTUAL decompressed bytes; reject the moment the total would pass the cap."""
        if self.total + n > self.limits.max_total_bytes:
            self.total += n
            raise ZipLimitExceeded("uncompressed_size_exceeded",
                                   _msg("uncompressed_size_exceeded", self.limits),
                                   detail="actual bytes", member=member)
        self.total += n

    @property
    def remaining(self) -> int:
        return max(0, self.limits.max_total_bytes - self.total)


# ── Pre-parse checks ─────────────────────────────────────────────────────────────────────────


def _eocd_entry_count(data: bytes) -> tuple[int, int]:
    """(entries, central-directory bytes) from the end-of-central-directory record, read BEFORE
    zipfile builds a ZipInfo per entry (a 10 MB upload can declare ~200k entries)."""
    start = max(0, len(data) - 22 - 0xFFFF)
    idx = data.rfind(EOCD_SIG, start)
    if idx < 0 or idx + 22 > len(data):
        raise InvalidZipFile("not_a_zip", _msg("not_a_zip"), detail="no end-of-central-directory record")
    (_sig, disk, cd_disk, _n_disk, n_total, cd_size, _cd_off, _clen) = struct.unpack("<4sHHHHIIH", data[idx:idx + 22])
    if disk != 0 or cd_disk != 0:
        raise InvalidZipFile("not_a_zip", _msg("not_a_zip"), detail="multi-disk archive")
    if n_total == 0xFFFF or cd_size == 0xFFFFFFFF:            # ZIP64: real values live elsewhere
        loc = idx - 20
        if loc < 0 or data[loc:loc + 4] != ZIP64_LOCATOR_SIG:
            raise InvalidZipFile("corrupt", _msg("corrupt"), detail="zip64 locator missing")
        (_s, _d, z64_off, _disks) = struct.unpack("<4sIQI", data[loc:loc + 20])
        if z64_off + 56 > len(data) or data[z64_off:z64_off + 4] != ZIP64_EOCD_SIG:
            raise InvalidZipFile("corrupt", _msg("corrupt"), detail="zip64 record missing")
        n_total, cd_size = struct.unpack("<QQ", data[z64_off + 32:z64_off + 48])
    return n_total, cd_size


def _validate_name(raw: str, limits: Limits) -> tuple[str, bool]:
    """Return (normalized relative path, is_dir) or raise UnsafeZipContent."""
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in raw):
        raise UnsafeZipContent("unsafe_path", _msg("unsafe_path", limits), detail="control character", member=raw)
    norm = raw.replace("\\", "/")
    if norm.startswith("/") or (len(norm) >= 2 and norm[1] == ":" and norm[0].isalpha()):
        raise UnsafeZipContent("absolute_path", _msg("absolute_path", limits), member=raw)
    parts = norm.split("/")
    if any(p == ".." for p in parts):
        raise UnsafeZipContent("path_traversal", _msg("path_traversal", limits), member=raw)
    clean = [p for p in parts if p not in ("", ".")]
    if not clean or len(norm) > limits.max_name_length or any(len(p) > limits.max_component_length for p in clean):
        raise UnsafeZipContent("unsafe_path", _msg("unsafe_path", limits), detail="empty or too long", member=raw)
    return "/".join(clean), norm.endswith("/")


def _precheck_member(info: zipfile.ZipInfo, limits: Limits) -> tuple[str, bool]:
    raw = info.orig_filename            # before zipfile's own sanitizing (it cuts at a NUL)
    rel, is_dir = _validate_name(raw, limits)
    if info.flag_bits & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION):
        raise UnsafeZipContent("encrypted", _msg("encrypted", limits), member=raw)
    if info.compress_type not in ALLOWED_METHODS:
        raise UnsafeZipContent("unsupported_compression", _msg("unsupported_compression", limits),
                               detail=f"method {info.compress_type}", member=raw)
    mode = (info.external_attr >> 16) & 0xFFFF
    kind = stat.S_IFMT(mode)
    if kind == stat.S_IFLNK:
        raise UnsafeZipContent("symlink", _msg("symlink", limits), member=raw)
    if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
        raise UnsafeZipContent("special_file", _msg("special_file", limits), detail=oct(kind), member=raw)
    if limits.max_ratio and info.file_size >= limits.ratio_floor and \
            info.file_size > limits.max_ratio * max(info.compress_size, 1):
        raise ZipLimitExceeded("compression_ratio_exceeded", _msg("compression_ratio_exceeded", limits),
                               detail="declared", member=raw)
    return rel, is_dir


# ── Core ─────────────────────────────────────────────────────────────────────────────────────


class _Sink:
    """Where member bytes go: memory (dict) or a caller directory (safe join, O_EXCL, 0600)."""

    def __init__(self, dest_dir: Optional[os.PathLike]):
        self.files: Dict[str, bytes] = {}
        self.written: List[Path] = []
        self._dirs: List[Path] = []
        self.root: Optional[Path] = None
        if dest_dir is not None:
            root = Path(dest_dir).resolve(strict=True)
            if not root.is_dir():
                raise NotADirectoryError(str(root))
            self.root = root

    def _target(self, rel: str) -> Path:
        assert self.root is not None
        target = (self.root / rel).resolve(strict=False)
        if target != self.root and not target.is_relative_to(self.root):   # also defeats symlinked parents
            raise UnsafeZipContent("path_traversal", _msg("path_traversal"), member=rel)
        return target

    def make_dir(self, rel: str) -> None:
        if self.root is None:
            return
        target = self._target(rel)
        if not target.exists():
            os.makedirs(target, mode=0o700, exist_ok=True)
            self._dirs.append(target)

    def open_file(self, rel: str):
        if self.root is None:
            return io.BytesIO()
        target = self._target(rel)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if target.parent.resolve() != target.parent or not target.parent.is_relative_to(self.root):
            raise UnsafeZipContent("path_traversal", _msg("path_traversal"), member=rel)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        fd = os.open(target, flags, 0o600)          # never executable, never the archive's modes
        self.written.append(target)
        return os.fdopen(fd, "wb")

    def finish_file(self, rel: str, fh) -> None:
        if self.root is None:
            self.files[rel] = fh.getvalue()
        fh.close()

    def discard(self) -> None:
        for p in reversed(self.written):
            try:
                p.unlink()
            except OSError:
                pass
        for d in reversed(self._dirs):
            try:
                d.rmdir()
            except OSError:
                pass
        self.files.clear()
        self.written.clear()


def _read_member(zf: zipfile.ZipFile, info: zipfile.ZipInfo, rel: str, state: _State, sink: _Sink,
                 depth: int) -> None:
    limits = state.limits
    raw = info.orig_filename
    # Never let zipfile stop at the header's claimed size: it truncates output to file_size (and
    # then fails the CRC), which would hide a lying header. Give it room for one full chunk past
    # the remaining budget, so the chunk that crosses the budget reaches our counter first.
    probe = copy.copy(info)
    probe.file_size = state.remaining + limits.chunk_size + 1
    produced = 0
    nested: Optional[io.BytesIO] = None
    fh = None
    try:
        with zf.open(probe, "r") as src:
            while True:
                state.check_time()
                chunk = src.read(limits.chunk_size)      # bounded output per call (see README)
                if not chunk:
                    break
                state.charge(len(chunk), raw)
                produced += len(chunk)
                if limits.max_ratio and produced >= limits.ratio_floor and \
                        produced > limits.max_ratio * max(info.compress_size, 1):
                    raise ZipLimitExceeded("compression_ratio_exceeded",
                                           _msg("compression_ratio_exceeded", limits),
                                           detail="actual", member=raw)
                if produced == len(chunk) and chunk[:4] in ZIP_MAGICS and len(chunk) >= 4:
                    # A zip inside the zip — by content, not by name. Reject before reading more
                    # if it would pass the depth limit; otherwise buffer it (budget-counted).
                    if depth + 1 > limits.max_depth:
                        raise ZipLimitExceeded("nesting_depth_exceeded",
                                               _msg("nesting_depth_exceeded", limits),
                                               detail=f"depth {depth + 1}", member=raw)
                    nested = io.BytesIO()
                if nested is not None:
                    nested.write(chunk)
                else:
                    if fh is None:
                        fh = sink.open_file(rel)
                    fh.write(chunk)
    except ZipRejected:
        if fh is not None:
            fh.close()
        raise
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError, ValueError, struct.error) as e:
        if fh is not None:
            fh.close()
        raise InvalidZipFile("corrupt", _msg("corrupt", limits), detail=type(e).__name__, member=raw) from None

    if produced != info.file_size:
        if fh is not None:
            fh.close()
        raise InvalidZipFile("header_mismatch", _msg("header_mismatch", limits),
                             detail=f"declared {info.file_size} actual {produced}", member=raw)

    if nested is not None:
        state.outputs[rel.casefold()] = "dir"     # its members live under "<name>/"
        _process_archive(nested.getvalue(), depth + 1, rel + "/", state, sink)
        return
    if fh is None:                     # empty member: still create it
        fh = sink.open_file(rel)
    sink.finish_file(rel, fh)


def _process_archive(data: bytes, depth: int, prefix: str, state: _State, sink: _Sink) -> None:
    limits = state.limits
    state.depth = max(state.depth, depth)
    state.check_time()
    if data[:4] not in ZIP_MAGICS:
        raise InvalidZipFile("not_a_zip", _msg("not_a_zip", limits), detail=f"depth {depth} magic")
    entries, cd_size = _eocd_entry_count(data)
    if entries > limits.max_members or cd_size > limits.max_members * (46 + limits.max_name_length + 256):
        raise ZipLimitExceeded("too_many_members", _msg("too_many_members", limits),
                               detail=f"{entries} entries, {cd_size} cd bytes")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError, ValueError, struct.error, NotImplementedError) as e:
        code = "not_a_zip" if depth == 1 else "corrupt"
        raise InvalidZipFile(code, _msg(code), detail=type(e).__name__) from None
    with zf:
        infos = zf.infolist()
        if len(infos) > limits.max_members:     # the EOCD count can lie; the parsed list can't
            raise ZipLimitExceeded("too_many_members", _msg("too_many_members", limits))
        # Pass 1: every header, before a single byte is decompressed.
        planned = []
        declared = 0
        for info in infos:
            state.check_time()
            rel, is_dir = _precheck_member(info, limits)
            out = prefix + rel
            state.claim(out, is_dir, info.orig_filename)
            if not is_dir:
                declared += info.file_size
            planned.append((info, out, is_dir))
        if state.total + declared > limits.max_total_bytes:      # fast pre-check (headers)
            raise ZipLimitExceeded("uncompressed_size_exceeded", _msg("uncompressed_size_exceeded", limits),
                                   detail="declared sizes")
        # Pass 2: stream every member, counting real bytes.
        for info, out, is_dir in planned:
            state.check_time()
            state.members += 1
            if is_dir:
                sink.make_dir(out)
                continue
            _read_member(zf, info, out, state, sink, depth)


# ── Logging ──────────────────────────────────────────────────────────────────────────────────


def _clean(value, limit: int = 120) -> Optional[str]:
    """Printable, single-line, truncated — safe to put in a log line."""
    if value is None:
        return None
    s = "".join(ch if ch.isprintable() else "?" for ch in str(value))
    return s if len(s) <= limit else s[:limit] + "…"


def _log_attempt(logger: logging.Logger, *, outcome: str, code: Optional[str], filename: str,
                 request_id, upload_bytes: int, sha256: str, state: Optional[_State], elapsed_ms: int,
                 member: Optional[str] = None, detail: str = "") -> None:
    record = {
        "event": "zip_upload",
        "outcome": outcome,
        "code": code,
        "request_id": _clean(request_id, 80),
        "filename": _clean(filename),
        "upload_bytes": upload_bytes,
        "sha256": sha256,
        "uncompressed_bytes": state.total if state else 0,
        "members": state.members if state else 0,
        "depth": state.depth if state else 0,
        "elapsed_ms": elapsed_ms,
    }
    if member is not None:
        record["member"] = _clean(member)
    if detail:
        record["detail"] = _clean(detail)
    logger.log(logging.INFO if outcome == "accepted" else logging.WARNING,
               json.dumps(record, ensure_ascii=True, sort_keys=True))


# ── Public API ───────────────────────────────────────────────────────────────────────────────


def extract_zip_upload(data: bytes, filename: str, *, request_id=None,
                       dest_dir: Optional[os.PathLike] = None, limits: Limits = Limits(),
                       clock: Callable[[], float] = time.monotonic,
                       logger: Optional[logging.Logger] = None) -> ExtractionResult:
    """Inspect and extract an uploaded .zip under strict limits.

    Returns an ExtractionResult (``files`` in memory, or ``written`` paths under ``dest_dir``).
    Raises ZipRejected (ZipLimitExceeded / UnsafeZipContent / InvalidZipFile) on the FIRST
    violation; nothing partially extracted is left behind. Every attempt is logged.
    """
    logger = logger or log
    started = clock()
    data = bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    state: Optional[_State] = None
    sink: Optional[_Sink] = None

    def elapsed() -> int:
        return int(round((clock() - started) * 1000))

    try:
        if len(data) > limits.max_upload_bytes:
            raise ZipLimitExceeded("upload_too_large", _msg("upload_too_large", limits))
        base = os.path.basename(str(filename or "").replace("\\", "/"))
        if not base.lower().endswith(".zip"):
            raise InvalidZipFile("bad_extension", _msg("bad_extension", limits))
        if data[:4] not in ZIP_MAGICS:
            raise InvalidZipFile("not_a_zip", _msg("not_a_zip", limits), detail="magic bytes")
        state = _State(limits, clock)
        sink = _Sink(dest_dir)
        _process_archive(data, 1, "", state, sink)
    except ZipRejected as e:
        if sink is not None:
            sink.discard()
        _log_attempt(logger, outcome="rejected", code=e.code, filename=filename, request_id=request_id,
                     upload_bytes=len(data), sha256=sha, state=state, elapsed_ms=elapsed(),
                     member=e.member, detail=e.detail)
        raise
    except BaseException:
        if sink is not None:
            sink.discard()
        _log_attempt(logger, outcome="error", code="internal_error", filename=filename,
                     request_id=request_id, upload_bytes=len(data), sha256=sha, state=state,
                     elapsed_ms=elapsed())
        raise

    result = ExtractionResult(files=sink.files, written=sink.written, total_bytes=state.total,
                              member_count=state.members, max_depth=state.depth,
                              elapsed_ms=elapsed(), sha256=sha)
    _log_attempt(logger, outcome="accepted", code=None, filename=filename, request_id=request_id,
                 upload_bytes=len(data), sha256=sha, state=state, elapsed_ms=result.elapsed_ms)
    return result


# ── Optional hard wall-clock kill (process isolation) ────────────────────────────────────────


class _ListHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records: List[tuple] = []

    def emit(self, record):
        self.records.append((record.levelno, record.getMessage()))


def _child_entry(conn, data, filename, request_id, limits, memory_limit_bytes):
    # A spawned child has no logging config: collect its attempt record and hand it to the parent,
    # which emits it on the real logger.
    handler = _ListHandler()
    child_log = logging.getLogger(LOGGER_NAME + ".child")
    child_log.propagate = False
    child_log.setLevel(logging.INFO)
    child_log.addHandler(handler)
    if memory_limit_bytes:
        try:
            import resource  # POSIX only
            resource.setrlimit(resource.RLIMIT_AS, (memory_limit_bytes, memory_limit_bytes))
        except (ImportError, ValueError, OSError):
            pass
    try:
        result = extract_zip_upload(data, filename, request_id=request_id, limits=limits, logger=child_log)
        conn.send(("ok", result, handler.records))
    except ZipRejected as e:
        conn.send(("rejected", e, handler.records))
    except MemoryError:
        conn.send(("memory", None, []))
    except BaseException as e:  # noqa: BLE001 — report, never hang the parent
        conn.send(("error", type(e).__name__, handler.records))
    finally:
        conn.close()


def run_with_hard_timeout(data: bytes, filename: str, *, request_id=None, limits: Limits = Limits(),
                          grace_seconds: float = 1.0, memory_limit_bytes: Optional[int] = 512 * MiB,
                          logger: Optional[logging.Logger] = None) -> ExtractionResult:
    """Run extract_zip_upload (in-memory mode) in a separate process and KILL it at the deadline.

    The in-process deadline is cooperative: it is checked between chunks, so one pathological
    decompress call can overrun it. A child process can be terminated no matter what it is doing,
    and an address-space rlimit caps its memory. Use this (or an isolated worker container) in
    production. The child logs its own attempt; a kill is logged here.
    """
    import multiprocessing as mp

    logger = logger or log
    ctx = mp.get_context("spawn")           # a fresh interpreter: no inherited state or locks
    parent_conn, child_conn = ctx.Pipe(duplex=False)
    started = time.monotonic()
    proc = ctx.Process(target=_child_entry,
                       args=(child_conn, bytes(data), filename, request_id, limits, memory_limit_bytes),
                       daemon=True)
    proc.start()
    child_conn.close()
    try:
        budget = limits.max_seconds + grace_seconds
        records: List[tuple] = []
        if parent_conn.poll(budget):
            try:
                status, payload, records = parent_conn.recv()
            except EOFError:                       # killed by the rlimit / OOM killer
                status, payload = "memory", None
        else:
            status, payload = "timeout", None
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(1.0)
        parent_conn.close()

    for level, message in records:
        logger.log(level, message)
    if status == "ok":
        return payload
    if status == "rejected":
        raise payload
    if status == "timeout":
        err = ZipLimitExceeded("time_exceeded", _msg("time_exceeded", limits), detail="hard kill")
    elif status == "memory":
        err = ZipLimitExceeded("memory_exceeded", "This archive needs too much memory to unpack safely.",
                               detail="child memory limit")
    else:
        err = InvalidZipFile("corrupt", _msg("corrupt"), detail=str(payload))
    _log_attempt(logger, outcome="rejected", code=err.code, filename=filename, request_id=request_id,
                 upload_bytes=len(data), sha256=hashlib.sha256(bytes(data)).hexdigest(), state=None,
                 elapsed_ms=int((time.monotonic() - started) * 1000), detail=err.detail)
    raise err
