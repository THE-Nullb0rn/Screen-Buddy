# Screen Buddy Sounds

This folder contains audio clips for companion interactions and desktop alerts.
Supported audio formats: `.ogg`, `.mp3`, `.wav`.

Clips are loaded dynamically with `import.meta.glob`. If a sound file is missing, Screen Buddy will remain silent without throwing errors or printing console warnings.

## Expected Sound Clips

| Clip Name | Description | Trigger Event |
|---|---|---|
| `meow_happy` | Happy meow sound | After feeding completes, after left-click happy reaction, and when waking up from a click |
| `meow_hungry` | Hungry meow call | When the hunger reminder card appears |
| `purr` | Gentle purring sound | When petting/stroking the cat's head starts |
| `munch` | Nibbling / eating crunch | When the eating animation starts |
| `reminder` | Gentle reminder chime | When a reminder card appears |
| `chat_reply` | Soft reply chime | When an AI chat response arrives (not for errors) |
