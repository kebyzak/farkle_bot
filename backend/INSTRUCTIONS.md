# Farkle Telegram Bot Instructions

## 1. Setup
1. Create a bot using BotFather on Telegram (@BotFather) and get your `BOT_TOKEN`.
2. Rename `.env.example` to `.env` and paste your token inside.
3. Install dependencies:
   ```bash
   npm install
   ```

## 2. Running
For development (restart on change using nodemon if installed, or just simple run):
```bash
npm start
```
Or build and run:
```bash
npm run build
node dist/index.js
```

## 3. How to Play
1. Add the bot to a group chat.
2. Send `/play` to start a game or join one.
3. When it's your turn:
   - Use the inline buttons to select scoring dice (✅ marks selected).
   - Press "🔄 Roll Again" to score selected dice and roll remaining.
   - Press "💰 Bank" to score selected dice and end turn, adding points to total.
   - If you roll no scoring dice -> FARKLE! (0 points this turn).

## Note on Logic
- "3 Pairs" rule is implemented (1000 pts).
- "Straight 1-6" rule is implemented (1500 pts).
- "6 of a kind" wins instantly (10000 pts).
- Hot Dice rule is implemented (use all 6 -> get 6 new).
