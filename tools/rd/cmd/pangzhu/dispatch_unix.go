//go:build darwin || linux

package main

import (
	"os"
	"syscall"
)

func dispatch(target, root string) error {
	args := append([]string{target}, os.Args[1:]...)
	args = append(args, "--install-dir", root)
	return syscall.Exec(target, args, os.Environ())
}
