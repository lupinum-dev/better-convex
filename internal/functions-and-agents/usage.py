"""Cost per call, from a Convex deployment's function logs.

Each log entry records what one function execution read and wrote
(`usageStats`). A user-visible call can start nested executions (an HTTP
action that runs a mutation, a mutation that queries the auth component), so
this script groups every execution under the call that started it and adds
them up.

Usage, from an app folder that is linked to the deployment:

    npx convex logs --history 2000 --jsonl --success > logs.jsonl   # stop it with Ctrl-C after ~40 s
    python3 usage.py logs.jsonl

The CLI keeps watching after it prints the history, so stop it once the output
stops growing. A deployment keeps roughly the last 1,000 executions.

Columns, averaged per root call: n (calls seen), execs (executions in the
call, nested included), docs and KB read, docs and KB written, ms (root
execution time). See measurements.md for how to read the numbers.
"""

import collections
import json
import sys


def main(path: str) -> None:
    entries = [json.loads(line) for line in open(path) if line.startswith('{')]
    runs = [e for e in entries if e.get('kind') == 'Completion']
    by_id = {r['executionId']: r for r in runs}

    def root_of(run: dict) -> dict:
        for _ in range(20):
            parent = run.get('parentExecutionId')
            if not parent or parent not in by_id:
                return run
            run = by_id[parent]
        return run

    calls: dict[str, list[dict]] = collections.defaultdict(list)
    for run in runs:
        calls[root_of(run)['executionId']].append(run)

    totals: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for root_id, group in calls.items():
        root = by_id[root_id]
        name = f"{root.get('componentPath') or ''}:{root['identifier']} ({root['udfType']})"
        total = totals[name]
        total['n'] += 1
        total['execs'] += len(group)
        total['ms'] += (root.get('executionTime') or 0) * 1000
        for run in group:
            usage = run.get('usageStats') or {}
            total['read_docs'] += usage.get('databaseReadDocuments', 0)
            total['read_bytes'] += usage.get('databaseIoReadBytes', 0)
            total['write_docs'] += usage.get('databaseWriteDocuments', 0)
            total['write_bytes'] += usage.get('databaseIoWriteBytes', 0)
            total['cached'] += bool(run.get('cachedResult'))

    times = [r['timestamp'] for r in runs]
    if times:
        print(f'{len(runs)} executions over {(max(times) - min(times)) / 60:.0f} minutes\n')
    header = f"{'root call':52} {'n':>4} {'execs':>5} {'docs':>5} {'KB':>6} {'w docs':>6} {'w KB':>5} {'ms':>5}"
    print(header)
    for name, t in sorted(totals.items(), key=lambda item: -item[1]['n']):
        n = t['n']
        print(
            f"{name[:52]:52} {n:4} {t['execs'] / n:5.1f} {t['read_docs'] / n:5.1f} "
            f"{t['read_bytes'] / n / 1024:6.2f} {t['write_docs'] / n:6.1f} "
            f"{t['write_bytes'] / n / 1024:5.2f} {t['ms'] / n:5.0f}"
        )


if __name__ == '__main__':
    main(sys.argv[1])
