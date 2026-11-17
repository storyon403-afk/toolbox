# Pangzhu for macOS

Download `pangzhu-0.2.2-darwin-arm64.zip` for Apple Silicon or
`pangzhu-0.2.2-darwin-amd64.zip` for Intel. Extract the entire folder into a writable
location such as `~/Applications/Pangzhu`. Keep the folder intact.

Double-click `Start-Pangzhu.command` for local reading and authoring. Double-click
`Start-Share.command` to create a temporary public review link using the bundled
cloudflared. The launcher opens the browser after readiness checks. Keep its
Terminal window open; press Ctrl+C to stop. Temporary links change each launch,
require the host to stay awake, and have no uptime guarantee.

This first release is a portable command launcher, not a signed/notarized `.app`
installer. macOS may block downloaded software. Review the source and checksum,
then use the system's Privacy & Security approval flow if you trust this release.
Do not disable Gatekeeper globally. No system service or login item is installed.

## Updates and storage

This Toolbox distribution disables the standalone online updater. Obtain newer
independent packages from https://github.com/storyon403-afk/toolbox/releases when
available. macOS is not part of the initial Windows x64 public release. Close RD,
back up `data/`, extract the new package to a new folder and copy data while both
versions are stopped. Toolbox-managed copies use Toolbox's update mechanism.

Publications and feedback stay in `data/` beside the original launcher. Updates
never copy, transmit or migrate this folder. Browser drafts remain browser-local.
To move installations, stop the app and copy the complete folder, including hidden
`.updates`, or copy `data` into a newly extracted package. Preserve the same browser
origin/port for browser-local drafts. Back up `data` only while the app is stopped.

To return to the original packaged executable, stop Pangzhu and move
`.updates/current.json` aside. This does not remove newer data; future releases
with schema changes must publish explicit rollback guidance. Automatic updates
will offer the latest version again unless started with `--updates off`.

## Document files and PDF

In the browser, open the ellipsis menu and the document panel to create documents,
open `.rd` files, switch local drafts, or download the current `.rd` file. Use
Cmd+S on macOS / Ctrl+S on Windows to save a file. Browser-local autosave is a
convenience; download `.rd` files before moving devices or clearing browser data.
Opening a file does not publish it. No file association is installed.

Choose Export PDF in the menu, then Save as PDF / Microsoft Print to PDF in the
system print dialog. Use A4 portrait and disable browser headers and footers.
The output contains the current document text, including unpublished edits, without
controls or feedback. The standalone HTML editor supports the same workflow.
