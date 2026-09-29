#!/bin/zsh
# Screenshots one screen of a Debug build, straight from launch (App/DebugScreens.swift).
#
#   NEON_TOKEN_FILE=<file holding a manager token> \
#     tools/screenshot.sh <simulator udid> <NeonAdmin.app> <screen id> <out.png> [seconds to wait]
#
# The token is read from a file outside the repository and handed to the app
# through its launch environment only; the app keeps it in memory and, in
# this mode, sends nothing that changes anything (APIClient.send refuses
# every non-GET). `<screen id>` = list prints every id to the console.
set -e
device=$1 app=$2 screen=$3 out=$4 wait=${5:-6}
[[ -n $NEON_TOKEN_FILE && -r $NEON_TOKEN_FILE ]] || { echo "NEON_TOKEN_FILE must name a readable token file" >&2; exit 2; }
state=$(xcrun simctl list devices | grep "$device" | grep -o "(Booted)\|(Shutdown)" || true)
if [[ $state != "(Booted)" ]]; then
  xcrun simctl boot "$device" 2>/dev/null || true
  xcrun simctl bootstatus "$device" -b >/dev/null
fi
xcrun simctl ui "$device" appearance light >/dev/null 2>&1 || true
xcrun simctl status_bar "$device" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 >/dev/null 2>&1 || true
xcrun simctl install "$device" "$app"
SIMCTL_CHILD_NEON_DEBUG_TOKEN=$(<"$NEON_TOKEN_FILE") xcrun simctl launch --terminate-running-process "$device" com.neonjo.staff -neonScreen "$screen" >/dev/null
sleep "$wait"
xcrun simctl io "$device" screenshot "$out" >/dev/null 2>&1
xcrun simctl terminate "$device" com.neonjo.staff >/dev/null 2>&1 || true
echo "$out"
