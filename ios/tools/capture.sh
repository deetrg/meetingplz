#!/bin/bash
# usage: capture.sh <device-name-regex> <outdir> ; boots first matching available iPhone simulator, installs the app, captures App Store screens in demo mode.
set -euo pipefail
PATTERN="$1"; OUT="$2"; APP="$3"
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json,sys,re
d=json.load(sys.stdin)['devices']
rt=sorted([k for k in d if 'iOS' in k])
c=[x for k in rt for x in d[k] if re.search(sys.argv[1], x['name'])]
print(c[-1]['udid'] if c else '')" "$PATTERN")
if [ -z "$UDID" ]; then echo "no simulator for $PATTERN"; exit 3; fi
echo "Using $UDID for $PATTERN"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl ui "$UDID" appearance light
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 || true
xcrun simctl install "$UDID" "$APP"
mkdir -p "$OUT"
shot() { # name wait args...
  name=$1; wait=$2; shift 2
  xcrun simctl terminate "$UDID" com.dai.meetingplz 2>/dev/null || true
  xcrun simctl launch "$UDID" com.dai.meetingplz -mpDemo -mpClean "$@"
  sleep "$wait"
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png"
}
shot 3-reminder-fullscreen 4 -mpReminder -mpTakeover
shot 2-reminder-flyby 6.5 -mpReminder
shot 1-home 4
shot 4-settings 4 -mpSettings
xcrun simctl ui "$UDID" appearance dark
shot 5-home-dark 4
xcrun simctl shutdown "$UDID" || true
for f in "$OUT"/*.png; do sips -g pixelWidth -g pixelHeight "$f" | tr '\n' ' '; echo "$f"; done
