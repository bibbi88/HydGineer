#!/usr/bin/env bash
# The desktop app's version: the tag's (v1.2.3 -> 1.2.3) for a versioned release, otherwise the
# build date (yy.m.d), as the web app's own version is - e.g. 26.11.14.
if [[ "${GITHUB_REF:-}" == refs/tags/v* ]]; then
  echo "${GITHUB_REF#refs/tags/v}"
else
  date -u +%y.%-m.%-d
fi
