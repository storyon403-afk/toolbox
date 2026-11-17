package main

import (
	"os"
	"os/exec"
	"os/signal"
	"time"
)

func dispatch(target, root string) error {
	args := append([]string{}, os.Args[1:]...)
	args = append(args, "--install-dir", root)
	command := exec.Command(target, args...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	// Both processes share the console and receive its Ctrl+C event. Keep the
	// bootstrap alive until the child has reaped its connector and closed SQLite.
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	defer signal.Stop(interrupt)
	if err := command.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		return err
	case <-interrupt:
		select {
		case err := <-done:
			return err
		case <-time.After(15 * time.Second):
			_ = command.Process.Kill()
			return <-done
		}
	}
}
