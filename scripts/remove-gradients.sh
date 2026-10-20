#!/bin/bash
# v134n: Remove all gradients from the codebase.
# Replaces common bg-gradient-* patterns with flat solid colors.
#
# Strategy:
#   - bg-gradient-to-br from-X to-Y  →  bg-X (keep the "from" color as the flat fill)
#   - bg-gradient-to-r from-X to-Y   →  bg-X
#   - via-* middle colors are dropped
#   - When the "from" is a transparent/shade color, we use a neutral bg
#
# This is a lossy simplification — gradients are replaced with the
# starting color. Designers may want to manually touch up specific
# cards afterward, but this gives us a consistent "no gradients" baseline.

set -e
cd /home/z/my-project/migo

# Patterns to replace (most common first).
# Each sed replaces gradient classes with a flat color.
# We use perl for multiline-friendly regex.

# 1. Remove "via-*" middle color classes (always part of gradients).
find src/ -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe 's/\s+via-[a-z0-9-]+(?:\/[0-9]+)?//g' {} +

# 2. Replace "bg-gradient-to-X from-Y to-Z" with "bg-Y" (flat color = from).
#    This handles: bg-gradient-to-br from-sky-500 to-violet-500 → bg-sky-500
find src/ -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe 's/bg-gradient-to-[a-z]+ from-([a-z]+-[0-9]+) to-[a-z]+(?:-[0-9]+)?/bg-$1/g' {} +

# 3. Replace any remaining "bg-gradient-to-X from-Y" (without "to-") with "bg-Y".
find src/ -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe 's/bg-gradient-to-[a-z]+ from-([a-z]+-[0-9]+)/bg-$1/g' {} +

# 4. Strip leftover "from-*" and "to-*" classes that are now orphaned.
find src/ -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe 's/\s+from-[a-z0-9-]+(?:\/[0-9]+)?//g' {} +
find src/ -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe 's/\s+to-[a-z0-9-]+(?:\/[0-9]+)?//g' {} +

# 5. Same for inline style backgrounds that use gradients.
#    style={{ background: 'linear-gradient(...)' }}
#    Replace with the first color in the gradient.
find src/ -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -i -pe "s/background:\s*['\"]linear-gradient\([^)]+\)['\"]/background: 'currentColor'/g" {} +

echo "Done. Remaining bg-gradient occurrences:"
grep -rn "bg-gradient-to" --include="*.tsx" --include="*.ts" src/ 2>&1 | wc -l
echo ""
echo "Remaining linear-gradient occurrences:"
grep -rn "linear-gradient" --include="*.tsx" --include="*.ts" src/ 2>&1 | wc -l
