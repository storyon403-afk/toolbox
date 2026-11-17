# RD in Toolbox releases

RD is distributed from the [Toolbox repository](https://github.com/storyon403-afk/toolbox). It remains independently runnable. The initial public target is Windows 11 x64.

Build with the Go version in `go.mod` and run `python3 design/build.py`, then `python3 scripts/package_release.py --platform windows-amd64 --skip-source`. The packager includes pinned connector/runtime notices and checksums. `go test -race ./...` and `go vet ./...` provide local checks.

The packaged standalone updater is disabled. Toolbox-managed RD uses Toolbox's catalog; standalone users download a new ZIP manually. Close RD, back up `data/`, extract the new package into a new directory, and copy the data folder while both versions are stopped. Keep the same browser origin/port for browser-local drafts. Never delete the old package until the new version and data are verified.

The original single-tool updater requires a tag version equal to the RD version and is not used with mixed-tool Toolbox release tags. Do not configure it with the Toolbox repository without implementing that separate protocol. See [Toolbox release instructions](../../../docs/RELEASING.md).
