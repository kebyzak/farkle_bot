# Farkle Telegram Bot Plan

## 1. Project Setup
- [x] Initialize `backend` with `package.json`.
- [x] Install dependencies: `telegraf`, `typescript`, `ts-node`, `dotenv`.
- [x] Configure `tsconfig.json`.

## 2. Core Game Logic
- [x] **Dice Logic**:
    - [x] `rollDice(count: number): number[]`
    - [x] Emoji mapping for dice (⚀ ⚁ ⚂ ⚃ ⚄ ⚅).
- [x] **Scoring System**:
    - [x] `calculateScore(dice: number[]): number`
    - [x] Rules implementation:
        - 1 = 100
        - 5 = 50
        - Three of a kind (X * 100, except 1s = 1000)
        - 4, 5, 6 of a kind (doubling previous)
        - Three pairs = 1000
        - Straight 1-6 = 1500.
        - Straight 1-5 or 2-6 = 500.
        - Win condition: 10,000 points.
- [x] **Game State Machine**:
    - [x] States: `LOBBY`, `PLAYER_TURN_ROLL`, `PLAYER_TURN_SELECT`, `GAME_OVER` (Handled in `GameManager`).
    - [x] Methods to handle transitions.

## 3. Bot Interface
- [x] **Commands**:
    - [x] `/start` - Welcome.
    - [x] `/play` - Start/Join game.
- [x] **Interactive Elements**:
    - [x] Display dice with emojis.
    - [x] Inline buttons for selecting dice to keep.
    - [x] "Roll Again" and "Bank Points" buttons.
    - [x] Visual updates (edit message instead of spamming).

## 4. Polishing
- [x] Multiplayer support (store players in a session).
- [x] Turn management.
- [x] Win condition check.
