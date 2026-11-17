package update

import (
	"fmt"
	"os"
	"path/filepath"
)

func (m *Manager) Lock() (func(), error) {
	if err := os.MkdirAll(m.folder(), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(m.folder(), "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lockFile(f); err != nil {
		f.Close()
		return nil, fmt.Errorf("another Pangzhu process is using this installation; close it before updating: %w", err)
	}
	return func() { unlockFile(f); _ = f.Close() }, nil
}
