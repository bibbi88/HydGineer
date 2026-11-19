# HydGineer on Flathub

This folder holds everything Flathub needs to publish HydGineer as
`io.github.bibbi88.HydGineer`:

| File                                       | What it is                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `io.github.bibbi88.HydGineer.yml`          | The manifest: how Flathub builds the app. It goes to Flathub.                   |
| `io.github.bibbi88.HydGineer.metainfo.xml` | Name, description, screenshots, licence, releases - what software centres show. |
| `io.github.bibbi88.HydGineer.desktop`      | The app menu entry; opens `.hgcl` files.                                        |
| `io.github.bibbi88.HydGineer.mime.xml`     | The `.hgcl` file type.                                                          |
| `hydgineer.sh`                             | Starts the app inside the sandbox.                                              |
| `local-manifest.py`                        | Makes a copy of the manifest that builds from a checkout (for the check below). |

The manifest packages the Linux build of a **tagged release** (`HydGineer-linux-x64.tar.gz`,
built by `.github/workflows/desktop.yml`) on Flathub's Electron base, and takes the files above
and the icons from the same tag. The app gets no access to the home folder: file dialogs go
through the desktop's portal, which gives it the files picked or opened, and nothing else. It
doesn't update itself - Flathub does that.

## Checking it

`.github/workflows/flathub.yml` builds the Flatpak exactly as Flathub would - offline, with
Flathub's own builder - and runs Flathub's linter on the manifest, the metadata and the built
app. It runs on every push to `dev` touching `desktop/` or `flathub/`, and by hand from the
Actions tab. Its artifact `HydGineer-flathub-test.flatpak` can be installed to try it out:

```sh
flatpak install --user HydGineer-flathub-test.flatpak
flatpak run io.github.bibbi88.HydGineer
```

## Releasing a version

Versions are `MAJOR.MINOR.BUILD`. Releases are tags that raise MINOR or MAJOR: `v0.9.0` first,
then `v0.10.0` or `v1.0.0`... Builds from `main` in between keep the newest tag's MAJOR.MINOR and
take the build number as the third part (`0.9.37`), so installed apps still update to each of them
(`.github/desktop-version.sh`).

1. Pick the version: the newest tag with MINOR (or MAJOR) raised, e.g. `0.10.0`.
2. Add a `<release version="0.10.0" date="…">` entry at the top of `<releases>` in the metainfo
   file (with the tag's date), merge to `main`.
3. Tag it: `git tag v0.10.0 && git push origin v0.10.0`. The workflow makes a release of
   its own with `HydGineer-linux-x64.tar.gz` (the desktop app takes the tag's version).
4. In the manifest, set the archive's `url` to that release's file and its `sha256`
   (`sha256sum HydGineer-linux-x64.tar.gz`), and the git source's `tag` to the new tag.

## Submitting to Flathub (the first time)

This has to be done from the GitHub account that owns the app ID (`io.github.bibbi88`).

1. Make a release as above (steps 1-4), so the manifest points at a real file.
2. Fork <https://github.com/flathub/flathub> **with all branches** and create a branch from
   `new-pr`.
3. Add `io.github.bibbi88.HydGineer.yml` (this folder's manifest) at the top of that branch.
4. Open a pull request against `new-pr`, titled `Add io.github.bibbi88.HydGineer`. Comment
   `bot, build` on it to get a test build.
5. Answer the reviewers. Once it's merged, Flathub creates
   `github.com/flathub/io.github.bibbi88.HydGineer`, and you get write access to it.

After that, each new tagged release is picked up by Flathub's checker (the manifest's
`x-checker-data`), which opens a pull request on that repository with the new url and sha256 -
merge it, and Flathub publishes the update.

Flathub's own guide: <https://docs.flathub.org/docs/for-app-authors/submission>.
