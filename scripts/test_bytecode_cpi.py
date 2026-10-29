#!/usr/bin/env python3
"""CPI/memcpy detection must see relocation-form external calls.

The captured builds encode external syscalls as `0x85 0x10` plus a type-10
(`R_BPF_64_32`) relocation naming the symbol, not as the legacy `0x85 0x00`
syscall form with a 32-bit hash. Detection used to count only the legacy form
and therefore reported 0 CPI and 0 memcpy sites.
"""
import struct
import unittest
from pathlib import Path
from types import SimpleNamespace

import bytecode_signatures
from window_elf_reader import Elf

ROOT = Path(__file__).resolve().parents[1]
PROGRAMS = ("pump", "pump_amm", "mayhem")

# (CPI callsites, sol_memcpy_ callsites) expected in each captured deployment.
EXPECTED = {
    "pump": (1, 2),
    "pump_amm": (1, 2),
    "mayhem": (1, 2),
}


def load(program):
    return Elf(ROOT / "evidence" / "original" / program / "deployed.so")


def module_totals(elf):
    """Reproduce bytecode_signatures.main()'s windowing over this ELF."""
    bounds = elf.entries + [elf.hi]
    cpi = 0
    memcpy = 0
    for idx, start in enumerate(elf.entries):
        end = bounds[idx + 1]
        cpi += len(bytecode_signatures.detect_cpi_patterns(elf, start, end))
        memcpy += bytecode_signatures.detect_serialization_patterns(
            elf, start, end)["memcpy_calls"]
    return cpi, memcpy


def relocation_counts(elf):
    counts = {"sol_invoke_signed_rust": 0, "sol_invoke_signed_c": 0,
              "sol_memcpy_": 0}
    for at, reloc in elf.relocations.items():
        if reloc["type"] != 10 or reloc["symbol"] not in counts:
            continue
        # Type-10 relocations also patch lddw loads; only `call` is a syscall.
        assert elf.b[at] == 0x85, hex(at)
        counts[reloc["symbol"]] += 1
    return counts


class RealDeploymentTests(unittest.TestCase):
    def test_relocations_are_relocation_form(self):
        for program in PROGRAMS:
            with self.subTest(program=program):
                counts = relocation_counts(load(program))
                cpi = counts["sol_invoke_signed_rust"] + counts[
                    "sol_invoke_signed_c"]
                self.assertEqual((cpi, counts["sol_memcpy_"]),
                                 EXPECTED[program])

    def test_detection_matches_relocations(self):
        for program in PROGRAMS:
            with self.subTest(program=program):
                elf = load(program)
                counts = relocation_counts(elf)
                cpi = counts["sol_invoke_signed_rust"] + counts[
                    "sol_invoke_signed_c"]
                expected = (cpi, counts["sol_memcpy_"])
                self.assertEqual(expected, EXPECTED[program])
                self.assertEqual(module_totals(elf), expected)


class LegacySyscallFormTests(unittest.TestCase):
    """The 0x85 0x00 + 32-bit hash encoding must still be detected."""

    def fake_elf(self, payload, relocations=None):
        blob = payload + bytes(8 - len(payload) % 8)
        return SimpleNamespace(b=blob, relocations=relocations or {},
                               lo=0, hi=len(blob))

    def test_cpi_syscall_form_fallback(self):
        for hash32 in (0xd56b5fe9, 0xe4042040):
            with self.subTest(hash=hex(hash32)):
                call = b"\x85\x00\x00\x00" + struct.pack("<I", hash32)
                elf = self.fake_elf(bytes(16) + call)
                patterns = bytecode_signatures.detect_cpi_patterns(
                    elf, 0, len(elf.b))
                self.assertEqual(len(patterns), 1)
                self.assertEqual(patterns[0]["form"], "syscall")
                self.assertEqual(patterns[0]["offset"], 16)

    def test_memcpy_syscall_form_fallback(self):
        call = b"\x85\x00\x00\x00" + struct.pack("<I", 0xa22b9c85)
        elf = self.fake_elf(bytes(24) + call)
        serialization = bytecode_signatures.detect_serialization_patterns(
            elf, 0, len(elf.b))
        self.assertEqual(serialization["memcpy_calls"], 1)

    def test_relocation_form(self):
        call = b"\x85\x10\x00\x00" + struct.pack("<i", -1)
        elf = self.fake_elf(bytes(16) + call,
                            {16: {"type": 10,
                                  "symbol": "sol_invoke_signed_rust"}})
        cpis = bytecode_signatures.detect_cpi_patterns(elf, 0, len(elf.b))
        self.assertEqual(len(cpis), 1)
        self.assertEqual(cpis[0]["form"], "relocation")
        self.assertEqual(cpis[0]["syscall"], "sol_invoke_signed_rust")

    def test_callsite_is_not_double_counted(self):
        # A relocated call whose imm also happens to equal the syscall hash
        # must still be reported once.
        call = b"\x85\x10\x00\x00" + struct.pack("<I", 0xe4042040)
        elf = self.fake_elf(bytes(16) + call,
                            {16: {"type": 10,
                                  "symbol": "sol_invoke_signed_rust"}})
        self.assertEqual(
            len(bytecode_signatures.detect_cpi_patterns(elf, 0, len(elf.b))), 1)
        call = b"\x85\x10\x00\x00" + struct.pack("<I", 0xa22b9c85)
        elf = self.fake_elf(bytes(16) + call,
                            {16: {"type": 10, "symbol": "sol_memcpy_"}})
        self.assertEqual(bytecode_signatures.detect_serialization_patterns(
            elf, 0, len(elf.b))["memcpy_calls"], 1)

    def test_lddw_relocation_is_not_a_cpi(self):
        # Type-10 also patches `lddw`; it must not be mistaken for a call.
        elf = SimpleNamespace(
            b=bytes(16) + b"\x18\x00\x00\x00" + bytes(24),
            relocations={16: {"type": 10,
                              "symbol": "sol_invoke_signed_rust"}},
            lo=0, hi=40)
        self.assertEqual(
            bytecode_signatures.detect_cpi_patterns(elf, 0, len(elf.b)), [])


if __name__ == "__main__":
    unittest.main()
