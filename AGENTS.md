# Project Notes

- Release workflow create-release must download only the release package artifacts. Do not download all artifacts blindly, because Docker Buildx can upload a `.dockerbuild` artifact that is not part of the GitHub Release and can make `actions/download-artifact` fail.
- When updating release packaging, verify both `scripts/quick-pack.py` and `scripts/build-framework-plugin.py`; shell and framework packages have separate config-generation paths.
