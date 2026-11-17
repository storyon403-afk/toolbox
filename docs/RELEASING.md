# Prepare a release

Releases are manual. These commands never create a repository, push Git commits, upload files or enable CI. First create the intended public GitHub repository and choose its actual `OWNER/REPO`.

```sh
npm run release:configure -- OWNER/REPO
node scripts/package-desktop.mjs win32-x64
```

Configuration is compiled into Toolbox. Rebuild after changing it. `catalog/remote.json` with `repository: null` deliberately disables the network catalog. Do not ship an example repository URL.

Place the rebuilt Toolbox ZIP and the four tested independent tool ZIPs named in `release/windows-x64.json` in a new input directory. Retest the exact Toolbox package on Windows, and the four exact tool archives after any tool changes. Then prepare a fresh output directory:

```sh
npm run release:prepare -- v0.1.1 2 dist/release-input dist/public-release
```

The second argument is an increasing catalog revision. The script verifies archive extraction and launch paths, checks the repository compiled into Toolbox, and creates five ZIPs, `catalog.json`, `SHA256SUMS`, `release.json` and a README. Preparation is not runtime or public-network acceptance. Review all files before publication. Publish all assets together in a stable release, then make it latest. Never replace assets for a published version; bump affected tool versions, use a new tag and increase the catalog revision. Each latest release must include `catalog.json` even when only one tool changes. An optional fifth argument supplies the previous accepted catalog: unchanged tool versions, hashes and launch descriptors retain their original asset URLs, so a Toolbox-only fix does not require uploading the tool binaries again.

After publication, verify actual GitHub catalog delivery and every enabled package:

```sh
npm run release:verify
```

The command downloads to a temporary directory, checks hashes, extracts each package, verifies launch paths and writes `test-results/public-release.json`. It does not execute tools. On Windows 11 x64, also use a disposable Toolbox profile to check install → launch → close → uninstall/reinstall and retained data. A subsequent real version is required to accept the public update path; controlled local fixtures alone do not establish that. Validate a clean Windows 11 machine, including WebView2 installation, before claiming clean-machine support.

On Windows, `node scripts/verify-public-desktop.mjs PATH/TO/Toolbox.exe` exercises public installation, launch, restart, retained-data reinstall and upgrades from a controlled older local record. It never uses normal user profiles.

## Trust and updates

The repository embedded in the application is the trust root over GitHub HTTPS. The client requests that repository's stable latest release through the [GitHub release API](https://docs.github.com/en/rest/releases/releases), checks the [asset SHA-256 digest](https://docs.github.com/en/rest/releases/assets), then accepts package URLs only from that same repository with explicit release tags. Redirects are limited to GitHub's release asset CDN. Requests have size/time limits. The desktop uses Electron’s system network stack for catalog and package requests, including system proxy configuration. Accepted metadata is cached atomically; older revisions, changed bytes at the same revision and changed binaries or launch commands at the same tool version are rejected. This is repository-account trust, not developer code signing or independent cryptographic signing. Protect the publishing account accordingly.

Tools installed through Toolbox use its update mechanism. Standalone ZIPs and Toolbox itself use manual replacement. RD's upstream updater stays disabled because its original single-tool tag protocol is incompatible with mixed Toolbox release tags. No release URL points at the old RD repository.

## Public source

`.gitignore` excludes local workflow, agent instructions, reports, host configuration and generated output while retaining runtime source, build scripts, tests and usage guides. To prepare a clean source tree without old Git history:

```sh
npm run source:export -- dist/public-source
```

The exporter uses Git's ignore rules, rejects symlinks and copies no `.git` history. Initialize the new public repository from that directory. The existing local repository contains historical workflow documents; removing files from the index does not remove those older commits. Do not push its old history if those documents must stay private.
