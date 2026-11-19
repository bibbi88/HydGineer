#!/bin/sh
# Starts HydGineer inside the Flatpak sandbox: Electron's own sandbox through zypak, temporary
# files where the sandbox allows, and file dialogs through the desktop's portal (so the app needs
# no access to the home folder - only to the files picked or opened).
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
exec zypak-wrapper /app/hydgineer/hydgineer "$@"
