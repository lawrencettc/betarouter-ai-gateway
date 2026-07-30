#!/usr/bin/env bash
# CI gate: fail if old-brand (llmgateway) references leak into tracked source.
#
# Checks:
#   a) any `@llmgateway/` package reference, except the legitimate third-party
#      npm package `@llmgateway/ai-sdk-provider`.
#   b) the brand strings `LLM Gateway`, `LLMGateway`, or `llmgateway.io` in
#      user-facing source under apps/*/src, packages/shared/src, ee/*/src.
#
# Both checks honor scripts/check-brand-allowlist.conf for documented,
# currently-legitimate exceptions (see that file for format + entries).
#
# Usage: scripts/check-brand.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

allowlist_file="scripts/check-brand-allowlist.conf"

# Extensions scanned by both checks.
exts=(ts tsx js mjs json md mdx yml yaml)

# Pathspecs excluded from every check.
exclude_pathspecs=(
	":!pnpm-lock.yaml"
	":!**/node_modules/**"
	":!**/dist/**"
	":!**/.next/**"
)

build_glob_pathspecs() {
	local -a specs=()
	for ext in "${exts[@]}"; do
		specs+=("*.${ext}")
	done
	printf '%s\n' "${specs[@]}"
}

fail=0
summary=()

# --- Load allowlist -----------------------------------------------------
# Whole-file exemptions (bare "path" lines) and per-substring exemptions
# ("path:substring" lines) are kept separately so we can apply each rule
# with the right granularity.
declare -a allow_whole_files=()
declare -a allow_file_substrings=()

if [ -f "$allowlist_file" ]; then
	while IFS= read -r raw_line || [ -n "$raw_line" ]; do
		line="${raw_line%%$'\r'}"
		# Skip blank lines and comments.
		case "$line" in
		"" | "#"*) continue ;;
		esac
		if [[ "$line" == *:* ]]; then
			allow_file_substrings+=("$line")
		else
			allow_whole_files+=("$line")
		fi
	done <"$allowlist_file"
fi

is_whole_file_allowed() {
	local file="$1"
	local allowed
	for allowed in "${allow_whole_files[@]:-}"; do
		[ "$allowed" = "$file" ] && return 0
	done
	return 1
}

# Filters raw `git grep -n` output (file:line:text) on stdin, dropping any
# line whose file is wholly allowlisted or whose file:substring pair matches
# an allowlist entry. Remaining lines are printed to stdout.
apply_allowlist() {
	local file line_no text entry allow_file allow_substr matched
	while IFS=: read -r file line_no text; do
		if is_whole_file_allowed "$file"; then
			continue
		fi
		matched=0
		for entry in "${allow_file_substrings[@]:-}"; do
			allow_file="${entry%%:*}"
			allow_substr="${entry#*:}"
			if [ "$allow_file" = "$file" ] && [[ "$text" == *"$allow_substr"* ]]; then
				matched=1
				break
			fi
		done
		[ "$matched" -eq 1 ] && continue
		printf '%s:%s:%s\n' "$file" "$line_no" "$text"
	done
}

echo "== betarouter brand check =="
echo

# --- Check A: @llmgateway/ package references ---------------------------
echo "-- Check A: stray @llmgateway/ references --"

mapfile -t glob_pathspecs < <(build_glob_pathspecs)

raw_hits="$(git grep -n -I -e '@llmgateway/' -- "${glob_pathspecs[@]}" "${exclude_pathspecs[@]}" 2>/dev/null || true)"

# Strip lines referencing the allowed third-party package before allowlist
# filtering, per the implementation hint.
filtered_hits="$(printf '%s\n' "$raw_hits" | grep -v '@llmgateway/ai-sdk-provider' || true)"
filtered_hits="$(printf '%s\n' "$filtered_hits" | sed '/^$/d')"

a_offenders="$(printf '%s\n' "$filtered_hits" | apply_allowlist || true)"
a_offenders="$(printf '%s\n' "$a_offenders" | sed '/^$/d')"

if [ -n "$a_offenders" ]; then
	echo "FAIL: found @llmgateway/ references that are not the allowed ai-sdk-provider package:"
	echo "$a_offenders"
	fail=1
	summary+=("Check A (stray @llmgateway/ references): FAILED")
else
	echo "OK: no stray @llmgateway/ references."
	summary+=("Check A (stray @llmgateway/ references): passed")
fi
echo

# --- Check B: brand strings in user-facing source ------------------------
echo "-- Check B: old brand strings in user-facing source --"

brand_scope_dirs=(
	"apps/*/src"
	"packages/shared/src"
	"ee/*/src"
)

# git pathspecs are OR'd together, so a bare directory pathspec plus a bare
# extension pathspec would match "dir OR extension", not "dir AND extension".
# Build the cross product of scope dirs x extensions so each pathspec
# encodes both constraints at once.
declare -a brand_scope_pathspecs=()
for dir in "${brand_scope_dirs[@]}"; do
	for ext in "${exts[@]}"; do
		brand_scope_pathspecs+=("${dir}/**/*.${ext}")
	done
done

b_offenders_all=""
for pattern in "LLM Gateway" "LLMGateway" "llmgateway.io"; do
	hits="$(git grep -n -I -e "$pattern" -- "${brand_scope_pathspecs[@]}" "${exclude_pathspecs[@]}" 2>/dev/null || true)"
	[ -z "$hits" ] && continue
	b_offenders_all="${b_offenders_all}${hits}
"
done
b_offenders_all="$(printf '%s\n' "$b_offenders_all" | sed '/^$/d')"

b_offenders="$(printf '%s\n' "$b_offenders_all" | apply_allowlist || true)"
b_offenders="$(printf '%s\n' "$b_offenders" | sed '/^$/d')"

if [ -n "$b_offenders" ]; then
	echo "FAIL: found old brand strings in user-facing source:"
	echo "$b_offenders"
	fail=1
	summary+=("Check B (old brand strings in user-facing source): FAILED")
else
	echo "OK: no old brand strings in user-facing source."
	summary+=("Check B (old brand strings in user-facing source): passed")
fi
echo

echo "== Summary =="
for line in "${summary[@]}"; do
	echo "  - $line"
done

if [ "$fail" -ne 0 ]; then
	echo
	echo "check-brand.sh: FAILED. Fix the references above, or add a justified"
	echo "entry to $allowlist_file if it is a legitimate exception."
	exit 1
fi

echo
echo "check-brand.sh: PASSED."
exit 0
