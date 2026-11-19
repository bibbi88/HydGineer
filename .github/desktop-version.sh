#!/usr/bin/env bash
# The desktop app's version, MAJOR.MINOR.BUILD:
#
# - a version tag (v0.9.0, v1.0.0...) gives its own number - what a release and Flathub go by;
# - every other build keeps the newest tag's MAJOR.MINOR and takes the workflow run number as
#   BUILD (0.9.37...), so each is higher than the build before - which is what installed apps
#   compare when they look for an update. The next release then raises MINOR or MAJOR.
#
# With no tag yet, builds are 0.9.<run>. Needs the tags in the checkout (fetch-depth: 0).
if [[ "${GITHUB_REF_TYPE:-}" == "tag" && "${GITHUB_REF_NAME:-}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "${BASH_REMATCH[1]}"
  exit 0
fi
latest=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname 2>/dev/null | head -n 1)
if [[ "$latest" =~ ^v([0-9]+)\.([0-9]+)\. ]]; then
  echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${GITHUB_RUN_NUMBER:-0}"
else
  echo "0.9.${GITHUB_RUN_NUMBER:-0}"
fi
