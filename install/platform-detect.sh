#!/usr/bin/env bash
# install/platform-detect.sh — detect mac/linux/wsl
#
# Usage:
#   PLATFORM=$(bash install/platform-detect.sh)   # invokable — echoes result
#   source install/platform-detect.sh              # sourceable — sets $PLATFORM in caller
#
# Outputs one of: mac | linux | wsl
# Exits 1 on unsupported platform with message to stderr.

case "$(uname -s)" in
  Darwin)
    PLATFORM=mac
    ;;
  Linux)
    # Distinguish WSL2 from native Linux via /proc/version
    if grep -qi microsoft /proc/version 2>/dev/null; then
      PLATFORM=wsl
    else
      PLATFORM=linux
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Windows POSIX-compatibility layers (Git Bash, MSYS2, Cygwin)
    PLATFORM=wsl
    ;;
  *)
    printf "Unsupported platform: %s\n" "$(uname -s)" >&2
    exit 1
    ;;
esac

# When invoked (not sourced): echo result and exit
# When sourced: caller inherits $PLATFORM variable
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "$PLATFORM"
fi
