# Component boundaries

FakeHTTP and FakeSIP retain their GPL-3.0-or-later notices. Their original
source hashes remain in `sources.lock.json`; reviewed local telemetry changes
are separately pinned in `source-overrides.lock.json`.

The optional eBPF executable is an independently compiled GPL-2.0-only fork of
[fake-flow](https://github.com/lilu0826/fakeflow), tag `0.1.0`, commit
`5b8ce2f8d89036d4f8652c05038d74b5b1868741`. Its complete license is preserved
at `components/fakeflow/LICENSE`. No GPL-2.0-only object is linked into either
GPL-3.0 engine. Configuration/control uses a process boundary.

Our lifecycle changes use TCX links for both directions and private builders,
retain an abnormal-exit recovery checkpoint, and add string-valued metrics.
Private builders now use nonpersistent, exclusively created TUN/TAP file
descriptors; closing a descriptor removes its own device without name-based
deletion. Control I/O uses absolute deadlines, independent of external timeout.
These changes do not inherit upstream or previous stock-binary test results.
The original `stats` protocol remains available; the manager uses `metrics`.
There is one service and one LuCI page, not a second fake-flow init service.
New WAN TCX ownership is recorded before enabling the startup lease; checkpoint
errors propagate to controlled cleanup and unchanged refreshes do not rewrite it.
The backend includes downstream multi-template rotation, conventional initial-TTL32
estimation and explicit diagnostic read/overflow errors. These are downstream
changes, not a claim of an upstream kernel defect.
