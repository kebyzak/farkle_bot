import { Telegraf, Markup, Context } from 'telegraf';
import { GameManager, GameState } from './gameManager';
import { DICE_CIRCLE_EMOJIS, DIE_EMOJIS, DieValue, calculateScore } from './game';
import * as dotenv from 'dotenv';
import { start } from 'repl';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || '');
const gameManager = new GameManager();

// --- Helpers ---

function getPlayerName(ctx: Context): string {
    return ctx.from?.first_name || 'Player';
}


function renderLobbyMessage(game: GameState): { text: string, extra: any } {
    let text = `🎲 *Farkle (10000)*\n\n`;
    text += `Waiting for players...\n\n`;
    text += `*Joined Players:*\n`;

    game.players.forEach((p, i) => {
        text += `${i + 1}. ${p.username} ${p.id === game.creatorId ? '👑' : ''}\n`;
    });

    text += `\nClick "Join" to enter. The host can start the game when ready.`;

    const buttons = [
        [Markup.button.callback('➕ Join Game', 'join_game')],
        [Markup.button.callback('🚀 Start Game', 'start_game')]
    ];

    return {
        text,
        extra: {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        }
    };
}

function renderGameMessage(game: GameState): { text: string, extra: any } {
    const player = game.players[game.currentPlayerIndex];
    if (!player) return { text: "No players.", extra: {} };

    // Leaderboard section
    let text = ``;

    const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);
    sortedPlayers.forEach((p) => {
        const isCurrentPlayer = p.id === player.id;
        const marker = isCurrentPlayer ? '▶️' : '  ';
        text += `${marker} *${p.username}*: ${p.score} pts\n`;
    });

    if (game.finalRound) {
        text += `\n🎯 *FINAL ROUND!*\n`;
    }

    text += `\n`;

    // Current turn section with user mention
    text += `🎲 [${player.username}](tg://user?id=${player.id})'s Turn\n`;
    text += `🔥 Turn Score: ${game.accumulatedScore}\n\n`;
    text += `Select dice to keep:`;

    // Buttons - show dice values directly on buttons
    const diceRow: any[] = game.currentDice.map((val, idx) => {
        const isLocked = game.lockedIndices.includes(idx);
        const btnText = isLocked ? `✅ ${DIE_EMOJIS[val]}` : `${DIE_EMOJIS[val]}`;
        return Markup.button.callback(btnText, `toggle_${idx}`);
    });

    // Split dice buttons into rows of 3
    const buttonRows: any[][] = [];
    for (let i = 0; i < diceRow.length; i += 3) {
        buttonRows.push(diceRow.slice(i, i + 3));
    }

    // Action buttons
    const actionRow = [
        Markup.button.callback('🔄 Roll Again', 'roll'),
        Markup.button.callback('💰 Bank', 'bank')
    ];

    buttonRows.push(actionRow);

    return {
        text,
        extra: {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttonRows)
        }
    };
}

function renderResults(game: GameState): string {
    let text = `🏁 *Game Finished!*\n\n`;
    text += `📊 *Final Scores:*\n`;

    // Sort players by score descending
    const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${medal} *${p.username}* - ${p.score} pts\n`;
    });

    const winner = gameManager.getWinner(game);
    if (winner) {
        text += `\n🎉 *Winner: ${winner.username}!*`;
    }

    return text;
}

function handleTurnStart(chatId: number, ctx: Context, game: GameState, isFirstTurn: boolean = false) {
    const player = game.players[game.currentPlayerIndex];

    // Check if current roll is already a farkle
    const scoringPossible = calculateScore(game.currentDice) > 0;

    if (!scoringPossible) {
        // Immediate Farkle!
        const farkleMsg = `💥 FARKLE! [${player.username}](tg://user?id=${player.id}) rolled no scoring dice.`;

        ctx.reply(farkleMsg, { parse_mode: 'Markdown' });

        // Move to next player
        gameManager.nextTurn(game);

        setTimeout(() => {
            handleTurnStart(chatId, ctx, game);
        }, 1500);
    } else {
        const { text, extra } = renderGameMessage(game);
        ctx.reply(text, extra).then(msg => game.messageId = msg.message_id);
    }
}

// --- Commands ---

bot.command('start', (ctx) => {
    ctx.reply('Welcome to Farkle! Use /play to create a lobby.');
});

bot.command('stop', (ctx) => {
    if (!ctx.chat) return;
    const chatId = ctx.chat.id;
    const game = gameManager.stopGame(chatId);

    if (!game) {
        ctx.reply('No active game to stop.');
        return;
    }

    const results = renderResults(game);
    ctx.reply(results, { parse_mode: 'Markdown' });
});

bot.command('play', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;
    let game = gameManager.getGame(chatId);

    // If no game, create lobby
    if (!game) {
        game = gameManager.createGame(chatId, ctx.from.id);
        // Auto-join creator
        gameManager.addPlayer(chatId, {
            id: ctx.from.id,
            username: ctx.from.first_name,
            score: 0
        });
        const { text, extra } = renderLobbyMessage(game);
        ctx.reply(text, extra).then(msg => {
            if (game) game.messageId = msg.message_id;
        });
    } else if (game.status === 'LOBBY') {
        const { text, extra } = renderLobbyMessage(game);
        ctx.reply('Lobby is already open:\n\n' + text, extra).then(msg => {
            // Update message ID to new one so we allow people to join on latest message
            if (game) game.messageId = msg.message_id;
        });
    } else {
        ctx.reply('Game is already in progress!');
    }
});

// --- Actions ---

bot.action('join_game', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);

    if (!game) {
        ctx.answerCbQuery('No game found.');
        return;
    }

    if (game.status !== 'LOBBY') {
        ctx.answerCbQuery('Game already started!');
        return;
    }

    const added = gameManager.addPlayer(chatId, {
        id: ctx.from.id,
        username: ctx.from.first_name,
        score: 0
    });

    if (added) {
        ctx.answerCbQuery('Joined!');
        const { text, extra } = renderLobbyMessage(game);
        ctx.editMessageText(text, extra).catch(() => { });
    } else {
        ctx.answerCbQuery('You are already in the game!');
    }
});

bot.action('start_game', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;
    const game = gameManager.getGame(chatId);

    if (!game) return;

    // Only creator check? Or current player?
    // Let's allow creator only.
    if (game.creatorId && ctx.from.id !== game.creatorId) {
        ctx.answerCbQuery('Only the host can start the game!');
        return;
    }

    if (game.players.length === 0) {
        ctx.answerCbQuery('Need at least 1 player!');
        return;
    }

    const result = gameManager.startGame(chatId);
    if (result.success) {
        ctx.answerCbQuery('Game started!');
        ctx.editMessageText(`🚀 Game Started!\n🎲 Roll dice. Take risks. Score big.`).catch(() => { });

        setTimeout(() => {
            handleTurnStart(chatId, ctx, game, true);
        }, 500);
    } else {
        ctx.answerCbQuery('Failed to start.');
    }
});

bot.action(/toggle_(\d+)/, (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;
    const idx = parseInt(ctx.match[1]);

    const success = gameManager.toggleLock(chatId, ctx.from.id, idx);

    if (success) {
        const game = gameManager.getGame(chatId);
        if (game) {
            const { text, extra } = renderGameMessage(game);
            ctx.editMessageText(text, extra).catch(() => { });
        }
    } else {
        ctx.answerCbQuery("Cannot toggle this/Not your turn!");
    }
});

bot.action('roll', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;

    const result = gameManager.confirmSelectionAndRoll(chatId, ctx.from.id);

    if (result.success) {
        const game = gameManager.getGame(chatId);
        if (game) {
            if (result.farkle) {
                ctx.answerCbQuery("FARKLE!");
                const player = game.players[game.currentPlayerIndex];
                ctx.editMessageText(`💥 FARKLE! [${player.username}](tg://user?id=${player.id}) rolled no scoring dice.`, {
                    parse_mode: 'Markdown'
                });

                // Start next turn with delay to avoid rate limit
                setTimeout(() => {
                    const { text, extra } = renderGameMessage(game);
                    ctx.reply(text, extra).then(msg => game.messageId = msg.message_id);
                }, 1500);
            } else {
                const { text, extra } = renderGameMessage(game);
                ctx.editMessageText(text, extra).catch(() => { });
            }
        }
    } else {
        ctx.answerCbQuery(result.message);
    }
});

bot.action('bank', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;
    const result = gameManager.bankPoints(chatId, ctx.from.id);

    if (result.success) {
        ctx.answerCbQuery(result.message);
        const game = gameManager.getGame(chatId);
        if (game) {
            // Check if game over
            if (result.gameOver) {
                ctx.editMessageText(`✅ ${ctx.from.first_name} banked ${result.bankedScore} points!\n\n🎊 Game Over!`);

                // Show results with delay
                setTimeout(() => {
                    const results = renderResults(game);
                    ctx.reply(results, { parse_mode: 'Markdown' });
                }, 500);
            } else {
                let msg = `✅ ${ctx.from.first_name} banked ${result.bankedScore} points!\n\n`;
                if (result.reachedWin) msg += `🎯 10,000 reached! Final round begins!`;
                ctx.editMessageText(msg);

                // Next turn with delay to avoid rate limit
                setTimeout(() => {
                    handleTurnStart(chatId, ctx, game, true);
                }, 1000);
            }
        }
    } else {
        ctx.answerCbQuery(result.message);
    }
});

export function launchBot() {
    bot.launch();
    console.log('Bot started!');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
