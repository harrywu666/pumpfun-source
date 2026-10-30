# Packet verifier invocation census

| Measure | Packets |
| --- | --- |
| Research packets | 204 |
| With `verify.py` | 161 |
| Without `verify.py` | 43 |
| Requiring a command-line argument | 48 |
| Requiring `--images` | 46 |
| Requiring `--repo-root` | 2 |

Image resolution covers the roles each packet records. `none` means no role resolved to bytes present in the repository; `partial` means at least one role did and at least one did not.

| Image packets | Packets |
| --- | --- |
| no-recorded-hashes | 9 |
| partial | 37 |

| Role | Recorded | Resolved | Unresolved | Not recorded |
| --- | --- | --- | --- | --- |
| candidate | 37 | 0 | 37 | 9 |
| original | 37 | 37 | 0 | 9 |
| pump | 2 | 2 | 0 | 44 |
| pump_amm | 2 | 2 | 0 | 44 |
