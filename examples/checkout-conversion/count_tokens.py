"""Count the text payloads emitted by the checkout MCP benchmark."""

import json
import sys

import tiktoken


def main():
    encoding = tiktoken.get_encoding("o200k_base")
    cases = json.load(sys.stdin)
    for case, variants in cases.items():
        counts = {
            variant: sum(len(encoding.encode_ordinary(part)) for part in parts)
            for variant, parts in variants.items()
        }
        print(case)
        for variant, count in counts.items():
            print(f"  {variant}: {count:,}")
        for baseline in ("pasted", "fullMcp"):
            change = (counts["bounded"] / counts[baseline] - 1) * 100
            print(f"  bounded vs {baseline}: {change:+.1f}%")
        for baseline in ("pasted", "bounded"):
            change = (counts["batched"] / counts[baseline] - 1) * 100
            print(f"  batched vs {baseline}: {change:+.1f}%")


if __name__ == "__main__":
    main()
