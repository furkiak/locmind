'use strict';

module.exports = function football(ctx, client, on) {
    const { world, hub, W } = ctx;

    on('kick', { limit: [5, 1000] }, p => {
        if (p.roomId !== W.STADIUM.id) return;
        p.lastActive = world.now();
        hub.emit('player:kick', p.id);
        if (world.football.kick(p)) ctx.broadcastBall(false);
    });

    on('score:reset', { limit: [1, 5000] }, p => {
        if (p.roomId !== W.STADIUM.id) return;
        world.football.reset(true);
        ctx.broadcastBall();
        hub.emit('score', world.football.score);
    });
};
