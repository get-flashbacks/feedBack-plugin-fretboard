# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `window.createFretboardOverlay` factory (`_fbCreateInstance`): hosts running multiple independent highway instances (e.g. splitscreen, one per panel) can mount their own fretboard overlay per panel, each bound to its own container and highway getter, without touching this plugin's internal toggle state.

### Changed

- The player's own "Fretboard" toggle now creates its single instance through the same factory. Its behavior is unchanged.

### Fixed

- The fretboard diagram no longer changes which string a note is shown on when the highway's own inversion (invert-highway plugin) is toggled — it now corrects for `highway.getInverted()` so displayed notes always reflect their true string.
