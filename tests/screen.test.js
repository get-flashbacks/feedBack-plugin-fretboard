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

test('a chord well before the current time is excluded (0.3s lookback)', () => {
    const chords = [{ t: 0.5, notes: [{ s: 0, f: 0 }] }];
    assert.deepEqual(mod._fbGetActiveNotes(1.0, null, chords), []);
});

test('individual chord-member sustain still governs member inclusion', () => {
    // Chord onset within the 0.3s lookback gate; members have different sustains.
    const chords = [{ t: 0.85, notes: [{ s: 0, f: 0, sus: 0 }, { s: 1, f: 1, sus: 2.0 }] }];
    const active = mod._fbGetActiveNotes(1.0, null, chords);
    // Only the long-sustain member should still be ringing at t=1.0.
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

function withDom(fn) {
    global.document = {
        createElement: () => ({
            style: {}, className: '', textContent: '', title: '', onclick: null,
            appendChild() {}, remove() {},
            getContext: fakeCtx,
        }),
    };
    const rafQueue = [];
    let rafId = 0;
    global.requestAnimationFrame = (cb) => { rafId++; rafQueue.push(cb); return rafId; };
    global.cancelAnimationFrame = () => {};
    function step() {
        if (rafQueue.length) rafQueue.shift()();
    }
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
        let aCalled = false, bCalled = false;
        const hwA = { getTime: () => { aCalled = true; return 1; }, getNotes: () => [], getChords: () => [] };
        const hwB = { getTime: () => { bCalled = true; return 2; }, getNotes: () => [], getChords: () => [] };
        const a = mod._fbCreateInstance({ container: fakeContainer(800, 400), getHighway: () => hwA });
        const b = mod._fbCreateInstance({ container: fakeContainer(400, 200), getHighway: () => hwB });
        assert.notEqual(a.canvas, b.canvas);
        step();
        assert.ok(aCalled, 'instance A should read hwA');
        assert.ok(!bCalled, 'instance A should not read hwB');
        step();
        assert.ok(bCalled, 'instance B should read hwB');
        a.destroy();
        b.destroy();
    });
});

test('_fbCreateInstance requires container and getHighway', () => {
    withDom(() => {
        assert.throws(
            () => mod._fbCreateInstance({ getHighway: () => ({}) }),
            { message: 'createFretboardOverlay: container is required' }
        );
        assert.throws(
            () => mod._fbCreateInstance({ container: fakeContainer(100, 100) }),
            { message: 'createFretboardOverlay: getHighway is required' }
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
        assert.equal(inst.canvas.style.bottom, '42px');
        assert.equal(inst.canvas.height, 120);  // 300 * 0.15 = 45, clamped to 120 minimum
        inst.destroy();

        const tall = fakeContainer(640, 1000);
        const inst2 = mod._fbCreateInstance({
            container: tall,
            getHighway: () => ({ getTime: () => 0, getNotes: () => [], getChords: () => [] }),
        });
        assert.equal(inst2.canvas.height, 150);  // 1000 * 0.15 = 150 > 120 minimum
        inst2.destroy();
    });
});
