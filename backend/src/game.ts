export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export const DIE_EMOJIS: Record<DieValue, string> = {
    1: '1️⃣',
    2: '2️⃣',
    3: '3️⃣',
    4: '4️⃣',
    5: '5️⃣',
    6: '6️⃣',
};

export const DICE_CIRCLE_EMOJIS: Record<DieValue, string> = {
    1: '①',
    2: '②',
    3: '③',
    4: '④',
    5: '⑤',
    6: '⑥',
};

export function rollDice(count: number): DieValue[] {
    const dice: DieValue[] = [];
    for (let i = 0; i < count; i++) {
        dice.push((Math.floor(Math.random() * 6) + 1) as DieValue);
    }
    return dice;
}

export function calculateScore(dice: DieValue[]): number {
    if (dice.length === 0) return 0;

    const counts = new Map<number, number>();
    for (const d of dice) {
        counts.set(d, (counts.get(d) || 0) + 1);
    }

    let score = 0;

    // Check for Straight 1-6 (1500 pts)
    if (dice.length === 6 && counts.size === 6) {
        return 1500;
    }

    // Check for Two Triplets (2500 pts)
    // e.g., 1,1,1,2,2,2
    if (dice.length === 6) {
        const triplets = Array.from(counts.values()).filter(c => c === 3);
        if (triplets.length === 2) {
            return 2500;
        }
    }

    // Check for Four-of-a-kind and a pair (1500 pts)
    if (dice.length === 6) {
        let hasFour = false;
        let hasPair = false;
        for (const count of counts.values()) {
            if (count === 4) hasFour = true;
            if (count === 2) hasPair = true;
        }
        if (hasFour && hasPair) return 1500;
    }

    // Check for Three Pairs (1500 pts)
    if (dice.length === 6) {
        let distinctPairs = 0;
        for (const count of counts.values()) {
            if (count === 2) distinctPairs++;
        }
        if (distinctPairs === 3) return 1500;
    }

    // N-of-a-kind scoring
    for (const [num, count] of counts.entries()) {
        if (count >= 3) {
            // Three of a kind base scores
            let baseScore = 0;
            if (num === 1) baseScore = 1000;
            else if (num === 2) baseScore = 200;
            else if (num === 3) baseScore = 300;
            else if (num === 4) baseScore = 400;
            else if (num === 5) baseScore = 500;
            else if (num === 6) baseScore = 600;

            if (count === 3) {
                score += baseScore;
            } else if (count === 4) {
                score += 1000;
            } else if (count === 5) {
                score += 2000;
            } else if (count === 6) {
                score += 3000;
            }
        } else {
            // Individual 1s and 5s (only if not part of a set)
            if (num === 1) score += count * 100;
            if (num === 5) score += count * 50;
        }
    }

    return score;
}

/**
 * Validates that every die in the selection contributes to the score.
 * Returns true only if removing any single die would decrease the total score.
 * This ensures players can't select non-scoring dice (like 2,3,4,6 when they don't form combos).
 */
export function validateSelection(selectedDice: DieValue[]): boolean {
    const totalScore = calculateScore(selectedDice);
    if (totalScore === 0) return false;

    // Check that each die contributes to the score
    for (let i = 0; i < selectedDice.length; i++) {
        // Create array without this die
        const withoutThis = [...selectedDice.slice(0, i), ...selectedDice.slice(i + 1)];
        const scoreWithout = calculateScore(withoutThis);

        if (scoreWithout >= totalScore) {
            // Removing this die doesn't decrease score, so it doesn't contribute
            return false;
        }
    }

    return true;
}

export function isWinningRoll(dice: DieValue[]): boolean {
    // 6 ones = 3000 pts now, not instant win anymore
    return false;
}
