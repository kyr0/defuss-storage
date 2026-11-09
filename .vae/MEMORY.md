# Agent memory

<!-- One tagged line per durable fact NOT derivable from code, git or docs:
- VERIFIED[scope] fact BC evidence
- HYPOTHESIS[scope] claim BC observation; falsifier=`cmd`
- UNKNOWN[scope] gap BC missing evidence
[scope] = the narrowest path|module|command|condition the evidence covers, not a topic: the entry decides nothing
outside it, and recurrence inside one subsystem never widens it.
Every line carries its BC and stays within 240 chars. Replace stale lines instead of appending.
Mechanizable lessons belong in tests or .vae/VERIFY.py.
Budget 4 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[toolchain] bun 1.4.3 is the package manager (bun.lock); Node.js stays the runtime under test BC human chose migrating from npm 2026-11-08
- VERIFIED[git commits] no Claude Co-Authored-By or attribution lines BC human instruction 2026-11-08
- VERIFIED[bench noise] check `uptime` before `make bench` or timing probes; other local agent sessions can load the machine (load 6-16 seen 2026-11-08) and widen ranges
- VERIFIED[timing comparisons] compare builds or variants only interleaved within one process run; a cross-run comparison (12.6 vs 8.9 µs) suggested 3.7 µs of library overhead that interleaved probes put at about 0.1 µs (2026-11-08)
- VERIFIED[gate runs] run the gate in the foreground (about 2.5 min); a background gate plus the stop hook's gate rebuild dist/ at once and fail with ENOENT dist/opfs.mjs or ERR_MODULE_NOT_FOUND (2026-11-09)
