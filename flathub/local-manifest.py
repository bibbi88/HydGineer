"""Writes a copy of the Flathub manifest that builds from this checkout instead of a release: the
Linux build just made (desktop/release/HydGineer-linux-x64.tar.gz) and this repository's own
flathub/ and desktop/build/ files - for checking the Flatpak before tagging a release.

    python3 flathub/local-manifest.py OUT_DIR
"""
import shutil
import sys
from pathlib import Path

import yaml

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)

# The files the manifest installs from the tag, staged without the rest of the repository.
src = out / "src"
shutil.rmtree(src, ignore_errors=True)
shutil.copytree(root / "flathub", src / "flathub")
shutil.copytree(root / "desktop" / "build", src / "desktop" / "build")
shutil.copy(root / "desktop" / "release" / "HydGineer-linux-x64.tar.gz", out / "app.tar.gz")

manifest = yaml.safe_load((root / "flathub" / "io.github.bibbi88.HydGineer.yml").read_text())
module = manifest["modules"][0]
module["sources"] = [
    {"type": "archive", "path": "app.tar.gz", "dest": "hydgineer"},
    {"type": "dir", "path": "src", "dest": "src"},
]
(out / "io.github.bibbi88.HydGineer.yml").write_text(yaml.safe_dump(manifest, sort_keys=False))
print(out / "io.github.bibbi88.HydGineer.yml")
