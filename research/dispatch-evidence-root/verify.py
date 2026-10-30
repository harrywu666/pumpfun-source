#!/usr/bin/env python3
"""Verify the accepted dispatch-helper transition and its recorded successors."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ASSET = 'scripts/recover_dispatch.py'
record = json.loads(Path(__file__).with_name('transition.json').read_text(encoding='utf-8'))


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def is_ancestor(commit, head='HEAD'):
    return subprocess.call(['git', '-C', str(ROOT), 'merge-base', '--is-ancestor',
                            commit, head]) == 0


def check(record, show, ancestor, current):
    """Check the accepted asset transition and every recorded successor.

    Args:
        record: the parsed transition record.
        show: callable(commit, path) returning the blob at that revision.
        ancestor: callable(commit) reporting whether the commit is in HEAD.
        current: the current working-tree bytes of the asset.

    Raises:
        SystemExit: when the record, its lineage or the current asset differs.
    """
    base = record['baseRevision']
    require(re.fullmatch('[0-9a-f]{40}', base), 'base must be an exact commit')
    asset = record['asset']
    require(asset['path'] == ASSET, 'unexpected transition asset')
    require(sha(show(base, ASSET)) == asset['beforeSha256'], 'base script drift')

    landed = asset['landedIn']
    require(re.fullmatch('[0-9a-f]{40}', landed), 'landedIn must be an exact commit')
    require(ancestor(landed), 'landed revision is not in history')
    require(sha(show(landed, ASSET)) == asset['afterSha256'],
            'landed script drift')

    successors = asset['successors']
    require(successors, 'successor lineage is empty')
    for index, successor in enumerate(successors):
        commit = successor['commit']
        require(re.fullmatch('[0-9a-f]{40}', commit),
                f'successor {index} must be an exact commit')
        require(ancestor(commit), f'successor {index} is not in history')
        require(sha(show(commit, ASSET)) == successor['sha256'],
                f'successor {index} script drift')
    require(sha(current) == successors[-1]['sha256'], 'current script drift')

    # The accepted change itself must survive the successors: the recovery
    # loop selects programs from the caller's evidence root.
    require(re.search(rb'program_names\(\s*root\s*\)', current) is not None,
            'accepted evidence-root change is gone')
    return True


def main():
    base_paths = sorted(p for p in git('ls-tree', '-r', '--name-only',
                                       record['baseRevision'], '--', 'scripts')
                        .decode('utf-8').splitlines()
                        if p.count('/') == 1 and p.endswith('.py'))
    current_paths = sorted(p.relative_to(ROOT).as_posix()
                           for p in (ROOT / 'scripts').glob('*.py') if p.is_file())
    # The base set is a historical fact and stays sealed below. The current
    # tree may only grow: a later proposal that removed a base script would
    # invalidate the captured dependency record this transition relies on.
    removed = sorted(set(base_paths) - set(current_paths))
    require(removed == [], f'base script removed: {removed[:3]}')
    names = record['directPythonScriptSet']
    require(len(base_paths) == names['count'], 'script-name count drift')
    require(sha(('\n'.join(base_paths) + '\n').encode('utf-8')) == names['sha256'],
            'script-name digest drift')
    for path, expected in record['unchangedCaptures'].items():
        require(sha(git('show', f'{record["baseRevision"]}:{path}')) == expected,
                f'base capture drift: {path}')
        require(sha((ROOT / path).read_bytes()) == expected,
                f'current capture drift: {path}')
    check(record,
          lambda commit, path: git('show', f'{commit}:{path}'),
          is_ancestor,
          (ROOT / ASSET).read_bytes())
    print('Accepted dispatch asset transition and successor lineage verified; '
          'no acceptance or equivalence claim.')


if __name__ == '__main__':
    main()
