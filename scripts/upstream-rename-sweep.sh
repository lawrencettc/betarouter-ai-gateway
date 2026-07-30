#!/usr/bin/env bash
# Post-merge rebrand sweep: rewrite llmgateway-era references to betarouter
# in tracked source files.
#
# Rewrites:
#   @llmgateway/            -> @betarouter/     (except @llmgateway/ai-sdk-provider,
#                                                 which stays as-is: it's a real
#                                                 third-party npm package)
#   LLM Gateway              -> BetaRouter
#   LLMGateway                -> BetaRouter
#   llmgateway.io              -> betarouter.com
#   DevPass                    -> BetaPass   (ONLY with --include-devpass: "DevPass"
#                                             is this repo's deliberate internal
#                                             codename in identifiers, comments and
#                                             analytics event names; only rendered
#                                             UI copy says "BetaPass". A blanket
#                                             rewrite would rename ~300 internal
#                                             identifiers. Use only on freshly
#                                             merged upstream files, never repo-wide.)
#
# Scope: same extension set and exclusions as scripts/check-brand.sh
# (ts,tsx,js,mjs,json,md,mdx,yml,yaml; excludes pnpm-lock.yaml, node_modules,
# dist, .next, .git, and migration snapshots).
#
# Usage:
#   scripts/upstream-rename-sweep.sh [--dry-run] [--include-devpass]
#
#   --dry-run          Report which files would change and how many
#                      replacements each would get, without writing anything.
#   --include-devpass  Also rewrite DevPass -> BetaPass (dangerous repo-wide;
#                      see note above).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

dry_run=0
include_devpass=0
for arg in "$@"; do
	case "$arg" in
	--dry-run)
		dry_run=1
		;;
	--include-devpass)
		include_devpass=1
		;;
	*)
		echo "upstream-rename-sweep.sh: unknown argument: $arg" >&2
		echo "usage: $0 [--dry-run] [--include-devpass]" >&2
		exit 2
		;;
	esac
done

exts=(ts tsx js mjs json md mdx yml yaml)

exclude_pathspecs=(
	":!pnpm-lock.yaml"
	":!**/node_modules/**"
	":!**/dist/**"
	":!**/.next/**"
	":!**/migrations/**"
)

declare -a glob_pathspecs=()
for ext in "${exts[@]}"; do
	glob_pathspecs+=("*.${ext}")
done

# Placeholder used to protect the legitimate `@llmgateway/ai-sdk-provider`
# npm package name for the duration of the sweep. Chosen to be extremely
# unlikely to collide with real content.
placeholder="__BETAROUTER_SWEEP_PROTECTED_AI_SDK_PROVIDER__"

declare -a grep_patterns=(-e '@llmgateway/' -e 'LLM Gateway' -e 'LLMGateway' -e 'llmgateway\.io')
[ "$include_devpass" -eq 1 ] && grep_patterns+=(-e 'DevPass')

mapfile -t files < <(git grep -l -I "${grep_patterns[@]}" -- "${glob_pathspecs[@]}" "${exclude_pathspecs[@]}" 2>/dev/null || true)

if [ "${#files[@]}" -eq 0 ]; then
	echo "upstream-rename-sweep.sh: no matching files found. Nothing to do."
	exit 0
fi

total_files_changed=0
total_replacements=0

apply_sed() {
	local file="$1"
	local -a sed_exprs=(
		-e "s#@llmgateway/ai-sdk-provider#${placeholder}#g"
		-e "s#@llmgateway/#@betarouter/#g"
		-e "s#LLM Gateway#BetaRouter#g"
		-e "s#LLMGateway#BetaRouter#g"
		-e "s#llmgateway\\.io#betarouter.com#g"
	)
	[ "$include_devpass" -eq 1 ] && sed_exprs+=(-e "s#DevPass#BetaPass#g")
	sed_exprs+=(-e "s#${placeholder}#@llmgateway/ai-sdk-provider#g")
	sed -i "${sed_exprs[@]}" "$file"
}

count_replacements() {
	# Counts how many of our target patterns appear in a file (protecting the
	# ai-sdk-provider package name from being counted as an @llmgateway/ hit).
	local file="$1"
	local stripped
	stripped="$(grep -v '@llmgateway/ai-sdk-provider' "$file" 2>/dev/null || true)"
	local n=0
	n=$((n + $(printf '%s\n' "$stripped" | grep -o '@llmgateway/' | wc -l)))
	n=$((n + $(grep -o 'LLM Gateway' "$file" | wc -l)))
	n=$((n + $(grep -o 'LLMGateway' "$file" | wc -l)))
	n=$((n + $(grep -o 'llmgateway\.io' "$file" | wc -l)))
	if [ "$include_devpass" -eq 1 ]; then
		n=$((n + $(grep -o 'DevPass' "$file" | wc -l)))
	fi
	echo "$n"
}

echo "== betarouter upstream rename sweep =="
[ "$dry_run" -eq 1 ] && echo "(dry run - no files will be modified)"
echo

for file in "${files[@]}"; do
	n="$(count_replacements "$file")"
	[ "$n" -eq 0 ] && continue

	if [ "$dry_run" -eq 1 ]; then
		echo "would change: $file ($n replacement(s))"
	else
		tmp="$(mktemp)"
		cp "$file" "$tmp"
		apply_sed "$file"
		if cmp -s "$tmp" "$file"; then
			echo "unchanged: $file"
		else
			echo "changed: $file ($n replacement(s))"
			total_files_changed=$((total_files_changed + 1))
		fi
		rm -f "$tmp"
	fi
	total_replacements=$((total_replacements + n))
done

echo
if [ "$dry_run" -eq 1 ]; then
	echo "dry run summary: ${total_replacements} replacement(s) across $(printf '%s\n' "${files[@]}" | wc -l) candidate file(s)."
	echo "Re-run without --dry-run to apply."
else
	echo "sweep summary: ${total_replacements} replacement(s) applied across ${total_files_changed} file(s)."
fi
