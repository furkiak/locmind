// Grid A* path finding around room walls and locked doors, followed by string pulling
// so the avatar walks in straight lines between the few corners that matter.
import { S, W, C, canEnter } from './state.js';

const CELL = 10;
const PS = C.PLAYER_SIZE;
const COLS = Math.floor((C.WIDTH - PS) / CELL) + 1, ROWS = Math.floor((C.HEIGHT - PS) / CELL) + 1;

/** Blocked cells for the player's top-left corner, rebuilt when rooms or my keys change. */
let grid = null, gridKey = '';

function buildGrid() {
    const key = Object.values(S.rooms).filter(r => !r.builtin).map(r => `${r.id}:${canEnter(r) ? 1 : 0}`).join(',');
    if (grid && key === gridKey) return grid;
    gridKey = key;
    grid = new Uint8Array(COLS * ROWS);
    const block = (x, y, w, h) => {
        // grid position c*CELL is blocked when the player rect [p, p + PS] overlaps the obstacle [x, x + w]
        const c0 = Math.max(0, Math.floor((x - PS) / CELL) + 1), c1 = Math.min(COLS - 1, Math.ceil((x + w) / CELL) - 1);
        const r0 = Math.max(0, Math.floor((y - PS) / CELL) + 1), r1 = Math.min(ROWS - 1, Math.ceil((y + h) / CELL) - 1);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * COLS + c] = 1;
    };
    for (const room of Object.values(S.rooms)) {
        if (room.builtin) continue;
        const slot = S.slotsById[room.id];
        if (!slot) continue;
        for (const w of W.slotWalls(slot)) block(w.x - 2, w.y - 2, w.w + 4, w.h + 4);
        if (!canEnter(room)) { const d = W.slotDoor(slot); block(d.x, d.y - 6, d.w, d.h); }
    }
    return grid;
}

const free = (g, c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !g[r * COLS + c];
const toCell = v => Math.round(v / CELL);

/** Straight walk check by sampling the grid along the segment. */
function lineFree(g, ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / (CELL / 2)));
    for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
        const fx = Math.floor(x / CELL), fy = Math.floor(y / CELL), cx = Math.ceil(x / CELL), cy = Math.ceil(y / CELL);
        if (!free(g, fx, fy) || !free(g, cx, cy) || !free(g, fx, cy) || !free(g, cx, fy)) return false;
    }
    return true;
}

function nearestFree(g, c, r) {
    if (free(g, c, r)) return [c, r];
    for (let rad = 1; rad < 24; rad++) {
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) === rad && free(g, c + dc, r + dr)) return [c + dc, r + dr];
        }
    }
    return null;
}

/** Binary heap keyed by f score. */
class Heap {
    constructor() { this.a = []; }
    push(node, f) {
        const a = this.a; a.push([f, node]);
        let i = a.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
        const a = this.a, top = a[0], last = a.pop();
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && a[l][0] < a[m][0]) m = l;
                if (r < a.length && a[r][0] < a[m][0]) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]]; i = m;
            }
        }
        return top[1];
    }
    get size() { return this.a.length; }
}

/**
 * Path from the player's top-left position (sx, sy) to (tx, ty), as a list of waypoints
 * (top-left coordinates). Returns null when the target cannot be reached.
 */
export function findPath(sx, sy, tx, ty) {
    const g = buildGrid();
    tx = Math.max(0, Math.min(C.WIDTH - PS, tx));
    ty = Math.max(0, Math.min(C.HEIGHT - PS, ty));
    if (lineFree(g, sx, sy, tx, ty)) return [{ x: tx, y: ty }];
    const start = nearestFree(g, toCell(sx), toCell(sy));
    const goal = nearestFree(g, toCell(tx), toCell(ty));
    if (!start || !goal) return null;
    const S0 = start[1] * COLS + start[0], G = goal[1] * COLS + goal[0];
    const gScore = new Float32Array(COLS * ROWS).fill(Infinity);
    const came = new Int32Array(COLS * ROWS).fill(-1);
    const closed = new Uint8Array(COLS * ROWS);
    const h = i => { const dc = Math.abs(i % COLS - goal[0]), dr = Math.abs(((i / COLS) | 0) - goal[1]); return Math.max(dc, dr) + .414 * Math.min(dc, dr); };
    const open = new Heap();
    gScore[S0] = 0;
    open.push(S0, h(S0));
    let found = false, budget = 250000;
    while (open.size && budget-- > 0) {
        const cur = open.pop();
        if (cur === G) { found = true; break; }
        if (closed[cur]) continue;
        closed[cur] = 1;
        const cc = cur % COLS, cr = (cur / COLS) | 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nc = cc + dc, nr = cr + dr;
            if (!free(g, nc, nr)) continue;
            if (dr && dc && (!free(g, cc + dc, cr) || !free(g, cc, cr + dr))) continue;   // no corner cutting
            const ni = nr * COLS + nc;
            if (closed[ni]) continue;
            const cost = gScore[cur] + (dr && dc ? 1.414 : 1);
            if (cost < gScore[ni]) { gScore[ni] = cost; came[ni] = cur; open.push(ni, cost + h(ni)); }
        }
    }
    if (!found) return null;
    const cells = [];
    for (let i = G; i !== -1; i = came[i]) cells.push({ x: (i % COLS) * CELL, y: ((i / COLS) | 0) * CELL });
    cells.reverse();
    cells.push({ x: tx, y: ty });
    // string pulling: keep only the corners we cannot see past
    const out = [];
    let ax = sx, ay = sy, i = 0;
    while (i < cells.length - 1) {
        let j = cells.length - 1;
        while (j > i + 1 && !lineFree(g, ax, ay, cells[j].x, cells[j].y)) j--;
        out.push(cells[j]);
        ax = cells[j].x; ay = cells[j].y; i = j;
    }
    if (!out.length) out.push({ x: tx, y: ty });
    return out;
}

/** A spot just outside a room's door (top-left coordinates), handy as a destination. */
export function doorstep(slotId) {
    const slot = S.slotsById[slotId];
    if (!slot) return null;
    if (slot.type !== 'conference') return { x: slot.x + slot.w / 2 - PS / 2, y: slot.y + slot.h / 2 - PS / 2 };
    return { x: W.doorStart(slot) + C.DOOR_SIZE / 2 - PS / 2, y: slot.y + slot.h + 14 };
}

/** Destination for "take me there": inside when I may enter, otherwise the doorstep. */
export function destinationFor(slotId) {
    const slot = S.slotsById[slotId], room = S.rooms[slotId];
    if (!slot) return null;
    if (slot.type !== 'conference' || !room || canEnter(room)) return { x: slot.x + slot.w / 2 - PS / 2, y: slot.y + slot.h / 2 - PS / 2 };
    return doorstep(slotId);
}
