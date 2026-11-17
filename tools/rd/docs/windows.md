# Windows setup and operation

## One-click public sharing (recommended for immediate use)

1. Stop the previous Pangzhu window to release port 8765. Extract the complete new
   `pangzhu-0.2.2-windows-amd64.zip` for Intel/AMD Windows into a writable folder. Keep
   `pangzhu.exe` and `cloudflared.exe` together; do not run from inside the ZIP.
2. If upgrading in place, replace the program files and keep the existing `data`
   folder. If extracting into a new folder, stop the old app and copy its entire
   `data` folder into the new one before launch. Do not copy old executables over
   the new package. Local browser drafts remain tied to the browser and origin.
3. Double-click **Start-Share.cmd**. No account, domain, TOKEN, administrator prompt,
   firewall rule, PowerShell installation or separate download is needed.
4. Allow up to 90 seconds for Cloudflare and the public health check. Only after the
   generated HTTPS address reaches this exact running instance will the launcher
   print `READY` and open the local author page with its share dialog.
5. Copy the displayed URL ending in `/review` and send it to reviewers. Keep the
   terminal and computer awake and online. Ctrl+C stops the app and its connector.
   The launcher does not install or alter any Windows service.

The public hostname is temporary and changes each time. Cloudflare Quick Tunnels
have no uptime guarantee and a limit of 200 in-flight requests. Pangzhu polls every
three seconds in this mode instead of opening unsupported SSE streams. A fixed URL
requires the named-tunnel setup below. [Cloudflare Quick Tunnel limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

If startup fails, the terminal stays open with the error; inspect `data/share.log`.
The launcher reaps its connector and does not show an unverified URL as ready.
Restart after correcting the network problem. Existing named-tunnel configuration
and token environment variables are excluded from the quick-share child process.
The package contains the pinned, checksum-verified official cloudflared release;
see `licenses/cloudflared-release.json` and the accompanying license and notice.

The ARM64 package runs Pangzhu natively but bundles the same amd64 cloudflared
because the upstream release has no Windows ARM64 connector. Quick sharing in that
package requires Windows 11 x64 emulation. The Intel/AMD package is the primary
one-click deliverable. Native Windows acceptance testing remains necessary.

## Package and local network

1. Use 64-bit Windows 10/11 or a supported Windows Server. Extract the amd64 package
   for Intel/AMD, or arm64 for Windows on ARM, into a writable folder such as
   `C:\Pangzhu`. Do not run inside the ZIP. The build is unsigned. The OS baseline
   follows [Go platform requirements](https://go.dev/wiki/MinimumRequirements).
2. Double-click `Start-LAN.cmd`. It starts the app, waits for readiness, opens the
   author URL and prints review URLs. The browser's Share action uses the detected
   LAN address. If multiple adapters exist, select the reachable address manually:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Pangzhu.ps1 -Mode LAN -PublicUrl http://192.168.1.50:8765
   ```

3. Allow the executable on trusted **Private** networks when Windows asks. If a
   firewall rule is needed, open PowerShell as Administrator in the extracted folder:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Enable-LAN.ps1
   ```

   The helper permits only TCP 8765 for this executable on the Private profile and
   local subnet. It does not open the router or enable the Public profile. Review
   any broader rule Windows may have created separately. Undo the helper rule with
   `Remove-NetFirewallRule -Name Pangzhu-Private-LAN-8765`.
4. The author uses `http://127.0.0.1:8765/` on the server computer. Other devices on
   the same reachable LAN use `http://SERVER-LAN-IP:8765/review`. A localhost URL
   cannot reach another computer. Guest Wi-Fi/client isolation can block LAN peers.
5. Keep the terminal and computer running. Ctrl+C stops the launched server. Data
   persists in the `data` folder. Reserve the host's IP in DHCP for a stable LAN URL.

For custom ports, pass the same `-Port` to both PowerShell scripts. To run without
launch scripts, use `pangzhu.exe --host 0.0.0.0 --port 8765 --data-dir .\data`.
Do not use plain LAN HTTP across untrusted networks or forward this port to the
Internet. Everyone who can reach the review endpoint can read and submit feedback.

## Stable Internet URL with Cloudflare

Use a **named tunnel** and a hostname in a Cloudflare-managed domain when you need
a stable address. This mode uses SSE with polling fallback. The one-click temporary
mode above uses polling because Quick Tunnels do not support SSE.
No inbound router port is needed. Cloudflare is an additional network dependency;
the Windows host and application must stay awake and available.

1. Install cloudflared from the official Cloudflare distribution. Create a named
   tunnel through Cloudflare's dashboard and follow its Windows connector setup.
   Map a public hostname, for example `review.example.com`, to
   `http://127.0.0.1:8765`. Keep the original hostname and forwarding headers; do not
   override the origin Host to disguise remote requests as local author traffic.
2. Add a Cloudflare Access policy if only invited reviewers should reach the app.
   Configure the entire hostname, including `/review/api/events`, consistently.
3. Run `Start-Tunnel.cmd` and enter `https://review.example.com`. This binds Pangzhu
   to loopback only and makes the Share action return the public review URL. For
   unattended foreground startup, pass `-PublicUrl` directly to the PowerShell
   launcher. Local authoring still uses `http://127.0.0.1:8765/`.
4. Run cloudflared using the dashboard-provided connector command. For ongoing
   availability, install cloudflared as a Windows service using the official guide.
   Installing the tunnel service does not start Pangzhu itself. Configure Windows
   Task Scheduler to run the executable at sign-in if desired; use an absolute
   `--data-dir` and avoid running a second instance via the launcher.
5. Test the HTTPS `/review` page on a phone using mobile data. Open two review
   sessions and verify that a confirmed suggestion appears in the other without a
   reload. Confirm that the remote page has no author controls and cannot publish.

For locally managed tunnels, `cloudflared.example.yml` is a template. Replace its
placeholders, store it outside shared source control, and run:

```powershell
cloudflared tunnel --config C:\Pangzhu\cloudflared.yml run YOUR-TUNNEL-UUID
```

Tunnel accounts, DNS, credentials and service installation are environment-specific;
the release does not contain credentials or create external infrastructure.

Official references:
[Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
[named Tunnel setup](https://developers.cloudflare.com/tunnel/),
[Windows service setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/).

## Data, upgrades and migration

The executable defaults to `data` beside itself; the launch scripts use that same
folder. `pangzhu.sqlite3` stores versions and feedback. `owner.key` is the local
author-session secret. SQLite may also create `-wal` and `-shm` files. Browser-local
drafts, unconfirmed suggestions and appearance preferences are separate.

Stop the application before copying the **entire data folder** for backup or moving
it. Never copy only the database while the app is writing. Restore with the server
stopped. Keep backups and keys private. Replace the executable during upgrades,
retaining the data folder. Do not run two implementations against one data directory.

To migrate the existing Python prototype, stop its server, back up `design/.data/`,
then copy that whole directory's contents into the package's `data/`. The Go service
reads the existing schema and adds the reviewer identifier column if absent. Copy
`owner.key` too. Browser drafts only remain available at the same browser origin;
export them before changing hosts or ports. The compatibility entry point in the
source tree requires Go and is not required by Windows release users.

## Troubleshooting and acceptance

- Port busy: close the existing instance or choose a free port. The launcher refuses
  an occupied port and does not silently open another service.
- LAN unreachable: check the network profile, firewall rule, IP address and Wi-Fi
  isolation; use the printed LAN address, not `127.0.0.1`.
- Tunnel unavailable: check cloudflared's service status, hostname mapping and that
  `http://127.0.0.1:8765/review` works locally.
- No live updates: Quick Tunnel mode uses `/review/api/state` polling every three
  seconds. Named tunnels normally use `/review/api/events`, with polling fallback.
  Check that the relevant API requests are not blocked by proxy or Access rules.
- Invalid nameservers: the custom domain is not yet correctly delegated to
  Cloudflare. Fix the nameservers at the domain registrar for a fixed address, or
  use `Start-Share.cmd` to get a temporary URL without configuring that domain.
- Read-only locally: use the direct author URL on the host; proxied authoring is
  intentionally denied. Do not use `/review` to publish.

Before production use, verify startup, a real LAN peer, restart persistence, failed
submission retry, author denial over the tunnel, firewall scope, Ctrl+C cleanup and
sleep/restart recovery on the target Windows machine. The validation record states
which checks were performed during development.

## Version 0.2.2 and official updates

The versioned files are `pangzhu-0.2.2-windows-amd64.zip` and
`pangzhu-0.2.2-windows-arm64.zip`. `Start-Local.cmd` opens local authoring without
creating a public tunnel; `Start-Share.cmd` starts temporary public sharing.
Extract into a user-writable folder rather than Program Files.

This Toolbox distribution disables RD's independent online updater. Download new
standalone ZIPs from https://github.com/storyon403-afk/toolbox/releases. Close RD,
back up `data`, extract the new package into a new folder, then copy `data` while
both versions are stopped. Keep the same browser origin/port for browser-local
drafts. Verify the new version before removing the old package. Toolbox-managed
copies use Toolbox's catalog and managed data directory instead.
