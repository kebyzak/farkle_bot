# Используем Node.js как базовый образ
FROM node:18-slim

# Создаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Собираем TypeScript код
RUN npm run build

# Команда для запуска бота
CMD ["npm", "start"]
