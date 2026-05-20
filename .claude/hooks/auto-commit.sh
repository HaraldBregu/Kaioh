#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 0

# Skip if nothing changed
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  exit 0
fi

# Skip secret files
EXCLUDE_PATTERNS=(.env credentials.json *.pem *.key)
EXCLUDE_ARGS=""
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS -- . ':!$pattern'"
done

# Stage all changes
git add -A

# Unstage secret files if accidentally added
git reset HEAD -- '*.env' '*.pem' '*.key' 'credentials.json' 2>/dev/null

# Get recent commit style
RECENT_STYLE=$(git log --oneline -5 2>/dev/null)

# Generate commit message using Claude Code
DIFF=$(git diff --cached --stat && echo "---" && git diff --cached)
COMMIT_MSG=$(echo "$DIFF" | claude -p "Generate a concise git commit message (imperative mood, max 72 chars) summarizing these staged changes. Match this repo's commit style: $RECENT_STYLE. Reply with ONLY the commit message, no explanation, no quotes." 2>/dev/null)

# Fallback to timestamp message if claude command fails or returns empty
if [ -z "$COMMIT_MSG" ]; then
  COMMIT_MSG="Auto-commit from Claude Code [$(date '+%Y-%m-%d %H:%M:%S')]"
fi

git commit -m "$COMMIT_MSG" || true
git push || true
exit 0
