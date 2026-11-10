import argparse
import json
from collections import Counter
from pathlib import Path


def read_report(path, root):
    report = json.loads(path.read_text())
    results = report["testResults"]
    if not results or len(results) != report["numTotalTestSuites"]:
        raise ValueError(f"Incomplete suite list in {path}")
    cases = {}
    suites = set()
    suite_failures = set()
    occurrences = Counter()
    for suite in results:
        name = Path(suite["name"])
        name = str(name.relative_to(root)) if name.is_absolute() else str(name)
        if name in suites:
            raise ValueError(f"Suite appears twice in {path}: {name}")
        suites.add(name)
        assertions = suite["assertionResults"]
        if suite["status"] == "failed" and all(a["status"] != "failed" for a in assertions):
            suite_failures.add(name)
        for case in assertions:
            key = (name, case["fullName"])
            occurrences[key] += 1
            cases[(*key, occurrences[key])] = case["status"]
    if len(cases) != report["numTotalTests"]:
        raise ValueError(f"Incomplete assertion list in {path}")
    return suites, suite_failures, cases, report


def compare(base, candidate):
    old_suites, old_suite_failures, old, old_report = base
    new_suites, new_suite_failures, new, new_report = candidate
    new_failures = sorted(key for key, value in new.items() if value == "failed" and old.get(key) != "failed")
    changed_to_non_execution = sorted(
        (key, value)
        for key, value in old.items()
        if value in ("passed", "failed") and new.get(key) not in ("passed", "failed")
    )
    result = {
        "baseline": {k: old_report[k] for k in ("numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTotalTestSuites")},
        "candidate": {k: new_report[k] for k in ("numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTotalTestSuites")},
        "newFailedCases": new_failures,
        "newSuiteFailures": sorted(new_suite_failures - old_suite_failures),
        "missingSuites": sorted(old_suites - new_suites),
        "missingOrNewlySkippedPreviouslyExecutedCases": changed_to_non_execution,
        "baselineFailuresNowPassing": sorted(key for key, value in old.items() if value == "failed" and new.get(key) == "passed"),
    }
    result["noNewFailuresAndNoLostExecutedCoverage"] = not any(
        result[key] for key in ("newFailedCases", "newSuiteFailures", "missingSuites", "missingOrNewlySkippedPreviouslyExecutedCases")
    )
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("baseline_root", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("candidate_root", type=Path)
    args = parser.parse_args()
    result = compare(
        read_report(args.baseline, args.baseline_root.resolve()),
        read_report(args.candidate, args.candidate_root.resolve()),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["noNewFailuresAndNoLostExecutedCoverage"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
