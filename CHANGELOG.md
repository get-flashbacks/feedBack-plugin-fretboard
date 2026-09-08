# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `window.createFretboardOverlay` factory (`_fbCreateInstance`): hosts running multiple independent highway instances (e.g. splitscreen, one per panel) can mount their own fretboard overlay per panel, each bound to its own container and highway getter, without touching this plugin's internal toggle state.

### Changed

- The player's own "Fretboard" toggle now creates its single instance through the same factory. Its behavior is unchanged.
- Struck chord shapes are now held on the fretboard for a 0.9s minimum (with a raised alpha floor), instead of fading out ~300ms after onset — the shape used to vanish too quickly to read or form. A member note sustained longer than 0.9s stays lit for its full sustain rather than being cut off at the flat hold time. (#2, #3)
