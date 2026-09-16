#!/bin/sh
# Builds the app's icon, on the Mac, from one of the platform's own PNGs.
#
#   ./make-icon.sh [path-to-a-square-png]
#
# Run it from this folder. Both tools it uses — sips and iconutil — ship with
# macOS, so there is nothing to install. Without an icon the app still runs; it
# just wears the generic one.

set -e

APP="NEON Studio.app"
SOURCE="$1"

# Nothing named: take the largest of the platform's own icons that is here.
if [ -z "$SOURCE" ]; then
	for candidate in \
		"../public/admin-icon-512.png" \
		"../public/icon-512.png" \
		"../public/admin-icon-192.png" \
		"../public/icon-192.png"
	do
		if [ -f "$candidate" ]; then SOURCE="$candidate"; break; fi
	done
fi

if [ -z "$SOURCE" ] || [ ! -f "$SOURCE" ]; then
	echo "No source picture found. Pass one: ./make-icon.sh /path/to/icon.png"
	exit 1
fi

echo "Building the icon from $SOURCE"
WORK="$(mktemp -d)/neon.iconset"
mkdir -p "$WORK"

# The sizes macOS asks for. A 512px source is upscaled for the two largest,
# which is why a bigger original is better if you have one.
for size in 16 32 128 256 512; do
	sips -z $size $size "$SOURCE" --out "$WORK/icon_${size}x${size}.png" >/dev/null
	double=$((size * 2))
	sips -z $double $double "$SOURCE" --out "$WORK/icon_${size}x${size}@2x.png" >/dev/null
done

mkdir -p "$APP/Contents/Resources"
iconutil -c icns "$WORK" -o "$APP/Contents/Resources/neon.icns"
rm -rf "$WORK"

echo "Done: $APP/Contents/Resources/neon.icns"
echo "If the old icon sticks in the Dock, log out and back in — macOS caches them."
