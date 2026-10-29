from pathlib import Path
import unittest
import verify

ROOT = Path(__file__).resolve().parents[2]

class Tests(unittest.TestCase):
    def test_scope_and_references(self):
        report = verify.check(ROOT)
        self.assertEqual(report['new_bytes'], 0)
        self.assertEqual(report['new_intervals'], [])
        self.assertEqual(report['uncredited_intervals'], [[720330, 720344], [720348, 720360], [720372, 720376]])
        self.assertEqual([x['direct_loads'] for x in report['rows']], [[[665280, 720328]], [[598960, 700768]]])

if __name__ == '__main__':
    unittest.main()
