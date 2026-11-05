# zip_guard: safe .zip upload handling (Python standard library)

`zip_guard.py` inspects and extracts an uploaded `.zip` under hard limits and refuses
decompression ("zip") bombs. It uses only the standard library: `zipfile`, `zlib`, `io`, `struct`,
`hashlib`, `logging`, `json`, `multiprocessing` and `resource`.

```python
from zip_guard import extract_zip_upload, run_with_hard_timeout, ZipRejected

try:
    result = extract_zip_upload(data, filename, request_id=req_id)             # in memory
    # result = extract_zip_upload(data, filename, dest_dir=fresh_empty_dir)    # to disk
    # result = run_with_hard_timeout(data, filename, request_id=req_id)        # isolated + hard kill
except ZipRejected as e:
    respond(e.http_status, {"error": e.user_message, "code": e.code})
```

`result.files` maps each name to its bytes in memory mode; `result.written` lists the paths written
in directory mode. The result also carries `total_bytes`, `member_count`, `max_depth`,
`elapsed_ms` and `sha256`.

| Limit (`Limits`) | Default | Code when exceeded |
|---|---|---|
| `max_total_bytes`: actual decompressed bytes, all levels | 10 MiB | `uncompressed_size_exceeded` |
| `max_depth`: archives inside archives (outer = 1) | 5 | `nesting_depth_exceeded` |
| `max_seconds`: one deadline per upload | 5 s | `time_exceeded` |
| `max_members`: entries per archive | 1,000 | `too_many_members` |
| `max_ratio`: per-member output ÷ compressed size, past `ratio_floor` (256 KiB) | 100 | `compression_ratio_exceeded` |
| `max_upload_bytes`: the compressed upload itself | 10 MiB | `upload_too_large` |

Run the tests from the repo root with `python3 -m unittest security/zip_guard/test_zip_guard.py -v`.

---

## How each protection works

### 1. At most 10 MB of uncompressed data, counted for real

A zip header states each member's size, and an attacker writes the header, so the guard never
trusts it.

- **Pre-check (fast, headers only).** Before decompressing anything, the declared sizes are summed
  and the declared ratio is checked. An honest bomb is refused here without inflating a byte.
- **The actual count (authoritative).** Every member is read with `zf.open(...).read(64 KiB)` in a
  loop, and each chunk's real length is added to one running total. The total is checked after
  every chunk, so extraction stops within one chunk of the cap.
- **Why the header can't hide anything.** CPython's `ZipExtFile` cuts the output at the header's
  `file_size` and then fails the CRC. A lying header would just look "corrupt" and the real size
  would stay hidden. The guard opens each member with that claim raised to the remaining budget
  plus one chunk. The real stream reaches the counter, and the first chunk past the budget triggers
  the rejection.
- **A lie inside the budget.** After a member is read, its actual size must equal the declared
  size, or the upload is rejected as `header_mismatch`.
- **Defence in depth.** A per-member ratio guard (more than 100:1 once a member passes 256 KiB)
  catches a bomb shape even inside the budget. A member-count cap (1,000) is read from the
  end-of-central-directory record before `zipfile` builds one `ZipInfo` per entry, so an archive
  of a million empty files is refused in microseconds. Overlapping-entry bombs (many directory
  entries pointing at one compressed blob) are bounded by the same real-byte budget.

### 2. Nesting depth of at most 5

A member is treated as an archive when its first bytes are `PK\x03\x04` or `PK\x05\x06`.
Detection uses the content, never the extension, so `photo.jpg` that is really a zip is still
caught. The outer upload is depth 1. When an inner archive would be depth 6, it is rejected on its
first chunk, before the rest is read. Inner archives are buffered in memory, never written to disk,
and each byte counts against the budget.

The budget and the deadline are **shared** across every level. Without that, a 5-level tree of
archives that each unpack to 9.9 MB would multiply the work. With one budget per upload, the whole
tree gets 10 MB and 5 s in total.

### 3. At most 5 seconds of processing

One monotonic deadline (`time.monotonic`, which is immune to clock changes) is set when the upload
arrives. It is checked before parsing, before and between members, and between chunks.

**Why checking between chunks bounds the time.** Each `read(64 KiB)` call does a bounded amount of
work. For deflate, `ZipExtFile` reads at most one chunk of compressed input and asks zlib for at
most one chunk of output (`decompressobj().decompress(data, max_length)`). No single step can run
long, so the gap between two deadline checks is short and the overrun is bounded. This is also why
only **stored** and **deflate** are accepted. Many CPython releases call the bzip2 and lzma
decompressors *without* an output bound (recent patch releases add one), so on those versions one
read could expand without limit. Deflate is bounded everywhere, and it is what real zips use.

**The limitation.** A check between steps is cooperative. The deadline cannot interrupt a single
zlib call from the inside, and pure Python cannot pre-empt C code. Small chunks keep that window
tiny, but they don't make it zero.

**The fix in production is process isolation with a hard kill.** `run_with_hard_timeout()` runs the
same extraction in a fresh `spawn`ed process. It caps that process's address space
(`RLIMIT_AS`, 512 MiB by default) and waits `max_seconds + grace`. If no answer arrives, it
**kills** the process, which works whatever the process is doing, and raises `time_exceeded`. A
child killed by its memory limit becomes `memory_exceeded`. In a SaaS backend, the same idea
belongs one level up: a scanning worker container with CPU/memory cgroup limits and a wall-clock
kill (see below).

### 4. Stop immediately and reject with a clear message

The first violation raises, and nothing after it runs. Every error carries:

- `code`: stable and machine-readable, for metrics, alerts and tests.
- `user_message`: plain language, safe to show the uploader. For example: "This archive unpacks to
  more than 10 MB. Upload a smaller archive."
- `http_status`: 413 for limits, 415 for not-a-zip, 422 for unsafe content.

The classes are `ZipRejected` (the base), `ZipLimitExceeded`, `UnsafeZipContent` and
`InvalidZipFile`. In directory mode, every file and directory already written for that upload is
removed before the exception leaves the function. A rejected upload never leaves half an
extraction behind.

### 5. .zip files only, and only safe entries

An upload must pass **all three** of these checks:

1. A `.zip` extension.
2. The zip magic bytes at offset 0. This rejects renamed files and polyglots with leading data.
3. A central directory that `zipfile` can parse.

Each entry is then checked before any decompression. The guard rejects:

- Encrypted entries (general-purpose flag bit 0 or 6).
- Compression methods other than stored or deflate.
- Absolute paths (`/etc/passwd`, `C:\…`).
- `..` traversal, including backslash forms.
- Control characters in names, and over-long names.
- Symlinks, devices and FIFOs, detected from the Unix mode bits in `external_attr`.
- Duplicate names, compared case-insensitively (they collide on macOS and Windows), and a file that
  is also a directory (`a` and `a/b.txt`).

Names are validated from `orig_filename`, before `zipfile`'s own clean-up cuts a name at a NUL.

**Writing to disk** never uses `extractall`. Each target is `dest / name`, resolved with symlinks
followed and required to stay inside the resolved destination. Files are created with
`O_CREAT|O_EXCL|O_NOFOLLOW` and mode `0600`. The archive's own permission bits are never applied,
so nothing is ever executable.

### 6. Logging every attempt for monitoring

Each attempt emits exactly one JSON line on the `zip_guard` logger: INFO when accepted, WARNING
when rejected. Fields:

```json
{"event":"zip_upload","outcome":"rejected","code":"nesting_depth_exceeded","request_id":"r-81f2",
 "filename":"invoices.zip","member":"level6.zip","upload_bytes":1840,
 "sha256":"9f2c…","uncompressed_bytes":1532,"members":5,"depth":5,"elapsed_ms":3}
```

File contents are **never** logged. Names and request ids pass through a sanitizer: unprintable
characters (newlines, ANSI escapes, U+2028) become `?`, and values are truncated to 120 characters.
That prevents log forging and log-viewer injection. The sha256 lets you match a rejected file
across users, block it, or hand it to a malware sandbox without storing it in logs.

---

## Using it in a web handler

A 10 MB *uncompressed* cap means nothing if the *upload itself* is unbounded: an attacker just
sends 5 GB. Cap the request **before reading it**: at the edge (nginx `client_max_body_size`, the
load balancer or CDN), in the framework (Flask `MAX_CONTENT_LENGTH`, Django
`DATA_UPLOAD_MAX_MEMORY_SIZE`), and in your own code:

```python
import json
from zip_guard import run_with_hard_timeout, ZipRejected, MiB

MAX_UPLOAD = 10 * MiB

def reply(start_response, status, payload):
    body = json.dumps(payload).encode()
    start_response(f"{status} ", [("Content-Type", "application/json"),
                                  ("Content-Length", str(len(body)))])
    return [body]

def upload_app(environ, start_response):                     # plain WSGI, no framework
    if environ.get("REQUEST_METHOD") != "POST":
        return reply(start_response, 405, {"error": "POST a .zip file."})
    try:
        length = int(environ.get("CONTENT_LENGTH") or "")
    except ValueError:                                       # chunked / missing length: refuse
        return reply(start_response, 411, {"error": "Content-Length is required."})
    if not 0 < length <= MAX_UPLOAD:
        return reply(start_response, 413, {"error": "Uploads must be under 10 MB."})
    data = environ["wsgi.input"].read(length)                # never more than the capped length
    filename = environ.get("HTTP_X_FILE_NAME", "upload.zip")
    try:
        result = run_with_hard_timeout(data, filename, request_id=environ.get("HTTP_X_REQUEST_ID"))
    except ZipRejected as e:
        return reply(start_response, e.http_status, {"error": e.user_message, "code": e.code})
    return reply(start_response, 200, {"files": sorted(result.files), "bytes": result.total_bytes})
```

With multipart forms, use your framework's upload parser *with its size limits set*, and pass the
file's bytes plus its client-supplied name. The name is only a hint, which is why the magic bytes
and central directory are checked too.

---

## Safe practices for scanning files in a SaaS environment

**Bound everything before you touch the bytes.**

- **Size caps at the edge.** Cap at the CDN/load balancer, the reverse proxy, the framework and the
  handler, in that order. Rate-limit uploads **per user and per IP** (and per tenant) so one account
  can't keep scanning workers busy, and refuse requests without a length you can trust.
- **Sniff the content; never trust headers.** The browser's `Content-Type` and the filename are
  attacker-chosen. Decide the type from magic bytes and a real parse, and keep an allow-list of
  formats you actually need.

**Isolate the parser.**

- **Separate scanning workers.** Parsing and decompression run in a separate process, ideally a
  separate container or microVM, never in the web process. Give the worker:
  - **no network** (no egress, no metadata endpoint), so a parser exploit can't call out;
  - a **read-only root filesystem** with a small tmpfs scratch area;
  - a non-root user, a **seccomp** profile, and dropped capabilities;
  - **CPU and memory cgroup limits** plus a **hard wall-clock kill** (as in
    `run_with_hard_timeout`). Assume a bomb or a parser bug *will* hit the limits, and make
    hitting them cheap.
- **Queue, don't inline.** Put uploads on a queue and let scanners pull them. A flood then becomes
  a backlog, not an outage, and the web tier stays responsive.

**Scan for malware, and keep the signatures fresh.**

- Run **ClamAV** (`clamd`, talked to over a local socket from the isolated worker) and/or **YARA**
  rules on every file *and* on every member extracted from an archive.
- Update signatures automatically (`freshclam`) and alert when they go stale. A scanner with
  month-old signatures is decoration.
- Cap the scanner's own archive limits too (ClamAV's `MaxScanSize`, `MaxFileSize`, `MaxRecursion`,
  `MaxFiles`), and treat "scan limit exceeded" or "scan error" as **rejected**, not "clean".

**Store safely.**

- **Quarantine bucket.** New uploads land in a private bucket, prefix or container reserved for
  unscanned files. Use **random object names** (a UUID, never the user's filename, which still goes
  in your database as data), and allow no public access. Promote a file only after it passes.
- **No execute, anywhere.** Mount upload storage `noexec`, never set executable bits, and never
  pass an uploaded path to a shell or interpreter.
- **Never serve uploads from the app origin.** Serve them from a separate cookieless domain (e.g.
  `usercontent.example`) or through short-lived signed URLs. Send
  `Content-Disposition: attachment`, an explicit safe `Content-Type`,
  `X-Content-Type-Options: nosniff`, and a restrictive `Content-Security-Policy` (`sandbox`).
  An uploaded HTML or SVG file must never run script with your site's cookies.

**Sanitize and expire.**

- **Re-encode or rebuild documents (CDR, content disarm and reconstruction).** When you only need
  the content, extract it and keep the extraction, or regenerate a clean file. Examples: render a
  PDF to text or images, re-encode images, rebuild Office files without macros, embedded objects or
  external links. Discard the original when policy allows.
- **Retention limits.** Keep originals only as long as you need them, delete them on a schedule,
  delete them when the user deletes their account, and make sure backups follow the same policy.
  Fewer stored files means less to leak.

**Watch it.**

- **Audit logging and alerting.** Log one structured record per upload (who, when, size, type,
  sha256, decision, reason code, scanner verdict), and never the contents. Alert on spikes of a
  rejection code, repeated rejections from one account or IP, the same sha256 arriving from many
  accounts, and scanner errors or timeouts. These are what an attack looks like from the inside.

**Remember that many formats are zips.**

- **DOCX, XLSX, PPTX, ODT, EPUB, JAR and APK are zip archives.** They need the same guard: size and
  ratio budget, entry cap, deadline, encryption and odd-entry checks. Read only the parts you need.
  An `.xlsx` embedded in a `.docx` (`word/embeddings/`) is another zip, so leave it unopened
  unless you really need it. Then apply the nesting limit and keep the budget shared.
- PDF works the same way: its streams are zlib-compressed, so a 50 KB PDF can inflate to
  gigabytes. Inflate under a byte budget, cap pages, and run the parser in an isolated worker with
  a hard time limit.

Seen applies these protections to its résumé uploads in JavaScript: `lib/server/archiveGuard.js`
for DOCX (zip) and PDF stream inflation, and `lib/resume/extract/pdf.js` for the PDF time budget
and worker isolation.
