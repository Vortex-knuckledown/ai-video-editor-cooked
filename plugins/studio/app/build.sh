#!/bin/bash
# build.sh: make cooked.app and cooked-<version>.dmg in dist/ (not committed). Needs Apple's command line tools (swiftc).
#
#   bash plugins/studio/app/build.sh            build dist/cooked.app and dist/cooked-<version>.dmg
#   bash plugins/studio/app/build.sh --install  also copy the app to /Applications
#
# The app carries its own copy of the three plugins, so it runs without this folder. It is signed ad hoc, not with an
# Apple Developer ID: on another Mac, the first open is right-click > Open (or System Settings > Privacy & Security >
# Open Anyway).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
VER="$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$REPO/plugins/studio/.claude-plugin/plugin.json" | head -1)"
OUT="$REPO/dist"
APP="$OUT/cooked.app"
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/plugins"

# universal: Apple silicon and Intel
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.0" -framework Cocoa -framework WebKit "$HERE/Cooked.swift" -o "$OUT/cooked-$arch" 2>&1 | grep -v "^$" || true
done
lipo -create "$OUT/cooked-arm64" "$OUT/cooked-x86_64" -output "$APP/Contents/MacOS/cooked"
rm -f "$OUT/cooked-arm64" "$OUT/cooked-x86_64"

cp "$HERE/runtime.sh" "$APP/Contents/Resources/runtime.sh" && chmod +x "$APP/Contents/Resources/runtime.sh"
for p in ai-editor studio creator-teardown; do
  rsync -a --exclude __pycache__ --exclude node_modules --exclude 'evals/results' --exclude '.DS_Store' --exclude 'app/' \
        "$REPO/plugins/$p" "$APP/Contents/Resources/plugins/"
done
cp -R "$REPO/.claude-plugin" "$APP/Contents/Resources/.claude-plugin"
cp "$REPO/LICENSE" "$REPO/NOTICE" "$REPO/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/" 2>/dev/null || true

# the icon: the name on black
ICON="$OUT/icon.iconset"; rm -rf "$ICON" && mkdir -p "$ICON"
if swift "$HERE/icon.swift" "$OUT/icon-1024.png" 2>/dev/null; then
  for s in 16 32 128 256 512; do
    sips -z $s $s "$OUT/icon-1024.png" --out "$ICON/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$OUT/icon-1024.png" --out "$ICON/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICON" -o "$APP/Contents/Resources/cooked.icns" && rm -rf "$ICON" "$OUT/icon-1024.png"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>cooked.</string>
  <key>CFBundleDisplayName</key><string>cooked.</string>
  <key>CFBundleIdentifier</key><string>app.cooked.studio</string>
  <key>CFBundleExecutable</key><string>cooked</string>
  <key>CFBundleIconFile</key><string>cooked</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSAppleEventsUsageDescription</key><string>cooked. opens Terminal once so you can sign in to Claude.</string>
  <key>NSMicrophoneUsageDescription</key><string>cooked. records your voice when you choose to record in the editor.</string>
  <key>NSCameraUsageDescription</key><string>cooked. uses the camera when you choose to record in the editor.</string>
</dict></plist>
PLIST
codesign --force --deep -s - "$APP" 2>&1 | tail -1
DMG="$OUT/cooked-$VER.dmg"; rm -f "$DMG"
STAGE="$OUT/dmg"; rm -rf "$STAGE" && mkdir -p "$STAGE" && cp -R "$APP" "$STAGE/" && ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "cooked. $VER" -srcfolder "$STAGE" -ov -format UDZO "$DMG" && rm -rf "$STAGE"
echo "built $APP ($(du -sh "$APP" | cut -f1)) and $DMG ($(du -sh "$DMG" | cut -f1))"
if [ "${1:-}" = "--install" ]; then
  rm -rf "/Applications/cooked.app" && cp -R "$APP" /Applications/ && echo "installed /Applications/cooked.app"
fi
