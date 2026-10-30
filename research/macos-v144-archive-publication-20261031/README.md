# macOS v144 archive publication

`scripts/pump_macos_v144_qualification.py` downloaded each pinned toolchain
archive directly onto `OUT/<label>.tar.bz2` and hashed it afterwards. At base
`5889e795eba64e85e613b4409921323bfecec414` that path may already exist, be a
symlink, or be replaced between runs, so an unverified download could truncate a
retained archive or write through a link to a file outside the work tree before
the digest assertion rejected the bytes.

Reproduced on the base script by importing the module, pointing `OUT`,
`EVIDENCE`, `SPEC` and `ROOT` at a private directory, symlinking
`OUT/fixture.tar.bz2` to an external file, and mocking `urlopen` to return
`b"synthetic download"`:

| | raises | external target after the run | target replaced |
|---|---|---|---|
| base | `AssertionError: fixture` | `synthetic download` | yes |
| proposed | `FileExistsError: refusing to replace retained archive: ...` | `external retained bytes\n` | no |

The target was overwritten with the download bytes before the digest check ran,
so the failure came too late to preserve it.

The fix is the `download_archive` helper already merged for the frontier
qualification driver (`scripts/pump_macos_frontier_qualification.py:18-30`,
tested by `scripts/test_pump_macos_frontier_archive_publication.py`): refuse an
existing archive or `.partial` path, write the download with mode `'xb'` into an
owned partial file, verify the digest, and publish with `os.link` only on
success. The v144 driver now uses that helper for every archive in
`research/pump-macos-v144-qualification-20261027/inputs.json`. I copied the
helper rather than extracting it to a shared module because the two drivers are
standalone scripts with no import relationship, and the sibling's behaviour is
the one already reviewed.

`tests/test_pump_macos_v144_archive_publication.py` covers a verified download,
a digest failure that removes only the owned partial, a partial created after
the preflight check, and the symlinked-archive case that drives `main()`. On the
base script it reports three errors (no `download_archive`) and the symlink
failure above; on the proposed script all four pass. The suite is discovered by
`python -B -m unittest discover -s tests -v`.

Required checks on the proposed tree: `python3 -E -X utf8 scripts/test_tooling.py`
(217 pass) and `python3 -E -X utf8 scripts/verify_evidence.py` (nine captures
verified). macOS arm64, Python 3.14.3. No toolchain archive, extracted input,
qualification packet or captured binary is modified, and no build,
reconstruction or program-equivalence claim is made.
