#!/usr/bin/env bash
# Cross-platform notify script: plays success/fail sound based on exit code.

status=${1:-0}
success_sound=${NOTIFY_SUCCESS:-}
fail_sound=${NOTIFY_FAIL:-}
bell_count=${NOTIFY_BELL_COUNT:-2}

is_macos() { [ "$(uname)" = "Darwin" ]; }
is_linux() { [ "$(uname)" = "Linux" ]; }

play_macos() {
  local tone="$1"
  if command -v afplay >/dev/null 2>&1; then
    if [ "$tone" = "ok" ]; then
      afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || osascript -e 'beep'
    else
      afplay /System/Library/Sounds/Basso.aiff 2>/dev/null || osascript -e 'beep 3'
    fi
  else
    [ "$tone" = "ok" ] && osascript -e 'beep' || osascript -e "beep $bell_count"
  fi
}

play_linux() {
  local file="$1"
  if command -v paplay >/dev/null 2>&1; then
    paplay "$file" 2>/dev/null || printf '\a'
  elif command -v aplay >/dev/null 2>&1; then
    aplay "$file" 2>/dev/null || printf '\a'
  else
    printf '\a'
  fi
}

play_windows() {
  # Git Bash/WSL: try PowerShell
  if command -v powershell.exe >/dev/null 2>&1; then
    if [ "$1" = "ok" ]; then
      powershell.exe -NoProfile -Command "[console]::beep(1200,200)" >/dev/null
    else
      powershell.exe -NoProfile -Command "[console]::beep(400,200); Start-Sleep -Milliseconds 150; [console]::beep(400,200)" >/dev/null
    fi
  else
    printf '\a'
  fi
}

notify_ok() {
  if [ -n "$success_sound" ] && [ -f "$success_sound" ]; then
    if is_macos; then afplay "$success_sound" 2>/dev/null || printf '\a'
    elif is_linux; then play_linux "$success_sound"
    else play_windows ok; fi
  else
    if is_macos; then play_macos ok
    elif is_linux; then play_linux /usr/share/sounds/freedesktop/stereo/complete.oga
    else play_windows ok; fi
  fi
}

notify_fail() {
  if [ -n "$fail_sound" ] && [ -f "$fail_sound" ]; then
    if is_macos; then afplay "$fail_sound" 2>/dev/null || printf '\a'
    elif is_linux; then play_linux "$fail_sound"
    else play_windows fail; fi
  else
    if is_macos; then play_macos fail
    elif is_linux; then play_linux /usr/share/sounds/freedesktop/stereo/dialog-error.oga
    else play_windows fail; fi
  fi
}

if [ "$status" -eq 0 ]; then
  notify_ok
else
  notify_fail
fi

