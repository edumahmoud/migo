#!/usr/bin/env python3
"""v134n: Clean up leftover linear-gradient patterns in source files."""

import re
from pathlib import Path

PATTERNS = [
    # background: 'currentColor'`linear-gradient(...)` followed by optional comma
    re.compile(r"background:\s*'currentColor'`linear-gradient\([^`]*\)`,?"),
    # 'linear-gradient(...)' as a standalone string literal
    re.compile(r"'linear-gradient\([^']*'\)"),
]

def clean_file(path: Path) -> int:
    try:
        content = path.read_text(encoding='utf-8')
    except Exception:
        return 0
    original = content
    for pattern in PATTERNS:
        content = pattern.sub("background: 'currentColor'", content)
    if content != original:
        path.write_text(content, encoding='utf-8')
        return original.count('linear-gradient') - content.count('linear-gradient')
    return 0

def main():
    src_dir = Path('/home/z/my-project/migo/src')
    total = 0
    for ext in ('*.tsx', '*.ts'):
        for path in src_dir.rglob(ext):
            if 'node_modules' in str(path):
                continue
            cleaned = clean_file(path)
            if cleaned > 0:
                print(f"  {path}: removed {cleaned} gradient(s)")
                total += cleaned
    print(f"\nTotal: {total} gradient patterns cleaned.")

if __name__ == '__main__':
    main()
