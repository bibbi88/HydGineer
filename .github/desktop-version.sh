#!/usr/bin/env bash
# The desktop app's version: yy.mmdd.<workflow run number>, e.g. 26.1115.12 - always higher than
# the build before, which is what installed apps compare when they check for an update. (Tagged
# releases use it too, so an update from one to the other is always recognised.)
month=$((10#$(date -u +%m)))
day=$((10#$(date -u +%d)))
echo "$(date -u +%y).$((month * 100 + day)).${GITHUB_RUN_NUMBER:-0}"
