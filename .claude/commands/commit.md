Generate a commit message and push to remote.

Follow these steps:

1. Run `git status` to see all changed files (never use -uall flag).
2. Run `git diff` to see unstaged changes and `git diff --cached` to see staged changes.
3. Run `git log --oneline -5` to see recent commit message style.
4. Stage all relevant changed files using `git add` with specific file paths (avoid `git add -A` unless all changes should be included).
5. Analyze the staged changes and draft a concise commit message in imperative mood (max 72 chars for the subject line). Focus on the "why" not the "what". Match the style of recent commits.
6. Create the commit using a HEREDOC:
   ```
   git commit -m "$(cat <<'EOF'
   Your commit message here
   EOF
   )"
   ```
7. Run `git push` to push the commit to the remote.
8. Confirm success to the user with the commit hash and pushed branch.

Important:
- Never use `git push --force`.
- Never skip hooks with `--no-verify`.
- Do not commit files that may contain secrets (.env, credentials, etc.).
- If there are no changes to commit, inform the user instead of creating an empty commit.
