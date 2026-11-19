#!/usr/bin/env bash
# The desktop app's version. A version tag (v26.1201.0) gives its own number - what Flathub and
# a versioned release go by. Every other build is yy.mmdd.<workflow run number>, e.g. 26.1115.12,
# always higher than the build before, which is what installed apps compare when they check for
# an update. Tag in the same yy.mmdd scheme, so the two orders agree.
if [[ "${GITHUB_REF_TYPE:-}" == "tag" && "${GITHUB_REF_NAME:-}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "${BASH_REMATCH[1]}"
  exit 0
fi
month=$((10#$(date -u +%m)))
day=$((10#$(date -u +%d)))
echo "$(date -u +%y).$((month * 100 + day)).${GITHUB_RUN_NUMBER:-0}"
