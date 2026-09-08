// Fretboard View plugin
// Draws a horizontal guitar fretboard that lights up with active notes.

const FB_STRINGS = 6;
const FB_FRETS = 24;
const FB_STRING_COLORS = [
    '#cc0000', '#cca800', '#0066cc',
    '#cc6600', '#00cc66', '#9900cc',
];
const FB_STRING_BRIGHT = [
    '#ff4444', '#ffe050', '#4499ff',
    '#ff9944', '#44ff99', '#cc44ff',
];
const FB_DOT_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const FB_DOUBLE_DOT = [12, 24];

// ── Instance factory ───────────────────────────────────────────────────
//
// One instance = one canvas bound to one `highway`-shaped object
// (anything exposing getTime()/getNotes()/getChords()), mounted inside
// one container. The player's own toggle button (below) creates a single
// instance anchored to #player; other hosts — e.g. splitscreen, which
// runs one independent highway per panel — can create their own via
// window.createFretboardOverlay({ container, getHighway }), one per
// panel, without touching any of this plugin's internal state.
//
// Sizing: the canvas is sized to `container` only at creation and inside
// the returned `resize()`. The factory has no ResizeObserver of its own —
// hosts own layout, so hosts must call `instance.resize()` themselves
// whenever their container's size changes (splitscreen calls it from its
// own layout/window-resize handling; the player toggle below wires a
// `window` resize listener for the same reason).
function _fbCreateInstance({ container, getHighway, bottomOffset, dismissible, onDismiss } = {}) {
    if (!container) throw new Error('createFretboardOverlay: container is required');
    if (typeof getHighway !== 'function') throw new Error('createFretboardOverlay: getHighway is required');
    if (bottomOffset != null && typeof bottomOffset !== 'function') {
        throw new Error('createFretboardOverlay: bottomOffset must be a function');
    }
    bottomOffset = bottomOffset == null ? (() => 0) : bottomOffset;
    if (dismissible && onDismiss != null && typeof onDismiss !== 'function') {
        throw new Error('createFretboardOverlay: onDismiss must be a function');
    }

    let destroyed = false;
    let rafId = null;

    const canvas = document.createElement('canvas');
    canvas.className = 'fretboard-canvas';
    canvas.style.cssText = 'position:absolute;left:0;right:0;z-index:20;pointer-events:none;';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let dismissBtn = null;
    if (dismissible) {
        dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'fretboard-dismiss';
        dismissBtn.textContent = '✕';
        dismissBtn.title = 'Hide fretboard overlay';
        dismissBtn.style.cssText =
            'position:absolute;right:8px;z-index:21;width:24px;height:24px;' +
            'display:flex;align-items:center;justify-content:center;' +
            'background:rgba(8,8,16,0.85);border:1px solid rgba(100,100,130,0.5);' +
            'border-radius:4px;color:#aaa;cursor:pointer;font-size:12px;' +
            'pointer-events:auto;';
        // Falls back to destroy() so a dismissible overlay is never inert
        // when a host opts in without wiring its own onDismiss.
        dismissBtn.onclick = () => { if (onDismiss) onDismiss(); else destroy(); };
        container.appendChild(dismissBtn);
    }

    function resize() {
        if (destroyed) return;
        const bottomH = bottomOffset();
        canvas.style.bottom = bottomH + 'px';
        canvas.width = container.clientWidth;
        canvas.height = Math.max(120, container.clientHeight * 0.15);
        if (dismissBtn) dismissBtn.style.bottom = (bottomH + canvas.height - 30) + 'px';
    }

    function draw() {
        if (destroyed) return;
        rafId = requestAnimationFrame(draw);

        const W = canvas.width;
        const H = canvas.height;

        // Clear
        ctx.fillStyle = 'rgba(8, 8, 16, 0.92)';
        ctx.fillRect(0, 0, W, H);

        const padL = 35;  // space for string labels
        const padR = 10;
        const padT = 10;
        const padB = 20;  // space for fret numbers
        const fretW = (W - padL - padR) / FB_FRETS;
        const stringH = (H - padT - padB) / (FB_STRINGS - 1);

        // Draw fret lines
        ctx.strokeStyle = '#2a2a40';
        ctx.lineWidth = 1;
        for (let f = 0; f <= FB_FRETS; f++) {
            const x = padL + f * fretW;
            ctx.beginPath();
            ctx.moveTo(x, padT);
            ctx.lineTo(x, padT + (FB_STRINGS - 1) * stringH);
            ctx.stroke();

            // Nut (thicker at fret 0)
            if (f === 0) {
                ctx.strokeStyle = '#555';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(x, padT);
                ctx.lineTo(x, padT + (FB_STRINGS - 1) * stringH);
                ctx.stroke();
                ctx.strokeStyle = '#2a2a40';
                ctx.lineWidth = 1;
            }
        }

        // Draw fret dots
        for (const f of FB_DOT_FRETS) {
            if (f > FB_FRETS) continue;
            const x = padL + (f - 0.5) * fretW;
            const isDouble = FB_DOUBLE_DOT.includes(f);
            ctx.fillStyle = '#1a1a30';
            if (isDouble) {
                const y1 = padT + 1.5 * stringH;
                const y2 = padT + 3.5 * stringH;
                ctx.beginPath(); ctx.arc(x, y1, 4, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(x, y2, 4, 0, Math.PI * 2); ctx.fill();
            } else {
                const y = padT + 2.5 * stringH;
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
            }
        }

        // Draw strings
        for (let s = 0; s < FB_STRINGS; s++) {
            const y = padT + s * stringH;
            // String 0 = high e (top), string 5 = low E (bottom)
            // But in the chart, string 0 = low E. So reverse: draw index (FB_STRINGS-1-s)
            const rsString = FB_STRINGS - 1 - s;
            ctx.strokeStyle = FB_STRING_COLORS[rsString];
            ctx.lineWidth = 1 + s * 0.3;  // thicker for lower strings
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(W - padR, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Draw fret numbers
        ctx.fillStyle = '#444';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let f = 1; f <= FB_FRETS; f++) {
            const x = padL + (f - 0.5) * fretW;
            ctx.fillText(f, x, padT + (FB_STRINGS - 1) * stringH + 5);
        }

        // String names
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 10px sans-serif';
        const stringNames = ['e', 'B', 'G', 'D', 'A', 'E'];
        for (let s = 0; s < FB_STRINGS; s++) {
            const y = padT + s * stringH;
            const rsString = FB_STRINGS - 1 - s;
            ctx.fillStyle = FB_STRING_COLORS[rsString];
            ctx.fillText(stringNames[s], padL - 8, y);
        }

        // Get active notes from THIS instance's highway, not a global one —
        // splitscreen panels each run their own independent highway.
        const hw = getHighway();
        if (!hw) return;
        const t = hw.getTime();
        const notes = hw.getNotes();
        const chords = hw.getChords();
        const activeNotes = _fbGetActiveNotes(t, notes, chords);

        // Draw active notes
        for (const n of activeNotes) {
            const rsString = n.s;  // the chart string (0=low E)
            const fret = n.f;
            const drawString = FB_STRINGS - 1 - rsString;  // flip for display

            const y = padT + drawString * stringH;
            let x;
            if (fret === 0) {
                x = padL - 2;  // open string: at the nut
            } else {
                x = padL + (fret - 0.5) * fretW;
            }

            const color = FB_STRING_BRIGHT[rsString] || '#fff';
            const alpha = n.alpha || 1;

            // Glow
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.fill();

            // Note dot
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();

            // Fret number
            ctx.fillStyle = '#000';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(fret, x, y);

            ctx.globalAlpha = 1;
        }
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        canvas.remove();
        if (dismissBtn) dismissBtn.remove();
    }

    resize();
    rafId = requestAnimationFrame(draw);

    // resize: host-driven — call whenever `container`'s size changes.
    // destroy: idempotent — cancels the rAF loop and removes the canvas
    // (and dismiss button, if any).
    return { canvas, resize, destroy };
}

function _fbGetActiveNotes(t, notes, chords) {
    const active = [];
    const window = 0.08;  // notes within 80ms of current time

    // Standalone notes
    if (notes) {
        for (const n of notes) {
            const noteEnd = n.t + (n.sus || 0);
            if (n.t <= t + window && noteEnd >= t - window) {
                // Fade based on sustain progress
                let alpha = 1;
                if (n.sus > 0 && t > n.t) {
                    alpha = Math.max(0.3, 1 - (t - n.t) / n.sus * 0.7);
                }
                active.push({ s: n.s, f: n.f, alpha });
            }
            if (n.t > t + 0.5) break;  // notes are sorted by time
        }
    }

    // Chord notes. CHORD_HOLD_S keeps a struck chord's shape on the
    // fretboard well past its literal onset (issues #2/#3: the shape used
    // to vanish after ~300ms, too fast for a player to read and form).
    const CHORD_HOLD_S = 0.9;
    if (chords) {
        for (const c of chords) {
            // Gate on the chord's longest member end, not a flat
            // CHORD_HOLD_S — otherwise a member sustained past 0.9s (e.g.
            // sus: 2) was dropped by this outer check before its own
            // per-member noteEnd below ever got a chance to keep it lit.
            let chordEnd = c.t + CHORD_HOLD_S;
            for (const cn of (c.notes || [])) {
                const end = c.t + (cn.sus || 0);
                if (end > chordEnd) chordEnd = end;
            }
            if (c.t <= t + window && chordEnd >= t - window) {
                for (const cn of (c.notes || [])) {
                    const holdEnd = c.t + Math.max(cn.sus || 0, CHORD_HOLD_S);
                    if (holdEnd >= t - window) {
                        let alpha = 1;
                        if (t > c.t) {
                            alpha = Math.max(0.45, 1 - (t - c.t) / (holdEnd - c.t) * 0.55);
                        }
                        active.push({ s: cn.s, f: cn.f, alpha });
                    }
                }
            }
            if (c.t > t + 0.5) break;
        }
    }

    return active;
}

// Node-only export hook for tests; browsers fall through to the hooks IIFE.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _fbGetActiveNotes, _fbCreateInstance };
} else {

// ── Player toggle (single global instance, anchored to #player) ────────

let _fbEnabled = false;
let _fbInstance = null;
let _fbOnResize = null;

function _fbInjectButton() {
    const controls = document.getElementById('player-controls');
    if (!controls || document.getElementById('btn-fretboard')) return;

    const closeBtn = controls.querySelector('button:last-child');
    const btn = document.createElement('button');
    btn.id = 'btn-fretboard';
    btn.className = 'px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-400 transition';
    btn.textContent = 'Fretboard';
    btn.title = 'Toggle fretboard overlay';
    btn.onclick = _fbToggle;
    if (closeBtn && closeBtn.parentNode === controls) controls.insertBefore(btn, closeBtn); else controls.appendChild(btn);
}

function _fbToggle() {
    _fbEnabled = !_fbEnabled;
    const btn = document.getElementById('btn-fretboard');
    if (btn) {
        btn.className = _fbEnabled
            ? 'px-3 py-1.5 bg-teal-900/50 rounded-lg text-xs text-teal-300 transition'
            : 'px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-400 transition';
        btn.textContent = _fbEnabled ? 'Fretboard ✓' : 'Fretboard';
    }

    if (_fbEnabled) {
        _fbCreateCanvas();
    } else {
        _fbRemoveCanvas();
    }
}

function _fbCreateCanvas() {
    if (_fbInstance) return;
    const player = document.getElementById('player');
    if (!player) return;

    // `bottom` sits flush above the controls bar, matching its height even
    // when it flex-wraps to multiple rows on narrow windows.
    _fbInstance = _fbCreateInstance({
        container: player,
        getHighway: () => window.highway,
        bottomOffset: () => {
            const controls = document.getElementById('player-controls');
            return controls ? controls.offsetHeight : 50;
        },
        dismissible: true,
        onDismiss: _fbToggle,
    });

    _fbOnResize = () => _fbInstance && _fbInstance.resize();
    window.addEventListener('resize', _fbOnResize);
}

function _fbRemoveCanvas() {
    if (_fbInstance) {
        window.removeEventListener('resize', _fbOnResize);
        _fbOnResize = null;
        _fbInstance.destroy();
        _fbInstance = null;
    }
}

// ── Hooks ───────────────────────────────────────────────────────────────

(function() {
    // Idempotency: if screen.js is re-evaluated (loader cache miss, hot reload,
    // older core builds without the load-side guard), don't re-wrap playSong —
    // each re-wrap captures the previous wrapper, growing the chain and
    // leaking closures.
    const HOOK_KEY = '__slopsmithFretboardHooksInstalled';
    if (window[HOOK_KEY]) return;
    window[HOOK_KEY] = true;

    // Expose the factory so other plugins — e.g. splitscreen, which runs
    // one independent highway per panel — can mount their own per-panel
    // fretboard instances without touching this plugin's global toggle
    // state. Not a viz renderer (no contextType/init/draw contract): this
    // is the overlay contract, a self-owned canvas + rAF loop a host just
    // creates and destroys.
    window.createFretboardOverlay = _fbCreateInstance;

    const origPlaySong = window.playSong;
    window.playSong = async function(filename, arrangement) {
        await origPlaySong(filename, arrangement);
        _fbInjectButton();
        if (_fbEnabled) {
            _fbRemoveCanvas();
            _fbCreateCanvas();
        }
    };
})();

}
