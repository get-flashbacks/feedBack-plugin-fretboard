# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `window.createFretboardOverlay` factory (`_fbCreateInstance`): hosts running multiple independent highway instances (e.g. splitscreen, one per panel) can mount their own fretboard overlay per panel, each bound to its own container and highway getter, without touching this plugin's internal toggle state.

### Changed

- The player's own "Fretboard" toggle now creates its single instance through the same factory. Its behavior is unchanged.
- Struck chord shapes are now held on the fretboard for a 0.9s minimum (with a raised alpha floor), instead of fading out ~300ms after onset — the shape used to vanish too quickly to read or form. A member note sustained longer than 0.9s stays lit for its full sustain rather than being cut off at the flat hold time. (#2, #3)

### Fixed

- The overlay hardcoded a 6-string grid (`FB_STRINGS = 6`) and mapped chart note string indices straight onto it — on a 4-string bass chart, highlighted notes landed two rows off from where they were actually played (and the string labels didn't apply at all); 7/8-string GP imports had the inverse problem, with note indices falling outside the 6-row grid entirely. The overlay now reads the chart's real string count via `highway.getStringCount()` and sizes/labels the grid accordingly, falling back to 6 for a host too old to expose it. String names are shown for standard 6-string guitar and 4-string bass; other counts (5-string bass, 7/8-string guitar, alternate tunings) show numeric labels rather than a guessed-wrong note name. (#19)
