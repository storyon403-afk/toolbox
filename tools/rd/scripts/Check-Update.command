#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
./pangzhu --check-update
printf '\nPress Enter to close. '
read -r answer
