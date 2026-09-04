# 🟢 screen-buddy

A little desktop companion that lives on your screen and nudges you to take care of yourself while you work — drink water, fix your posture, rest your eyes, stretch — without ever getting in your way.

Built native for **Linux / Wayland / Hyprland**. No Windows baggage.

> Status: 🚧 early build — architecture and feature list in progress.

---

## Why

Most "hydration reminder" apps are Windows-only, bloated, or just an annoying popup. screen-buddy is meant to be:

- **Actually yours** — original mascot, not borrowed IP
- **Native to a tiling WM workflow** — respects Hyprland, doesn't fight your window rules
- **More than one nag** — water is just the first reminder type, not the whole app
- **Lightweight** — a companion, not a background hog

## Planned Features

- 💧 Hydration reminders (configurable work/rest cycles)
- 🪑 Posture check nudges
- 👀 Eye-rest reminders (20-20-20 style)
- 🧍 Stretch break prompts
- 🎭 Animated mascot with multiple entrance styles
- ⚙️ System tray / Waybar-friendly controls
- 🐧 Linux-native autostart (systemd user service / `.desktop` entry)
- 📊 Daily stats & streaks

*(Feature list will get locked in as we build — this is the working draft.)*

## Stack

TBD — targeting something that plays nice with Electron-on-Wayland or a lighter native alternative. Decision pending after evaluating tray/animation behavior on Hyprland.

## Platform

Built and tested on Fedora + Hyprland. Not targeting Windows/macOS.

## Credits

Concept loosely inspired by early hydration-reminder desktop apps — screen-buddy itself is an original build from scratch: own code, own mascot, own architecture.

---

Built by [nullborn](https://github.com/THE-Nullb0rn) — born from nothing, building everything.
