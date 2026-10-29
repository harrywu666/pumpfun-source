"""Mutation controls for the four pump_amm_interface.rs Location records."""
from pathlib import Path
import copy
import gzip
import json
import os
import shutil
import struct
import tempfile
import unittest
import proof

P = Path(__file__).resolve().parent
R = proof.REPO


class PumpAmmInterfaceLocation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = proof.Elf(R / proof.ORIGINAL)
        cls.candidate = proof.elf_from_gzip(R / proof.CANDIDATE)
        cls.report = proof.verify_images(cls.original, cls.candidate)

    def image(self, image, blob):
        changed = copy.copy(image)
        changed.b = bytes(blob)
        return changed

    def offset(self, image, address, name):
        section = image.secs[name]
        assert section[3] <= address < section[3] + section[5]
        return section[4] + address - section[3]

    def relocation_offset(self, image, address):
        section = image.secs['.rel.dyn']
        for position in range(section[4], section[4] + section[5], 16):
            if struct.unpack_from('<Q', image.b, position)[0] == address:
                return position
        raise AssertionError(address)

    def mutated(self, image, address, name, format_string, value, delta=0):
        blob = bytearray(image.b)
        struct.pack_into(format_string, blob, self.offset(image, address, name) + delta, value)
        return self.image(image, blob)

    def both(self, side, changed):
        if side == 'original':
            return changed, self.candidate
        return self.original, changed

    def test_complete(self):
        summary = proof.check(P, R)
        self.assertEqual(
            (summary['path_bytes'], summary['path_text_bytes'],
             summary['trailing_nul_bytes'], summary['records'],
             summary['record_bytes'], summary['mapped_pointer_bytes'],
             summary['raw_record_bytes'], summary['new_payload_bytes']),
            (63, 62, 1, 4, 96, 32, 64, 159),
        )

    def test_every_path_byte(self):
        for index in range(proof.PATH_LENGTH):
            with self.subTest(byte=index):
                at = proof.PATH_CANDIDATE + index
                blob = bytearray(self.candidate.b)
                blob[self.offset(self.candidate, at, '.rodata')] ^= 1
                with self.assertRaises(AssertionError):
                    proof.verify_images(self.original, self.image(self.candidate, blob))

    def test_record_pointer_low_word(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                changed = self.mutated(
                    self.original, row['original'], '.data.rel.ro', '<I', 1
                )
                with self.assertRaises(AssertionError):
                    proof.verify_images(changed, self.candidate)

    def test_record_pointer_high_word(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                changed = self.mutated(
                    self.original, row['original'], '.data.rel.ro', '<I',
                    proof.PATH_ORIGINAL + 8, 4,
                )
                with self.assertRaises(AssertionError):
                    proof.verify_images(changed, self.candidate)

    def test_record_length(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                changed = self.mutated(
                    self.original, row['original'], '.data.rel.ro', '<Q', 64, 8
                )
                with self.assertRaises(AssertionError):
                    proof.verify_images(changed, self.candidate)

    def test_record_line(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                changed = self.mutated(
                    self.original, row['original'], '.data.rel.ro', '<I',
                    row['line'] + 1, 16,
                )
                with self.assertRaises(AssertionError):
                    proof.verify_images(changed, self.candidate)

    def test_record_column(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                changed = self.mutated(
                    self.original, row['original'], '.data.rel.ro', '<I',
                    row['column'] + 1, 20,
                )
                with self.assertRaises(AssertionError):
                    proof.verify_images(changed, self.candidate)

    def test_candidate_row_line(self):
        row = proof.ROWS[0]
        address = proof.candidate_row(self.candidate, row['line'], row['column'])
        changed = self.mutated(
            self.candidate, address, '.data.rel.ro', '<I', row['line'] + 1, 16
        )
        with self.assertRaises(AssertionError):
            proof.verify_images(self.original, changed)

    def test_record_relocation_type(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                position = self.relocation_offset(self.original, row['original'])
                blob = bytearray(self.original.b)
                info = struct.unpack_from('<Q', blob, position + 8)[0]
                struct.pack_into('<Q', blob, position + 8, (info & ~0xffffffff) | 9)
                with self.assertRaises(AssertionError):
                    proof.verify_images(self.image(self.original, blob), self.candidate)

    def test_record_relocation_symbol(self):
        for row in proof.ROWS:
            with self.subTest(row=row['original']):
                position = self.relocation_offset(self.original, row['original'])
                blob = bytearray(self.original.b)
                info = struct.unpack_from('<Q', blob, position + 8)[0]
                struct.pack_into('<Q', blob, position + 8, (1 << 32) | (info & 0xffffffff))
                with self.assertRaises(AssertionError):
                    proof.verify_images(self.image(self.original, blob), self.candidate)

    def test_following_path_byte_is_not_absorbed(self):
        at = proof.PATH_CANDIDATE + proof.PATH_LENGTH
        blob = bytearray(self.candidate.b)
        blob[self.offset(self.candidate, at, '.rodata')] ^= 1
        self.assertEqual(
            proof.verify_images(self.original, self.image(self.candidate, blob)),
            self.report,
        )

    def test_nul_inside_bound_is_not_a_boundary(self):
        at = proof.PATH_CANDIDATE + proof.PATH_LENGTH - 1
        self.assertEqual(
            proof.read(self.candidate, '.rodata', at, 1),
            b'\x00',
        )
        blob = bytearray(self.candidate.b)
        blob[self.offset(self.candidate, at, '.rodata')] ^= 1
        with self.assertRaises(AssertionError):
            proof.verify_images(self.original, self.image(self.candidate, blob))

    def test_following_record_is_not_absorbed(self):
        address = proof.ROWS[-1]['original'] + 24
        self.assertEqual(
            proof.read(self.original, '.data.rel.ro', address + 8, 8),
            struct.pack('<Q', 59),
        )
        changed = self.mutated(
            self.original, address, '.data.rel.ro', '<I', 1, 16
        )
        self.assertEqual(
            proof.verify_images(changed, self.candidate),
            self.report,
        )

    def copied(self, change, reseal=False):
        with tempfile.TemporaryDirectory() as temporary:
            packet = Path(temporary) / 'packet'
            shutil.copytree(P, packet, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            change(packet)
            if reseal:
                inventory = {
                    str(path.relative_to(packet)): proof.sha(path.read_bytes())
                    for path in packet.rglob('*')
                    if path.is_file()
                    and path.name != 'manifest.json'
                    and '__pycache__' not in path.parts
                    and path.suffix != '.pyc'
                }
                (packet / 'manifest.json').write_text(json.dumps(inventory, indent=2) + '\n')
            with self.assertRaises((AssertionError, ValueError)):
                proof.check(packet, R)

    def test_unlisted_file(self):
        self.copied(lambda packet: (packet / 'extra').write_bytes(b'x'))

    def test_symlink(self):
        self.copied(lambda packet: (packet / 'alias').symlink_to('inputs.json'))

    def test_fifo(self):
        self.copied(lambda packet: os.mkfifo(packet / 'pipe'))

    def test_resealed_observations(self):
        def change(packet):
            report = json.loads(gzip.decompress((packet / 'observations.json.gz').read_bytes()))
            report['rows'][0]['original']['line'] += 1
            (packet / 'observations.json.gz').write_bytes(
                gzip.compress(json.dumps(report, separators=(',', ':')).encode(), mtime=0)
            )
        self.copied(change, True)

    def test_resealed_coverage(self):
        def change(packet):
            delta = json.loads((packet / 'coverage-delta.json').read_bytes())
            delta['new_payload_bytes'] += 1
            (packet / 'coverage-delta.json').write_text(json.dumps(delta))
        self.copied(change, True)

    def test_baseline_tamper(self):
        def change(packet):
            baseline = json.loads((packet / 'baseline/sources.json').read_bytes())
            path = next(iter(baseline['deltas']))
            baseline['deltas'][path] = '0' * 64
            (packet / 'baseline/sources.json').write_text(json.dumps(baseline))
        self.copied(change, True)

    def test_inputs_tamper(self):
        def change(packet):
            pins = json.loads((packet / 'inputs.json').read_bytes())
            path = next(iter(pins))
            pins[path] = '0' * 64
            (packet / 'inputs.json').write_text(json.dumps(pins))
        self.copied(change, True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
