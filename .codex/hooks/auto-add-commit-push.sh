#!/usr/bin/env bash
set -u

exec 3>&1
log_file="${TMPDIR:-/tmp}/codex-auto-commit.log"

finish() {
	printf '{}\n' >&3
	exit 0
}

log() {
	printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$log_file"
}

{
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$repo_root" ]; then
	log "skip: not inside a git repository"
	finish
fi

cd "$repo_root" || {
	log "skip: could not cd to repo root: $repo_root"
	finish
}

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
	log "skip: no changes"
	finish
fi

git add -A

git restore --staged -- '*.env' '*.pem' '*.key' 'credentials.json' 2>/dev/null || true

if git diff --cached --quiet; then
	log "skip: no safe staged changes"
	finish
fi

tool_name="${CODEX_TOOL_NAME:-tool}"
timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
commit_message="auto: commit after ${tool_name} ${timestamp}"

if git commit -m "$commit_message" >>"$log_file" 2>&1; then
	log "committed: $commit_message"
else
	log "commit failed"
fi
} >>"$log_file" 2>&1

finish
