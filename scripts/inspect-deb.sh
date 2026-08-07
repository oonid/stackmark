#!/usr/bin/env bash
# Inspects a generated Debian package and fails unless it is the artifact
# Stage 0 expects. Run against the build output before anything is installed.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  printf 'usage: %s <path-to-deb> [more.deb ...]\n' "$0" >&2
  exit 64
fi

if [ "$#" -gt 1 ]; then
  printf 'expected exactly one .deb, found %s:\n' "$#" >&2
  printf '  %s\n' "$@" >&2
  exit 1
fi

package=$1
[ -f "$package" ] || { printf 'not a file: %s\n' "$package" >&2; exit 1; }

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

info=$(dpkg-deb --info "$package") || fail "dpkg-deb could not parse $package"
contents=$(dpkg-deb --contents "$package")

architecture=$(printf '%s\n' "$info" | awk -F': ' '/^ Architecture:/ {print $2}')
[ "$architecture" = "amd64" ] || fail "expected an amd64 package, found '${architecture:-none}'"

version=$(printf '%s\n' "$info" | awk -F': ' '/^ Version:/ {print $2}')
printf '%s\n' "$version" | grep -q 'stage0' || fail "expected a stage0 version, found '${version:-none}'"

depends=$(printf '%s\n' "$info" | awk -F': ' '/^ Depends:/ {print $2}')
for required in libwebkit2gtk-4.1-0 libgtk-3-0; do
  printf '%s\n' "$depends" | grep -q "$required" \
    || fail "expected '$required' among the declared dependencies: ${depends:-none}"
done

# The application must not ship a JavaScript runtime: the frontend is built
# ahead of time and embedded, so a packaged node binary would mean the bundle
# picked up the development toolchain.
if printf '%s\n' "$contents" | grep -qE '/(node|npm|pnpm)$'; then
  fail 'a Node runtime is packaged inside the .deb'
fi
if printf '%s\n' "$contents" | grep -q '/node_modules/'; then
  fail 'node_modules is packaged inside the .deb'
fi

# dpkg-deb prints paths with or without a leading "./" depending on version,
# and a bundled file name may contain spaces, so the path is everything from
# the sixth field onwards rather than the last field.
paths=$(printf '%s\n' "$contents" | awk 'NF > 5 { path = $6; for (i = 7; i <= NF; i++) path = path " " $i; print path }')

desktop_entry=$(printf '%s\n' "$paths" | grep -E '^\.?/?usr/share/applications/.+\.desktop$' | head -1)
[ -n "$desktop_entry" ] || fail 'no .desktop entry found in the package'

executable=$(printf '%s\n' "$paths" | grep -E '^\.?/?usr/bin/[^/]+$' | head -1)
[ -n "$executable" ] || fail 'no executable found under /usr/bin'

checksum_file="$package.sha256"
sha256sum "$package" >"$checksum_file"

printf 'PASS\n'
printf '  package      %s\n' "$package"
printf '  version      %s\n' "$version"
printf '  architecture %s\n' "$architecture"
printf '  depends      %s\n' "$depends"
printf '  executable   %s\n' "${executable#.}"
printf '  desktop      %s\n' "${desktop_entry#.}"
printf '  sha256       %s\n' "$(awk '{print $1}' "$checksum_file")"
printf '  checksum at  %s\n' "$checksum_file"
