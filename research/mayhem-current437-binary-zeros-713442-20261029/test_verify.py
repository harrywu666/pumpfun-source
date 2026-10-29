from pathlib import Path
import unittest
import reference_trace as ref
import verify

ROOT = Path(__file__).resolve().parents[2]


class Tests(unittest.TestCase):
    def test_zero_bytes_and_open_span(self):
        report = verify.check(ROOT)
        self.assertEqual(report['new_bytes'], 0)
        self.assertEqual(report['new_intervals'], [])
        self.assertEqual(report['still_open'], [[713442, 713704]])

    def test_nine_sites_and_no_length_immediate(self):
        report = verify.check(ROOT)
        self.assertEqual(len(report['lddw_sites']), 9)
        self.assertEqual([s['pc'] for s in report['lddw_sites']], [16168, 17072, 18096, 29112, 31752, 311360, 334240, 605280, 606912])
        for site in report['lddw_sites']:
            self.assertIsNone(site['length_immediate_at_pc_plus_16'])
            self.assertNotIn(site['next_opcode'], (0xb7, 0x07))

    def test_descriptor_scan_empty(self):
        report = verify.check(ROOT)
        self.assertEqual(report['descriptor_scan']['triples_low0_high_in_gap'], 0)
        self.assertEqual(report['descriptor_scan']['ptr_len_pairs_into_gap'], 0)

    def test_fake_interval_is_rejected(self):
        report = verify.check(ROOT)
        with self.assertRaises(AssertionError):
            ref.require_no_claim(report, [713442, 713474])
        with self.assertRaises(AssertionError):
            ref.require_no_claim(report, [713600, 713705])
        with self.assertRaises(AssertionError):
            ref.require_no_claim(report, [713000, 714000])


if __name__ == '__main__':
    unittest.main()
