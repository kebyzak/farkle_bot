import { Telegraf, Markup, Context } from 'telegraf';
import { GameManager, GameState } from './gameManager';
import { DICE_CIRCLE_EMOJIS, DIE_EMOJIS, DieValue, calculateScore } from './game';
import * as dotenv from 'dotenv';
import { start } from 'repl';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || '');
const gameManager = new GameManager();

// --- Rate Limit Queue ---

class RateLimitQueue {
    private queue: { task: () => Promise<any>, resolve: (v: any) => void, reject: (e: any) => void }[] = [];
    private processing = false;

    add<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    private async process() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            if (!item) break;

            try {
                const result = await this.executeWithRetry(item.task);
                item.resolve(result);
            } catch (e: any) {
                // Ignore "message is not modified" errors (harmless)
                if (e.response && e.response.error_code === 400 && e.response.description && e.response.description.includes('message is not modified')) {
                    // console.warn("⚠️ Message not modified (ignoring).");
                    item.resolve(null);
                } else {
                    console.error("Task failed permanently:", e);
                    item.reject(e);
                }
            }

            // Global throttle buffer to be safe (e.g., 100ms between processing attempts)
            // Telegram allows ~30 messages/second generally, but bursts can trigger limits.
            // 350ms ensures we don't exceed ~3 msg/sec easily which is safe for group chats.
            await new Promise(resolve => setTimeout(resolve, 350));
        }

        this.processing = false;
    }

    private async executeWithRetry(task: () => Promise<any>, attempts = 0): Promise<any> {
        const MAX_RETRIES = 5;
        try {
            return await task();
        } catch (e: any) {
            // Check for 429 Too Many Requests
            if (e.response && e.response.error_code === 429) {
                const retryAfter = (e.response.parameters && e.response.parameters.retry_after) || 5;
                console.warn(`⚠️ 429 Rate Limit Hit. Sleeping for ${retryAfter}s...`);

                // Wait for the requested time + small buffer
                await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));

                // Retry
                return this.executeWithRetry(task, attempts + 1);
            }

            // Other errors
            throw e;
        }
    }
}

const msgQueue = new RateLimitQueue();

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

    // Check if start of turn (no dice rolled)
    if (game.currentDice.length === 0) {
        text += `Ready to roll!`;

        const buttonRows: any[][] = [];
        const actionRow = [
            Markup.button.callback('🎲 Roll', 'roll')
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

    text += `Select dice to keep:`;

    const diceRow: any[] = game.currentDice.map((val, idx) => {
        const isLocked = game.lockedIndices.includes(idx);
        const btnText = isLocked ? `✅ ${DIE_EMOJIS[val]}` : `${DIE_EMOJIS[val]}`;
        return Markup.button.callback(btnText, `toggle_${idx}`);
    });

    const buttonRows: any[][] = [];
    for (let i = 0; i < diceRow.length; i += 3) {
        buttonRows.push(diceRow.slice(i, i + 3));
    }

    const actionRow = [
        Markup.button.callback('🎲 Roll', 'roll'),
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
    // Just render the game message (which will show "Start Roll" state)
    const { text, extra } = renderGameMessage(game);
    msgQueue.add(() => ctx.reply(text, extra))
        .then(msg => game.messageId = msg.message_id)
        .catch(console.error);
}

// --- Commands ---

bot.action('noop', (ctx) => {
    ctx.answerCbQuery();
});

bot.command('start', (ctx) => {
    msgQueue.add(() => ctx.reply('Welcome to Farkle! Use /play to create a lobby or /help to see the rules.'));
});

bot.command('help', (ctx) => {
    const helpMsg = `🎲 *Farkle Rulebook*

*Objective:* Be the first player to reach *10,000 points*.

*Gameplay:*
1. Roll 6 dice to start your turn.
2. You must select at least one "scoring die" to continue.
3. After selecting, you can:
   • *Roll Again:* Roll the remaining dice to increase your turn score.
   • *Bank:* Save your current turn score and end your turn.
4. *Farkle:* If a roll contains no scoring dice, you lose all points accumulated during that turn.
5. *Hot Dice:* If all 6 dice become scoring dice, you can roll all 6 again and keep adding to your score!

*Scoring Combinations:*
• 1️⃣ = 100 pts
• 5️⃣ = 50 pts
• Three 1's = 300 pts
• Three 2's = 200 pts
• Three 3's = 300 pts
• Three 4's = 400 pts
• Three 5's = 500 pts
• Three 6's = 600 pts
• 4-of-a-kind = 1000 pts
• 5-of-a-kind = 2000 pts
• 6-of-a-kind = 3000 pts

*Special 6-Dice Combos:*
• *Straight (1-6):* 1500 pts
• *Three Pairs:* 1500 pts
• *Two Triplets:* 2500 pts
• *4-of-a-kind + Pair:* 1500 pts`;

    ctx.reply(helpMsg, { parse_mode: 'Markdown' });
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
    msgQueue.add(() => ctx.reply(results, { parse_mode: 'Markdown' }));
});

bot.command('play', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;
    let game = gameManager.getGame(chatId);

    // If no game or game is finished, create lobby
    if (!game || game.status === 'FINISHED') {
        game = gameManager.createGame(chatId, ctx.from.id);
        // Auto-join creator
        gameManager.addPlayer(chatId, {
            id: ctx.from.id,
            username: ctx.from.first_name,
            score: 0
        });
        const { text, extra } = renderLobbyMessage(game);
        msgQueue.add(() => ctx.reply(text, extra)).then(msg => {
            if (game) game.messageId = msg.message_id;
        });
    } else if (game.status === 'LOBBY') {
        const { text, extra } = renderLobbyMessage(game);
        msgQueue.add(() => ctx.reply('Lobby is already open:\n\n' + text, extra)).then(msg => {
            // Update message ID to new one so we allow people to join on latest message
            if (game) game.messageId = msg.message_id;
        });
    } else {
        msgQueue.add(() => ctx.reply('Game is already in progress!'));
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
        msgQueue.add(() => ctx.editMessageText(text, extra)).catch(() => { });
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
        msgQueue.add(() => ctx.editMessageText(`🚀 Game Started!\n🎲 Roll dice. Take risks. Score big.`)).catch(() => { });

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
            msgQueue.add(() => ctx.editMessageText(text, extra)).catch(() => { });
        }
    } else {
        ctx.answerCbQuery("Cannot toggle this/Not your turn!");
    }
});

bot.action('roll', (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id;

    // Check if it's initial roll or reroll
    const game = gameManager.getGame(chatId);
    if (!game) return;

    let result;
    if (game.currentDice.length === 0) {
        result = gameManager.rollInitial(chatId, ctx.from.id);
    } else {
        result = gameManager.confirmSelectionAndRoll(chatId, ctx.from.id);
    }

    if (result.success) {
        if (result.farkle) {
            ctx.answerCbQuery("FARKLE!");
            const player = { username: ctx.from.first_name, id: ctx.from.id };

            // 1. Show the dice that caused Farkle
            // We append a small note, but mostly show the dice state
            const { text, extra } = renderGameMessage(game);
            const failText = text + "\n\n💥 FARKLE! No scoring dice.";
            msgQueue.add(() => ctx.editMessageText(failText, extra)).catch(() => { });

            // 2. Wait 2 seconds then show Farkle message and switch turn
            setTimeout(() => {
                if (result.gameOver) {
                    msgQueue.add(() => ctx.editMessageText(`💥 FARKLE! [${player.username}](tg://user?id=${player.id}) rolled no scoring dice.\n\n🎊 Game Over!`, {
                        parse_mode: 'Markdown'
                    }));

                    // Show results with delay
                    setTimeout(() => {
                        const results = renderResults(game);
                        msgQueue.add(() => ctx.reply(results, { parse_mode: 'Markdown' }));
                    }, 1500);
                } else {
                    msgQueue.add(() => ctx.editMessageText(`💥 FARKLE! [${player.username}](tg://user?id=${player.id}) rolled no scoring dice.`, {
                        parse_mode: 'Markdown'
                    }));

                    // Update state to next player
                    gameManager.nextTurn(game);

                    // Start next turn with delay
                    setTimeout(() => {
                        handleTurnStart(chatId, ctx, game);
                    }, 1500);
                }
            }, 2000);

        } else {
            // Normal roll success
            const { text, extra } = renderGameMessage(game);
            msgQueue.add(() => ctx.editMessageText(text, extra)).catch(() => { });
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
                msgQueue.add(() => ctx.editMessageText(`✅ ${ctx.from!.first_name} banked ${result.bankedScore} points!\n\n🎊 Game Over!`));

                // Show results with delay
                setTimeout(() => {
                    const results = renderResults(game);
                    msgQueue.add(() => ctx.reply(results, { parse_mode: 'Markdown' }));
                }, 500);
            } else {
                let msg = `✅ ${ctx.from!.first_name} banked ${result.bankedScore} points!\n\n`;
                if (result.reachedWin) msg += `🎯 10,000 reached! Final round begins!`;
                msgQueue.add(() => ctx.editMessageText(msg));

                // Next turn with delay to avoid rate limit
                setTimeout(() => {
                    // This function already uses msgQueue inside
                    handleTurnStart(chatId, ctx, game, true);
                }, 1000);
            }
        }
    } else {
        ctx.answerCbQuery(result.message);
    }
});

export function launchBot() {
    bot.telegram.setMyCommands([
        { command: 'play', description: 'Start a new game' },
        { command: 'help', description: 'Show rules and scoring' },
        { command: 'stop', description: 'Stop the current game' }
    ]);

    bot.launch();
    console.log('Bot started and commands registered!');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
