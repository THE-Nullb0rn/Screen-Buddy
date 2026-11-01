# Screen Buddy Sounds

This folder contains audio clips for companion interactions and desktop alerts.
Supported audio formats: `.ogg`, `.mp3`, `.wav`.

> **Note**: Only `meow` is required! If specific clips (`meow_happy`, `meow_hungry`, `purr`, `reminder`, `chat_reply`) are not provided, Screen Buddy will automatically fall back to `meow`. `munch` stays silent without its own file. The others are optional overrides.

Clips are loaded dynamically with `import.meta.glob`. If a sound file is missing (and no fallback exists), Screen Buddy will remain silent without throwing errors or printing console warnings.

## Expected Sound Clips

| Clip Name | Description | Trigger Event | Fallback |
|---|---|---|---|
| `meow` | Base meow sound (**only required sound**) | General meow / universal fallback | — |
| `meow_happy` | Happy meow sound (optional override) | After feeding completes, after left-click happy reaction, when waking up from click / launch | `meow` |
| `meow_hungry` | Hungry meow call (optional override) | When the hunger reminder card appears | `meow` |
| `purr` | Gentle purring sound (optional override) | When petting/stroking the cat's head starts | `meow` |
| `munch` | Nibbling / eating crunch (optional) | When the eating animation starts | *(stays silent)* |
| `reminder` | Gentle reminder chime (optional override) | When a reminder card appears | `meow` |
| `chat_reply` | Soft reply chime (optional override) | When an AI chat response arrives (not for errors) | `meow` |
