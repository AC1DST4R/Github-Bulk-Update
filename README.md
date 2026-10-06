# GitHub Bulk Updater

Firefox extension for updating the same file across multiple GitHub repositories.

## Features

- GitHub REST API integration
- Load repositories accessible to your account
- Search/filter repositories
- Select multiple repositories
- Manually enter `owner/repository` names
- Create or update a file in every selected repository
- Optional branch selection
- Custom commit message
- Skips repositories whose file already has identical contents
- Per-repository success/skip/error results
- Token stored in Firefox extension storage

## Install in Firefox

1. Save/extract this folder.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**
4. Select `manifest.json`.
5. Click the extension icon.

For a permanent install, the extension needs to be signed by Mozilla or installed through an appropriate Firefox distribution mechanism.

## GitHub token

Create a fine-grained GitHub personal access token and grant the repositories you intend to modify **Contents: Read and write**.

The GitHub Contents API requires write access for creating/updating files. Files under `.github/workflows/` additionally require the appropriate workflow permission.

The extension sends the token directly from Firefox to `api.github.com`; it does not use a third-party backend.

## Important

A bulk update can create many commits. Review the repository selection, branch, file path, content, and commit message before pressing **Update selected repositories**.

Do not paste a token into source files or publish it with the extension.
