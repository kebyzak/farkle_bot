import { Context } from 'telegraf';
import { rollDice, calculateScore, validateSelection, DieValue, DIE_EMOJIS, DICE_CIRCLE_EMOJIS } from './game';

export interface Player {
    id: number;
    username: string;
    score: number;
}

export type GameStatus = 'LOBBY' | 'PLAYING' | 'FINISHED';

export interface GameState {
    players: Player[];
    currentPlayerIndex: number;
    currentDice: DieValue[];
    lockedIndices: number[];
    turnScore: number;
    accumulatedScore: number;
    status: GameStatus;
    chatId: number;
    messageId?: number; // Id of the game message to update
    creatorId?: number; // Id of the player who created the game
    finalRound?: boolean; // Someone reached 10k, final round in progress
    firstToReach10k?: number; // Player index who first reached 10k
}

export class GameManager {
    private games: Map<number, GameState> = new Map();

    getGame(chatId: number): GameState | undefined {
        return this.games.get(chatId);
    }

    createGame(chatId: number, creatorId: number): GameState {
        const game: GameState = {
            players: [],
            currentPlayerIndex: 0,
            currentDice: [],
            lockedIndices: [],
            turnScore: 0,
            accumulatedScore: 0,
            status: 'LOBBY',
            chatId,
            creatorId,
        };
        this.games.set(chatId, game);
        return game;
    }

    addPlayer(chatId: number, player: Player): boolean {
        let game = this.games.get(chatId);
        // If no game, CREATE it (implicit create on join/play if not exists? User wanted /play to create lobby)
        // But here we rely on createGame being called first usually?
        // Let's allow implicit creation if we want, but better to return false if no game exists
        // actually bot.ts handles checking existence.

        if (!game) return false;

        if (game.status !== 'LOBBY') return false; // Cannot join running game

        if (!game.players.find(p => p.id === player.id)) {
            game.players.push(player);
            return true;
        }
        return false; // Already joined
    }

    startGame(chatId: number): { success: boolean, farkle?: boolean } {
        const game = this.games.get(chatId);
        if (!game || game.players.length === 0) return { success: false };

        game.status = 'PLAYING';
        game.currentPlayerIndex = 0;
        const isFarkle = this.startTurn(game);
        return { success: true, farkle: isFarkle };
    }

    startTurn(game: GameState): boolean {
        // Reset turn state
        game.turnScore = 0;
        game.accumulatedScore = 0;
        game.lockedIndices = [];
        // First roll is 6 dice
        game.currentDice = rollDice(6);
        return calculateScore(game.currentDice) === 0;
    }

    toggleLock(chatId: number, userId: number, dieIndex: number): boolean {
        const game = this.games.get(chatId);
        if (!game || game.status !== 'PLAYING') return false;

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== userId) return false;

        if (game.lockedIndices.includes(dieIndex)) {
            game.lockedIndices = game.lockedIndices.filter(i => i !== dieIndex);
        } else {
            game.lockedIndices.push(dieIndex);
        }
        return true;
    }

    // Returns true if valid move (reroll successful)
    // Returns false if invalid selection (no scoring dice) or farkle
    confirmSelectionAndRoll(chatId: number, userId: number): { success: boolean, message: string, farkle?: boolean } {
        const game = this.games.get(chatId);
        if (!game || game.status !== 'PLAYING') return { success: false, message: 'Game not active' };

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== userId) return { success: false, message: 'Not your turn' };

        if (game.lockedIndices.length === 0) {
            return { success: false, message: 'Select at least one scoring die!' };
        }

        // Validate selection - ensure each die contributes to score
        const selectedDice = game.lockedIndices.map(i => game.currentDice[i]);

        if (!validateSelection(selectedDice)) {
            return { success: false, message: 'Invalid selection! Only select dice that score.' };
        }

        const score = calculateScore(selectedDice);

        // Check if user selected ALL scoring dice?
        // Usually you can select a subset, but that subset must score.
        // My calculateScore logic might handle subsets correctly if the subset itself is valid.
        // e.g. Roll 1, 5, 2. Select 1. Score 100. Valid.
        // Select 2. Score 0. Invalid.

        // Add score
        game.accumulatedScore += score;

        // Count remaining dice
        const remainingCount = game.currentDice.length - game.lockedIndices.length;

        // If 0 remaining (Hot Dice!), user gets 6 new dice.
        let nextCount = remainingCount;
        if (nextCount === 0) {
            nextCount = 6;
        }

        // Reroll
        const newDice = rollDice(nextCount);
        game.currentDice = newDice;
        game.lockedIndices = []; // Reset selection for new roll

        // Check for FARKLE (no scoring combos in NEW roll)
        // Wait, "Farkle" means NO SCORING DICE in the *new* roll.
        // So we need to check if proper max score of new roll is > 0.
        // Or specific dice?
        // Usually Farkle happens if you roll and get 0 potential points.
        // We can check this by passing all dice to calculateScore?
        // Wait, calculateScore(allDice) might return 0 if no scoring dice.
        // But calculateScore logic is tricky with combinations.
        // Simplest check:
        // Any 1s? Yes -> score.
        // Any 5s? Yes -> score.
        // Any triples? Yes -> score.
        // Straight? Yes.
        // Pairs? Yes.
        // If calculateScore(newDice) > 0 does NOT mean there are scoring dice?
        // Wait, `calculateScore` returns total score of the hand. 
        // If the hand has absolutely no scoring features, it returns 0.
        // So yes, `calculateScore(newDice) === 0` implies Farkle.

        const potentialScore = calculateScore(newDice);
        if (potentialScore === 0) {
            // FARKLE!
            game.accumulatedScore = 0; // Lost turn score
            this.nextTurn(game);
            return { success: true, message: 'FARKLE!', farkle: true };
        }

        return { success: true, message: 'Rolled!' };
    }

    bankPoints(chatId: number, userId: number): { success: boolean, message: string, gameOver?: boolean, reachedWin?: boolean, bankedScore?: number } {
        const game = this.games.get(chatId);
        if (!game || game.status !== 'PLAYING') return { success: false, message: 'Game not active' };

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== userId) return { success: false, message: 'Not your turn' };

        // Must have some accumulated score OR selected dice to score now.
        // Usually "Bank" means stop rolling.
        // If there are currently locked dice, we score them and then bank.
        // If no locked dice, we bank `accumulatedScore`.
        // But wait, user needs to lock dice first usually?
        // Or can they just roll, see dice, and say "Bank" (taking all scoring dice?)?
        // User rules: "Lock any dice... then roll again... When you decide to stop... record your points."
        // Usually you select dice -> Add to temp score -> decide to Roll or Bank.
        // So the flow should be:
        // 1. Roll.
        // 2. Select Dice (Lock).
        // 3. EITHER "Roll Again" (confirms selection, rolls remaining) OR "Bank" (confirms selection, adds to total, next turn).

        if (game.lockedIndices.length > 0) {
            const selectedDice = game.lockedIndices.map(i => game.currentDice[i]);

            if (!validateSelection(selectedDice)) {
                return { success: false, message: 'Invalid selection! Only select dice that score.' };
            }

            const score = calculateScore(selectedDice);
            game.accumulatedScore += score;
        } else if (game.accumulatedScore === 0) {
            return { success: false, message: 'Nothing to bank!' };
        }

        currentPlayer.score += game.accumulatedScore;
        const savedScore = game.accumulatedScore;

        let reachedWin = false;
        // Check win condition
        if (currentPlayer.score >= 10000 && !game.finalRound) {
            // Trigger final round - everyone else gets one more turn
            game.finalRound = true;
            game.firstToReach10k = game.currentPlayerIndex;
            reachedWin = true;
        }

        this.nextTurn(game);

        // Check if final round complete (everyone had their last turn)
        if (game.finalRound && game.currentPlayerIndex === game.firstToReach10k) {
            game.status = 'FINISHED';
            return { success: true, message: `Banked ${savedScore}! Game Over!`, gameOver: true, bankedScore: savedScore };
        }

        return { success: true, message: `Banked ${savedScore}!${reachedWin ? ' 🎯 10k reached! Final round!' : ''}`, reachedWin, bankedScore: savedScore };
    }

    nextTurn(game: GameState): boolean {
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
        return this.startTurn(game);
    }

    stopGame(chatId: number): GameState | undefined {
        const game = this.games.get(chatId);
        if (!game) return undefined;

        game.status = 'FINISHED';
        return game;
    }

    getWinner(game: GameState): Player | undefined {
        if (game.players.length === 0) return undefined;
        return game.players.reduce((prev, current) =>
            current.score > prev.score ? current : prev
        );
    }
}
