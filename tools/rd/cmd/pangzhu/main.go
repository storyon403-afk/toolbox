package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"pangzhu"
	"pangzhu/internal/service"
	"pangzhu/internal/share"
	"pangzhu/internal/update"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	host := flag.String("host", "127.0.0.1", "Listen address; use 0.0.0.0 for trusted LAN access")
	port := flag.Int("port", 8765, "HTTP port")
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	data := flag.String("data-dir", "", "Persistent data directory (default: data beside the original launcher)")
	installRoot := flag.String("install-dir", filepath.Dir(exe), "Original portable installation directory")
	showVersion := flag.Bool("version", false, "Print installed version and official update source")
	showExecutable := flag.Bool("executable-path", false, "Print the selected executable path for local administration")
	updateMode := flag.String("updates", "auto", "Daily updates: auto, check, or off")
	checkUpdate := flag.Bool("check-update", false, "Check GitHub now, without downloading")
	installUpdate := flag.Bool("update", false, "Download and verify the latest release for the next launch")
	publicURL := flag.String("public-url", "", "Review origin, e.g. https://review.example.com")
	quick := flag.Bool("quick-share", false, "Start bundled cloudflared and create a temporary public review URL")
	open := flag.Bool("open", false, "Open the local author page when ready")
	flag.Parse()
	if flag.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *updateMode != "auto" && *updateMode != "check" && *updateMode != "off" {
		return errors.New("updates must be auto, check, or off")
	}
	*installRoot, err = filepath.Abs(*installRoot)
	if err != nil {
		return err
	}
	if update.Repository == "" {
		*updateMode = "off"
	}
	updater := update.New(*installRoot, runtime.GOOS, runtime.GOARCH, update.Version)
	if update.Version != "dev" {
		target, err := updater.Target()
		if err != nil {
			return fmt.Errorf("staged update is invalid; move .updates/current.json aside to use the original release: %w", err)
		}
		if target != "" {
			return dispatch(target, *installRoot)
		}
	}
	if *showVersion {
		fmt.Printf("Pangzhu %s (%s/%s)\n", update.Version, runtime.GOOS, runtime.GOARCH)
		if update.Repository == "" {
			fmt.Println("Updates disabled: release repository is not configured")
		} else {
			fmt.Printf("Official releases: https://github.com/%s/releases\n", update.Repository)
		}
		return nil
	}
	if *showExecutable {
		fmt.Println(exe)
		return nil
	}
	if *data == "" {
		*data = filepath.Join(*installRoot, "data")
	}
	if *checkUpdate || *installUpdate {
		unlock, err := updater.Lock()
		if err != nil {
			return err
		}
		defer unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
		defer cancel()
		message, err := updater.Check(ctx, *installUpdate, true)
		if message != "" {
			fmt.Println(message)
		}
		return err
	}
	if *port < 0 || *port > 65535 {
		return errors.New("port must be between 0 and 65535 (0 selects an available port)")
	}
	if *quick && (*host != "127.0.0.1" || *publicURL != "") {
		return errors.New("quick-share requires loopback and cannot be combined with public-url")
	}
	if *publicURL != "" {
		u, err := url.Parse(*publicURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return errors.New("public-url must be an HTTP(S) origin without credentials, path, query or fragment")
		}
		*publicURL = strings.TrimRight(*publicURL, "/")
	}
	// Bind first so a second launch cannot expose or overwrite the running instance.
	listener, err := net.Listen("tcp", net.JoinHostPort(*host, strconv.Itoa(*port)))
	if err != nil {
		return fmt.Errorf("port %d is unavailable; stop the previous Pangzhu window before starting: %w", *port, err)
	}
	defer listener.Close()
	if update.Version != "dev" {
		unlock, err := updater.Lock()
		if err != nil {
			return err
		}
		defer unlock()
	}
	s, err := service.Open(*data, pangzhu.Assets, *publicURL)
	if err != nil {
		return err
	}
	defer s.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if update.Version != "dev" && *updateMode != "off" {
		updateDone := make(chan struct{})
		go func() {
			defer close(updateDone)
			updater.Run(ctx, *updateMode == "auto", func(message string) { log.Print(message) })
		}()
		defer func() { stop(); <-updateDone }()
	}
	server := &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, WriteTimeout: 30 * time.Second, MaxHeaderBytes: 16384, BaseContext: func(net.Listener) context.Context { return ctx }}
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.Serve(listener) }()
	defer func() {
		stop()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	*port = listener.Addr().(*net.TCPAddr).Port
	local := fmt.Sprintf("http://127.0.0.1:%d", *port)
	if token := os.Getenv("TOOLBOX_READY_TOKEN"); token != "" {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"toolboxReady": token, "origin": local, "instance": s.InstanceID()})
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	}
	fmt.Printf("Pangzhu %s — author: %s/\nData: %s\nUpdates: %s (GitHub %s, every 24 hours while running)\n", update.Version, local, *data, *updateMode, update.Repository)
	if *publicURL != "" {
		fmt.Printf("Review: %s/review\n", *publicURL)
	}
	if *host == "0.0.0.0" {
		addresses, _ := net.InterfaceAddrs()
		for _, address := range addresses {
			if ip, ok := address.(*net.IPNet); ok && !ip.IP.IsLoopback() && ip.IP.To4() != nil {
				fmt.Printf("LAN review: http://%s:%d/review\n", ip.IP, *port)
			}
		}
	}
	var shareDone chan error
	if *quick {
		name := "cloudflared"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		binary := filepath.Join(filepath.Dir(exe), name)
		if _, err = os.Stat(binary); err != nil {
			return fmt.Errorf("bundled %s is missing; extract the entire new package", name)
		}
		config, err := os.CreateTemp("", "pangzhu-tunnel-*.yml")
		if err != nil {
			return err
		}
		configPath := config.Name()
		defer os.Remove(configPath)
		_, writeErr := config.WriteString("{}\n")
		closeErr := config.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return closeErr
		}
		logFile, err := os.OpenFile(filepath.Join(*data, "share.log"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer logFile.Close()
		fmt.Println("Starting temporary public sharing. No account or domain is required.")
		fmt.Println("Checking the public connection (up to 90 seconds)...")
		shareDone = make(chan error, 1)
		go func() {
			shareDone <- share.Run(ctx, share.Config{Binary: binary, Origin: local, ConfigFile: configPath, Log: logFile,
				Verify: func(c context.Context, origin string) error { return share.VerifyHealth(c, origin, s.InstanceID()) },
				OnReady: func(origin string) {
					s.SetPublicURL(origin)
					fmt.Printf("\nREADY - Share this review URL:\n%s/review\n\n", origin)
					fmt.Println("The link changes each launch. Keep this window open; Ctrl+C stops sharing.")
					if *open {
						if err := openBrowser(local + "/?share=1"); err != nil {
							fmt.Printf("Open %s/?share=1 in your browser: %v\n", local, err)
						}
					}
				},
			})
		}()
	} else if *open {
		if err := openBrowser(local + "/"); err != nil {
			fmt.Printf("Open the author URL in your browser: %v\n", err)
		}
	}
	select {
	case <-ctx.Done():
		if shareDone != nil {
			<-shareDone
		}
		return nil
	case err := <-shareDone:
		s.SetPublicURL("")
		return err
	case err := <-serverDone:
		stop()
		if shareDone != nil {
			<-shareDone
		}
		if err != http.ErrServerClosed {
			return err
		}
		return nil
	}
}
func openBrowser(target string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", target)
	case "darwin":
		command = exec.Command("open", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	if err := command.Start(); err != nil {
		return err
	}
	go func() { _ = command.Wait() }()
	return nil
}
