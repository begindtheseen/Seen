"""Tests for zip_guard. Standard library only; every fixture is built in memory.

Run from the repo root:  python3 -m unittest security/zip_guard/test_zip_guard.py -v
"""

import io
import json
import logging
import os
import stat
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zip_guard  # noqa: E402
from zip_guard import (  # noqa: E402
    InvalidZipFile, Limits, MiB, UnsafeZipContent, ZipLimitExceeded, ZipRejected,
    extract_zip_upload, run_with_hard_timeout,
)

QUIET = logging.getLogger("zip_guard.test")
QUIET.addHandler(logging.NullHandler())
QUIET.propagate = False


def make_zip(entries, method=zipfile.ZIP_DEFLATED):
    """entries: list of (name, bytes) or (ZipInfo, bytes)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", method) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def nest(levels, payload=b"hello from the bottom\n"):
    """A chain of `levels` archives: level 1 contains level2.zip … the last holds a text file."""
    data = make_zip([("bottom.txt", payload)])
    for level in range(levels - 1, 0, -1):
        data = make_zip([(f"level{level + 1}.zip", data)])
    return data


def patch_sizes(data, name, new_size):
    """Rewrite the uncompressed size of `name` in BOTH the local header and the central directory
    (a lying header). The CRC is left as the CRC of the real data."""
    b = bytearray(data)
    nb = name.encode()
    i = 0
    while True:
        i = b.find(b"PK\x03\x04", i)
        if i < 0:
            break
        nlen = struct.unpack_from("<H", b, i + 26)[0]
        if bytes(b[i + 30:i + 30 + nlen]) == nb:
            struct.pack_into("<I", b, i + 22, new_size)
        i += 4
    i = 0
    while True:
        i = b.find(b"PK\x01\x02", i)
        if i < 0:
            break
        nlen = struct.unpack_from("<H", b, i + 28)[0]
        if bytes(b[i + 46:i + 46 + nlen]) == nb:
            struct.pack_into("<I", b, i + 24, new_size)
        i += 4
    return bytes(b)


class FakeClock:
    """Advances `step` seconds every time it is read."""

    def __init__(self, step):
        self.t = 1000.0
        self.step = step
        self.calls = 0

    def __call__(self):
        self.calls += 1
        self.t += self.step
        return self.t


def extract(data, name="upload.zip", **kw):
    kw.setdefault("logger", QUIET)
    return extract_zip_upload(data, name, request_id="req-test", **kw)


class AcceptTests(unittest.TestCase):
    def test_normal_zip_in_memory(self):
        data = make_zip([("a.txt", b"alpha"), ("dir/b.txt", b"beta" * 100), ("dir/", b"")])
        r = extract(data)
        self.assertEqual(r.files, {"a.txt": b"alpha", "dir/b.txt": b"beta" * 100})
        self.assertEqual(r.total_bytes, 5 + 400)
        self.assertEqual(r.max_depth, 1)
        self.assertEqual(len(r.sha256), 64)

    def test_normal_zip_to_directory(self):
        data = make_zip([("a.txt", b"alpha"), ("sub/deeper/b.txt", b"beta")])
        with tempfile.TemporaryDirectory() as d:
            r = extract(data, dest_dir=d)
            self.assertEqual(r.files, {})
            with open(os.path.join(d, "sub/deeper/b.txt"), "rb") as fh:
                self.assertEqual(fh.read(), b"beta")
            mode = stat.S_IMODE(os.stat(os.path.join(d, "a.txt")).st_mode)
            self.assertEqual(mode & 0o111, 0, "extracted files are never executable")

    def test_stored_members_and_empty_archive(self):
        self.assertEqual(extract(make_zip([("s.txt", b"x" * 10)], zipfile.ZIP_STORED)).files, {"s.txt": b"x" * 10})
        self.assertEqual(extract(make_zip([])).files, {})


class SizeTests(unittest.TestCase):
    def test_honest_header_rejected_by_precheck(self):
        data = make_zip([("zeros.bin", b"\0" * (11 * MiB))])
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(data)
        self.assertIn(cm.exception.code, ("uncompressed_size_exceeded", "compression_ratio_exceeded"))

    def test_lying_header_rejected_by_actual_byte_count(self):
        # 11 MiB of zeros compresses to ~11 KB. The header claims 1,000 bytes, so the pre-check
        # passes; only counting real decompressed bytes catches it. The ratio guard is switched
        # off here to prove the size counter on its own.
        data = patch_sizes(make_zip([("zeros.bin", b"\0" * (11 * MiB))]), "zeros.bin", 1000)
        self.assertLess(len(data), 64 * 1024)
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(data, limits=Limits(max_ratio=None))
        self.assertEqual(cm.exception.code, "uncompressed_size_exceeded")
        self.assertIn("10 MB", cm.exception.user_message)
        # With the default limits the ratio guard stops it even earlier.
        with self.assertRaises(ZipLimitExceeded):
            extract(data)

    def test_small_lie_is_a_header_mismatch(self):
        data = patch_sizes(make_zip([("a.txt", b"a" * 5000)]), "a.txt", 1000)
        with self.assertRaises(InvalidZipFile) as cm:
            extract(data)
        self.assertEqual(cm.exception.code, "header_mismatch")

    def test_ratio_guard(self):
        data = make_zip([("z.bin", b"\0" * (2 * MiB))])     # within 10 MiB, ratio ~1000:1
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(data)
        self.assertEqual(cm.exception.code, "compression_ratio_exceeded")

    def test_upload_itself_capped(self):
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(make_zip([("a.txt", b"a")]), limits=Limits(max_upload_bytes=10))
        self.assertEqual(cm.exception.code, "upload_too_large")


class NestingTests(unittest.TestCase):
    def test_five_levels_accepted(self):
        r = extract(nest(5))
        self.assertEqual(r.max_depth, 5)
        self.assertEqual(list(r.files), ["level2.zip/level3.zip/level4.zip/level5.zip/bottom.txt"])

    def test_six_levels_rejected(self):
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(nest(6))
        self.assertEqual(cm.exception.code, "nesting_depth_exceeded")

    def test_nested_detected_by_magic_not_extension(self):
        inner = make_zip([("x.txt", b"x")])
        r = extract(make_zip([("innocent.txt", inner)]))
        self.assertEqual(r.files, {"innocent.txt/x.txt": b"x"})
        self.assertEqual(r.max_depth, 2)

    def test_budget_is_shared_across_levels(self):
        payload = os.urandom(400 * 1024)                     # incompressible: no ratio guard
        inner = make_zip([("p.bin", payload)], zipfile.ZIP_STORED)
        limits = Limits(max_total_bytes=1 * MiB)
        # One inner archive: ~400 KB (the inner zip) + 400 KB (its member) = ~800 KB — fits.
        self.assertEqual(extract(make_zip([("one.zip", inner)]), limits=limits).max_depth, 2)
        # Two: each archive alone is under 1 MiB, but the upload's shared budget is not.
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(make_zip([("one.zip", inner), ("two.zip", inner)]), limits=limits)
        self.assertEqual(cm.exception.code, "uncompressed_size_exceeded")


class TimeTests(unittest.TestCase):
    def test_deadline_between_members(self):
        data = make_zip([(f"f{i}.txt", b"x") for i in range(50)])
        clock = FakeClock(step=0.5)
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(data, clock=clock)
        self.assertEqual(cm.exception.code, "time_exceeded")
        self.assertLess(clock.calls, 40, "stops at the first check past the deadline")

    def test_deadline_between_chunks(self):
        data = make_zip([("big.bin", os.urandom(512 * 1024))])
        with self.assertRaises(ZipLimitExceeded) as cm:
            extract(data, clock=FakeClock(step=0.4), limits=Limits(chunk_size=4096))
        self.assertEqual(cm.exception.code, "time_exceeded")

    def test_fast_clock_accepts(self):
        self.assertEqual(extract(make_zip([("a.txt", b"a")]), clock=FakeClock(step=0.001)).member_count, 1)


class FormatTests(unittest.TestCase):
    def test_non_zip_renamed(self):
        with self.assertRaises(InvalidZipFile) as cm:
            extract(b"%PDF-1.7 definitely not a zip" * 10, "resume.zip")
        self.assertEqual(cm.exception.code, "not_a_zip")

    def test_wrong_extension(self):
        with self.assertRaises(InvalidZipFile) as cm:
            extract(make_zip([("a.txt", b"a")]), "archive.tar")
        self.assertEqual(cm.exception.code, "bad_extension")

    def test_magic_but_garbage(self):
        with self.assertRaises(InvalidZipFile) as cm:
            extract(b"PK\x03\x04" + os.urandom(200), "x.zip")
        self.assertEqual(cm.exception.code, "not_a_zip")

    def test_polyglot_with_leading_bytes(self):
        with self.assertRaises(InvalidZipFile):
            extract(b"GIF89a" + make_zip([("a.txt", b"a")]))


class UnsafeContentTests(unittest.TestCase):
    def assertCode(self, data, code, exc=ZipRejected):
        with self.assertRaises(exc) as cm:
            extract(data)
        self.assertEqual(cm.exception.code, code)

    def test_path_traversal(self):
        self.assertCode(make_zip([("../evil.txt", b"x")]), "path_traversal", UnsafeZipContent)
        self.assertCode(make_zip([("ok/../../evil.txt", b"x")]), "path_traversal", UnsafeZipContent)
        self.assertCode(make_zip([("..\\evil.txt", b"x")]), "path_traversal", UnsafeZipContent)

    def test_absolute_path(self):
        self.assertCode(make_zip([("/etc/passwd", b"x")]), "absolute_path", UnsafeZipContent)
        self.assertCode(make_zip([("C:\\Windows\\x.dll", b"x")]), "absolute_path", UnsafeZipContent)

    def test_symlink(self):
        info = zipfile.ZipInfo("link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.assertCode(make_zip([(info, b"/etc/passwd")]), "symlink", UnsafeZipContent)

    def test_special_file(self):
        info = zipfile.ZipInfo("fifo")
        info.create_system = 3
        info.external_attr = (stat.S_IFIFO | 0o644) << 16
        self.assertCode(make_zip([(info, b"")]), "special_file", UnsafeZipContent)

    def test_encrypted(self):
        # zipfile won't write the flag itself; set "encrypted" (bit 0) in both headers.
        b = bytearray(make_zip([("secret.txt", b"x")]))
        for sig, off in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
            i = b.find(sig)
            struct.pack_into("<H", b, i + off, struct.unpack_from("<H", b, i + off)[0] | 0x1)
        self.assertCode(bytes(b), "encrypted", UnsafeZipContent)

    def test_unsupported_compression(self):
        self.assertCode(make_zip([("a.txt", b"a" * 100)], zipfile.ZIP_BZIP2), "unsupported_compression")

    def test_duplicates(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.assertCode(make_zip([("a.txt", b"1"), ("a.txt", b"2")]), "duplicate_name")
        self.assertCode(make_zip([("A.txt", b"1"), ("a.txt", b"2")]), "duplicate_name")
        self.assertCode(make_zip([("a", b"1"), ("a/b.txt", b"2")]), "duplicate_name")

    def test_control_characters_in_name(self):
        self.assertCode(make_zip([("evil\n.txt", b"x")]), "unsafe_path", UnsafeZipContent)

    def test_too_many_members(self):
        data = make_zip([(f"e{i}", b"") for i in range(1001)], zipfile.ZIP_STORED)
        self.assertCode(data, "too_many_members", ZipLimitExceeded)
        self.assertEqual(extract(make_zip([(f"e{i}", b"") for i in range(1000)], zipfile.ZIP_STORED)).member_count, 1000)

    def test_rejection_leaves_nothing_on_disk(self):
        # The first member is fine and gets written; the second breaks the size budget.
        data = make_zip([("ok.txt", b"fine"), ("big.bin", os.urandom(300 * 1024))], zipfile.ZIP_STORED)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ZipLimitExceeded):
                extract(data, dest_dir=d, limits=Limits(max_total_bytes=200 * 1024))
            self.assertEqual(os.listdir(d), [])


class LoggingTests(unittest.TestCase):
    def test_every_attempt_logged_without_contents(self):
        logger = logging.getLogger("zip_guard.logtest")
        with self.assertLogs(logger, level="INFO") as logs:
            extract_zip_upload(make_zip([("a.txt", b"SECRET-CONTENT")]), "ok.zip", request_id="r1", logger=logger)
            with self.assertRaises(UnsafeZipContent):
                extract_zip_upload(make_zip([("../\x1b[31mevil\u2028.txt", b"SECRET-CONTENT")]), "bad\n.zip",
                                   request_id="r2\nforged", logger=logger)
        accepted, rejected = (json.loads(r.getMessage()) for r in logs.records)
        self.assertEqual(accepted["outcome"], "accepted")
        self.assertEqual(accepted["request_id"], "r1")
        self.assertEqual(len(accepted["sha256"]), 64)
        for key in ("upload_bytes", "uncompressed_bytes", "members", "depth", "elapsed_ms"):
            self.assertIn(key, accepted)
        self.assertEqual(rejected["outcome"], "rejected")
        self.assertIn(rejected["code"], ("path_traversal", "unsafe_path"))
        self.assertEqual(rejected["filename"], "bad?.zip")
        self.assertEqual(rejected["request_id"], "r2?forged")
        self.assertNotIn("\x1b", rejected["member"])
        self.assertNotIn("\u2028", rejected["member"])
        for r in logs.records:
            self.assertNotIn("SECRET-CONTENT", r.getMessage())
            self.assertNotIn("\n", r.getMessage())


class HardTimeoutTests(unittest.TestCase):
    def test_child_returns_result(self):
        r = run_with_hard_timeout(make_zip([("a.txt", b"alpha")]), "a.zip", logger=QUIET)
        self.assertEqual(r.files, {"a.txt": b"alpha"})

    def test_child_rejection_crosses_the_process_boundary(self):
        with self.assertRaises(UnsafeZipContent) as cm:
            run_with_hard_timeout(make_zip([("../x", b"x")]), "a.zip", logger=QUIET)
        self.assertEqual(cm.exception.code, "path_traversal")

    def test_child_is_killed_at_the_deadline(self):
        # A budget far shorter than a process start-up: the parent must kill the child.
        limits = Limits(max_seconds=0.0)
        with self.assertRaises(ZipLimitExceeded) as cm:
            run_with_hard_timeout(nest(3), "a.zip", limits=limits, grace_seconds=0.0, logger=QUIET)
        self.assertEqual(cm.exception.code, "time_exceeded")


if __name__ == "__main__":
    unittest.main()
