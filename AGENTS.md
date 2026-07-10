# Project Notes

- Release workflow create-release must download only the release package artifacts. Do not download all artifacts blindly, because Docker Buildx can upload a `.dockerbuild` artifact that is not part of the GitHub Release and can make `actions/download-artifact` fail.
- When updating release packaging, verify both `scripts/quick-pack.py` and `scripts/build-framework-plugin.py`; shell and framework packages have separate config-generation paths.
- **Never re-tag an existing version to update a Release.** GitHub caches Release artifacts by tag name; re-tagging does NOT trigger a new build or replace old artifacts — users will download the stale exe. Always bump to a new version (e.g. beta.6 → beta.7) so a fresh Release with fresh artifacts is created.
- Release workflow speed depends on Rust cache keys shared with the default-branch `build-plugin.yml` run. Keep `release-plugin.yml` and `build-plugin.yml` aligned on the `qce-server-{platform}-{arch}` shared cache keys; tag-created caches alone do not warm the next tag release.
