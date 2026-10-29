#!/usr/bin/env python3
"""Mutation tests ensuring the byte comparator cannot hide code/padding changes."""
import unittest
from types import SimpleNamespace
import deep_section_analysis
from compare import compare
class ComparisonTests(unittest.TestCase):
    def test_equal(self): self.assertTrue(compare(b'abc\0\0',b'abc\0\0')['full_byte_equality'])
    def test_code_mutation(self): self.assertEqual(compare(b'abc\0\0',b'axc\0\0')['first_difference'],1)
    def test_padding_mutation(self): self.assertEqual(compare(b'abc\0\0',b'abc\0x')['first_difference'],4)
    def test_truncated_padding(self): self.assertFalse(compare(b'abc\0\0',b'abc\0')['full_byte_equality'])
    def test_extended_padding(self): self.assertFalse(compare(b'abc\0',b'abc\0\0')['full_byte_equality'])
    def test_empty(self): self.assertEqual(compare(b'a',b'')['first_difference'],0)


class DataLayoutAddressTests(unittest.TestCase):
    def test_string_address_uses_virtual_address(self):
        blob = bytearray(0x40)
        blob[0x20:0x24] = b'TEST'
        elf = SimpleNamespace(
            b=bytes(blob),
            lo=0x2000,
            hi=0x3000,
            secs={'.rodata': (0, 1, 2, 0x1000, 0x20, 0x10, 0, 0, 1, 0)},
        )
        report = deep_section_analysis.analyze_data_layout(elf)
        self.assertEqual(report['.rodata']['strings'][0]['address'], '0x1000')


if __name__=='__main__': unittest.main()
