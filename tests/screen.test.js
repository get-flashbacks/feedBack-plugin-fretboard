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

test('a chord well before the current time is excluded (0.9s hold)', () => {
    // 0.05 + 0.9s hold + the 80ms trailing grace window all elapsed by t=1.2.
    const chords = [{ t: 0.05, notes: [{ s: 0, f: 0 }] }];
    assert.deepEqual(mod._fbGetActiveNotes(1.2, null, chords), []);
});

test('a chord shape is held on the fretboard well past its onset (issue #2/#3)', () => {
    // Onset at t=0.5, no sustain on the member notes: previously this would
    // have faded out by t=0.8 (300ms lookback); now it should still be lit
    // most of the way to a full second later.
    const chords = [{ t: 0.5, notes: [{ s: 0, f: 0, sus: 0 }] }];
    const active = mod._fbGetActiveNotes(1.3, null, chords);
    assert.equal(active.length, 1);
    assert.ok(active[0].alpha >= 0.45);
});

test('individual chord-member sustain still governs member inclusion', () => {
    // Chord onset within the 0.9s hold gate; members have different sustains.
    const chords = [{ t: 0.85, notes: [{ s: 0, f: 0, sus: 0 }, { s: 1, f: 1, sus: 2.0 }] }];
    const active = mod._fbGetActiveNotes(1.0, null, chords);
    // Both members are still within the chord's hold/sustain window at t=1.0.
    assert.equal(active.length, 2);
});

test('a chord member sustained past CHORD_HOLD_S stays lit for its full sustain, not just 0.9s (CodeRabbit finding)', () => {
    // Onset at t=0, one short member (sus:0) and one long-sustain member
    // (sus:2.0). At t=1.5 — past the flat 0.9s hold — the long member must
    // still be active; only the short one has genuinely ended.
    const chords = [{ t: 0, notes: [{ s: 0, f: 0, sus: 0 }, { s: 1, f: 1, sus: 2.0 }] }];
    const active = mod._fbGetActiveNotes(1.5, null, chords);
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

// Coverage for _fbCreateInstance: the multi-instance factory hosts like
// splitscreen use to mount one fretboard overlay per panel, each bound to
// its own container + highway (feedBack-plugin-splitscreen#17).
function fakeContainer(w, h) {
    return {
        clientWidth: w, clientHeight: h,
        appendChild() {},
    };
}

function fakeCtx() {
    return {
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        arc() {}, fill() {}, fillText() {},
    };
}

// The fake rAF queues callbacks instead of invoking them, since `draw()`
// reschedules itself (`rafId = requestAnimationFrame(draw)`) before doing
// any drawing — calling back synchronously would recurse without bound.
// `step()` runs exactly one pending frame so tests can assert on a single
// draw pass.
function withDom(fn) {
    global.document = {
        createElement: () => ({
            style: {}, className: '', textContent: '', title: '', onclick: null,
            appendChild() {}, remove() {},
            getContext: fakeCtx,
        }),
    };
    let queue = [];
    let nextId = 1;
    global.requestAnimationFrame = (cb) => {
        const id = nextId++;
        queue.push({ id, cb });
        return id;
    };
    global.cancelAnimationFrame = (id) => {
        queue = queue.filter((frame) => frame.id !== id);
    };
    const step = () => {
        const frame = queue.shift();
        if (frame) frame.cb();
    };
    try {
        return fn(step);
    } finally {
        delete global.document;
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
    }
}

test('_fbCreateInstance mounts an independent canvas per call, each reading its own highway', () => {
    withDom((step) => {
        let aReads = 0, bReads = 0;
        const hwA = { getTime: () => { aReads++; return 1; }, getNotes: () => [], getChords: () => [] };
        const hwB = { getTime: () => { bReads++; return 2; }, getNotes: () => [], getChords: () => [] };
        const a = mod._fbCreateInstance({ container: fakeContainer(800, 400), getHighway: () => hwA });
        const b = mod._fbCreateInstance({ container: fakeContainer(400, 200), getHighway: () => hwB });
        assert.notEqual(a.canvas, b.canvas);

        // One queued frame per instance at creation time (a's, then b's).
        step();
        step();
        assert.equal(aReads, 1);
        assert.equal(bReads, 1);

        a.destroy();
        b.destroy();
    });
});

test('_fbCreateInstance requires container and getHighway', () => {
    withDom(() => {
        assert.throws(
            () => mod._fbCreateInstance({ getHighway: () => ({}) }),
            /container is required/,
        );
        assert.throws(
            () => mod._fbCreateInstance({ container: fakeContainer(100, 100) }),
            /getHighway is required/,
        );
    });
});

test('_fbCreateInstance() with no arguments throws the container error, not a TypeError', () => {
    withDom(() => {
        assert.throws(() => mod._fbCreateInstance(), /container is required/);
    });
});

test('_fbCreateInstance rejects a non-function bottomOffset', () => {
    withDom(() => {
        assert.throws(
            () => mod._fbCreateInstance({
                container: fakeContainer(100, 100),
                getHighway: () => ({}),
                bottomOffset: 1,
            }),
            /bottomOffset must be a function/,
        );
    });
});

test('_fbCreateInstance rejects a non-function onDismiss when dismissible', () => {
    withDom(() => {
        assert.throws(
            () => mod._fbCreateInstance({
                container: fakeContainer(100, 100),
                getHighway: () => ({}),
                dismissible: true,
                onDismiss: 'nope',
            }),
            /onDismiss must be a function/,
        );
    });
});

test('_fbCreateInstance.resize sizes the canvas from the container and bottomOffset', () => {
    withDom(() => {
        const container = fakeContainer(640, 300);
        const inst = mod._fbCreateInstance({
            container,
            getHighway: () => ({ getTime: () => 0, getNotes: () => [], getChords: () => [] }),
            bottomOffset: () => 42,
        });
        assert.equal(inst.canvas.width, 640);
        assert.equal(inst.canvas.height, 120);  // 300 * 0.15 = 45, floored to 120
        assert.equal(inst.canvas.style.bottom, '42px');
        inst.destroy();
    });
});

test('_fbCreateInstance sizes the canvas to 15% of a tall container', () => {
    withDom(() => {
        const inst = mod._fbCreateInstance({
            container: fakeContainer(640, 2000),
            getHighway: () => ({ getTime: () => 0, getNotes: () => [], getChords: () => [] }),
        });
        assert.equal(inst.canvas.height, 300);
        inst.destroy();
    });
});
