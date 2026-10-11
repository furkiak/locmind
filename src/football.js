'use strict';

const { STADIUM, C } = require('../shared/world');

const FRICTION = 0.95;
const BOUNCE = 0.8;
const KICK_FORCE = 20;
const MAX_BALL_SPEED = 34;

/** Server side authoritative football: one ball, one scoreboard. */
class Football {
    constructor(field = STADIUM) {
        this.field = field;
        this.ball = { x: 0, y: 0, vx: 0, vy: 0, radius: 15 };
        this.score = { blue: 0, red: 0 }; // blue defends the left goal, red the right one
        this.lastTouch = null;
        this.reset();
    }

    reset(resetScore = false) {
        this.ball.x = this.field.x + this.field.w / 2;
        this.ball.y = this.field.y + this.field.h / 2;
        this.ball.vx = 0;
        this.ball.vy = 0;
        this.lastTouch = null;
        if (resetScore) this.score = { blue: 0, red: 0 };
    }

    snapshot() {
        const b = this.ball;
        return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, radius: b.radius };
    }

    get moving() { return this.ball.vx !== 0 || this.ball.vy !== 0; }

    _limit() {
        const b = this.ball, speed = Math.hypot(b.vx, b.vy);
        if (speed > MAX_BALL_SPEED) { b.vx = b.vx / speed * MAX_BALL_SPEED; b.vy = b.vy / speed * MAX_BALL_SPEED; }
    }

    /** Space-bar kick. Returns true when the ball was actually hit. */
    kick(player) {
        const b = this.ball;
        const dx = b.x - (player.x + C.PLAYER_SIZE / 2);
        const dy = b.y - (player.y + C.PLAYER_SIZE / 2);
        if (Math.hypot(dx, dy) >= C.KICK_RADIUS + b.radius) return false;
        const angle = Math.atan2(dy, dx);
        b.vx += Math.cos(angle) * KICK_FORCE;
        b.vy += Math.sin(angle) * KICK_FORCE;
        this._limit();
        this.lastTouch = player.nickname;
        return true;
    }

    /** Running into the ball pushes it a little (dribbling). */
    nudge(player, moveDx, moveDy) {
        const b = this.ball;
        const cx = player.x + C.PLAYER_SIZE / 2, cy = player.y + C.PLAYER_SIZE / 2;
        const dx = b.x - cx, dy = b.y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > C.PLAYER_SIZE / 2 + b.radius + 4 || dist === 0) return false;
        b.vx += dx / dist * 3 + moveDx * 0.18;
        b.vy += dy / dist * 3 + moveDy * 0.18;
        this._limit();
        this.lastTouch = player.nickname;
        return true;
    }

    /** One physics step. Returns { moved, goal } where goal = { team, scorer } or null. */
    tick() {
        const b = this.ball, f = this.field;
        if (!this.moving) return { moved: false, goal: null };

        b.vx *= FRICTION;
        b.vy *= FRICTION;
        if (Math.abs(b.vx) < 0.1) b.vx = 0;
        if (Math.abs(b.vy) < 0.1) b.vy = 0;

        let nx = b.x + b.vx, ny = b.y + b.vy;
        const goalTop = f.y + (f.h - f.goalSize) / 2;
        const goalBottom = f.y + (f.h + f.goalSize) / 2;
        const inGoalMouth = ny > goalTop && ny < goalBottom;

        if (nx - b.radius < f.x) {
            if (inGoalMouth) return { moved: true, goal: this._goal('red') };
            nx = f.x + b.radius; b.vx = -b.vx * BOUNCE;
        } else if (nx + b.radius > f.x + f.w) {
            if (inGoalMouth) return { moved: true, goal: this._goal('blue') };
            nx = f.x + f.w - b.radius; b.vx = -b.vx * BOUNCE;
        }

        if (ny - b.radius < f.y) { ny = f.y + b.radius; b.vy = -b.vy * BOUNCE; }
        else if (ny + b.radius > f.y + f.h) { ny = f.y + f.h - b.radius; b.vy = -b.vy * BOUNCE; }

        b.x = nx; b.y = ny;
        return { moved: true, goal: null };
    }

    _goal(team) {
        this.score[team]++;
        const scorer = this.lastTouch;
        this.reset();
        return { team, scorer, score: { ...this.score } };
    }
}

module.exports = { Football };
