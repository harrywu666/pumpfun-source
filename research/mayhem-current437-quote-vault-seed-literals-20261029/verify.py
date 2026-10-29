#!/usr/bin/env python3
"""Read-only verifier for the quote-vault seed literals packet."""
from pathlib import Path
import argparse
import json
import proof

P = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--repo', default='.')
args = parser.parse_args()
root = Path(args.repo).resolve()
assert root == proof.REPO, (root, proof.REPO)
print(json.dumps(proof.check(P, root), indent=2))
