#!/usr/bin/env python3
"""Compatibility entry point for the two Windows release packages."""
import sys
from package_release import main

if __name__ == '__main__':
    main(['--platform', 'windows-amd64', '--platform', 'windows-arm64', *sys.argv[1:]])
