'use strict';
// Coverage for _fbGetActiveNotes: the window/sustain/fade logic that
// decides which fretboard dots light up at a given playhead time.
// Runs under the org reusable CI as `node tests/screen.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
    global.window = {};
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

const mod = freshPlugin();

test('a note within the 80ms window and no sustain is fully active', () => {
    const active = mod._fbGetActiveNotes(1.0, [{ t: 1.0, s: 0, f: 3 }], null);
    assert.deepEqual(active, [{ s: 0, f: 3, alpha: 1 }]);
});

test('a note outside the window is excluded', () => {
    const active = mod._fbGetActiveNotes(1.0, [{ t: 0.5, s: 0, f: 3 }], null);
    assert.deepEqual(active, []);
});

test('a note with sustain fades linearly toward a 0.3 floor', () => {
    const notes = [{ t: 0, s: 0, f: 0, sus: 1.0 }];
    const early = mod._fbGetActiveNotes(0.1, notes, null)[0];
    const late = mod._fbGetActiveNotes(0.9, notes, null)[0];
    assert.ok(early.alpha > late.alpha);
    assert.ok(late.alpha >= 0.3);
});

test('a sustained note stays active through its full duration', () => {
    const notes = [{ t: 0, s: 0, f: 0, sus: 2.0 }];
    assert.equal(mod._fbGetActiveNotes(1.9, notes, null).length, 1);
    assert.equal(mod._fbGetActiveNotes(2.5, notes, null).length, 0); // well past sustain+window
});

test('notes iteration stops early via the sorted-by-time break guard', () => {
    // A note far in the future (>0.5s ahead) should not suppress earlier
    // active notes reachable before the break fires.
    const notes = [
        { t: 1.0, s: 0, f: 0 },
        { t: 5.0, s: 1, f: 1 }, // way ahead -> triggers break on the next iteration
    ];
    const active = mod._fbGetActiveNotes(1.0, notes, null);
    assert.deepEqual(active, [{ s: 0, f: 0, alpha: 1 }]);
});

test('chord notes within window are all included', () => {
    const chords = [{ t: 1.0, notes: [{ s: 0, f: 0 }, { s: 1, f: 2 }] }];
    const active = mod._fbGetActiveNotes(1.0, null, chords);
    assert.deepEqual(active, [
        { s: 0, f: 0, alpha: 1 },
        { s: 1, f: 2, alpha: 1 },
    ]);
});

test('a chord well past its 0.9s hold is excluded', () => {
    const chords = [{ t: 0.0, notes: [{ s: 0, f: 0 }] }];
    assert.deepEqual(mod._fbGetActiveNotes(1.0, null, chords), []);
});

test('a chord diagram stays visible for the full 0.9s hold', () => {
    const chords = [{ t: 0.2, notes: [{ s: 0, f: 0 }] }];
    const active = mod._fbGetActiveNotes(1.0, null, chords);
    assert.deepEqual(active, [{ s: 0, f: 0, alpha: 1 }]);
});

test('a member outlasts its 0.9s hold while a sustained member remains', () => {
    // Both members onset at t=0; one has no sustain, the other rings for 5s.
    const chords = [{ t: 0, notes: [{ s: 0, f: 0, sus: 0 }, { s: 1, f: 1, sus: 5.0 }] }];
    const active = mod._fbGetActiveNotes(0.95, null, chords);
    // The unsustained member's 0.9s hold has expired; the sustained one hasn't.
    assert.equal(active.length, 1);
    assert.equal(active[0].s, 1);
});

test('handles missing notes/chords gracefully', () => {
    assert.deepEqual(mod._fbGetActiveNotes(1.0, null, null), []);
    assert.deepEqual(mod._fbGetActiveNotes(1.0, undefined, undefined), []);
});

test('combines standalone notes and chords in one active list', () => {
    const notes = [{ t: 1.0, s: 0, f: 0 }];
    const chords = [{ t: 1.0, notes: [{ s: 1, f: 1 }] }];
    const active = mod._fbGetActiveNotes(1.0, notes, chords);
    assert.equal(active.length, 2);
});
