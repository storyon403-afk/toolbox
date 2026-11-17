#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
./pangzhu --update
printf '\nPress Enter to close. '
read -r answer
