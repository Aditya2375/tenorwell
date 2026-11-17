import argparse
import json
from .core import analyze


def main():
    parser = argparse.ArgumentParser(
        description="Synthetic SVI surface, finite candidate calibration and sampled diagnostics"
    )
    parser.add_argument("--scenario", type=int, default=0)
    parser.add_argument("--budget", type=int, default=0)
    parser.add_argument("--slice", type=int, default=6)
    args = parser.parse_args()
    try:
        result = analyze(vars(args))
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    main()
