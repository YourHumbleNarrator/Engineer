"""
run_tests.py
Run the full test suite from the project root:

    python tests/run_tests.py           # all tests, normal output
    python tests/run_tests.py -v        # verbose
    python tests/run_tests.py loaders   # only test_loaders.py
    python tests/run_tests.py serial    # only test_serialisers.py
    python tests/run_tests.py core      # only test_core.py
    python tests/run_tests.py api       # only test_api.py
"""

import sys
import unittest
import pathlib

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

MODULE_MAP = {
    "loaders": "tests.test_loaders",
    "serial":  "tests.test_serialisers",
    "core":    "tests.test_core",
    "api":     "tests.test_api",
}


def main():
    args = sys.argv[1:]
    verbosity = 2 if "-v" in args else 1
    args = [a for a in args if a != "-v"]

    if args and args[0] in MODULE_MAP:
        suite = unittest.TestLoader().loadTestsFromName(MODULE_MAP[args[0]])
    else:
        suite = unittest.TestLoader().discover(
            start_dir=str(ROOT / "tests"),
            pattern="test_*.py",
            top_level_dir=str(ROOT),
        )

    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
