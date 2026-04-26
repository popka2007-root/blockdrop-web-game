# Архитектурная рефакторизация BlockDrop Web Game

## Цель
Упростить архитектуру проекта, разделить ответственность модулей, улучшить maintainability и подготовить кодовую базу к масштабированию. **Без переписывания всей игры** — инкрементальные улучшения.

## Принципы
- Слабая связанность модулей (loose coupling)
- Единый источник истины для состояния (single source of truth)
- DRY — не повторяем магические числа и конфигурации
- Каждый файл отвечает за одно (single responsibility)
- Обратная совместимость — не ломаем текущую функциональность

---

## Этап 1: Конфигурация режимов (неделя 1)

### 1.1 Создать `js/modes.js`
Файл должен описывать все параметры игровых режимов в одном месте.

**Требования:**
- Включить все режимы: Classic, Sprint (40 Lines), Zen, Chaos
- Каждый режим должен иметь:
  - `name` — отображаемое имя
  - `goal` — цель режима (для UI)
  - `levelUp` — количество линий для повышения уровня
  - `startLevel`, `startLines` — начальные значения
  - `gravity` — есть ли гравитация
  - `garbageAttacks` — включены ли атаки мусора
  - `timeLimit` — лимит времени (null если нет)
  - `targetLines` — целевое количество линий (null если нет)
  - `description` — для Help экрана

**Пример структуры:**
```javascript
export const GAME_MODES = {
  classic: { name: 'Классика', goal: 'Выжить', levelUp: 10, startLevel: 1, startLines: 0, gravity: true, garbageAttacks: false, timeLimit: null, targetLines: null, description: '...' },
  sprint: { name: '40 линий', goal: 'Очистить 40 линий', levelUp: 10, startLevel: 1, startLines: 0, gravity: true, garbageAttacks: false, timeLimit: null, targetLines: 40, description: '...' },
  zen: { name: 'Дзен', goal: 'Без спешки', levelUp: 10, startLevel: 1, startLines: 0, gravity: false, garbageAttacks: false, timeLimit: null, targetLines: null, description: '...' },
  chaos: { name: 'Хаос', goal: 'Пережить атаки', levelUp: 5, startLevel: 1, startLines: 0, gravity: true, garbageAttacks: true, timeLimit: null, targetLines: null, description: '...' }
};

export function getModeConfig(modeKey) {
  return GAME_MODES[modeKey] || GAME_MODES.classic;
}
```

**Где использовать:**
- `js/game.js` — инициализация режима вместо if/switch
- `index.html` — динамическое заполнение select'а режимов
- тесты — легче конфигурировать разные режимы

### 1.2 Расширить `js/config.js`
Добавить физические константы и параметры, которые сейчас разбросаны по коду.

**Добавить:**
- `TIMING` — частота кадров, гравитация, lock delay и т.д.
- `PHYSICS` — скорости падения, движения
- `UI` — длительности анимаций, toasts
- `SCORING_THRESHOLDS` — для достижений

**Пример:**
```javascript
export const TIMING = {
  FRAME_MS: 16.67,
  GRAVITY_BASE: 1,
  LOCK_DELAY_MS: 480,
  DAS_MS: 140,
  ARR_MS: 36
};

export const UI = {
  TOAST_DURATION_MS: 2000,
  ANIMATION_DURATION_MS: 300,
  COMBO_DECAY_MS: 1000
};

export const PHYSICS = {
  SOFT_DROP_SPEED: 5,
  HARD_DROP_SPEED: 20
};
```

**Где использовать:**
- Вместо magic numbers в `js/game.js`
- В настройках — пользователь может менять DAS/ARR

---

## Этап 2: Кэширование DOM (неделя 1)

### 2.1 Создать DOM reference cache в `js/ui.js`
В начале файла инициализировать объект со всеми часто используемыми элементами.

**Требования:**
- Один раз на загрузке вызвать `querySelector`/`getElementById`
- Сохранить в объект `const DOM = { ... }`
- Везде в коде использовать `DOM.element` вместо `document.getElementById`

**Пример:**
```javascript
const DOM = {
  // Topbar
  scoreValue: document.getElementById('scoreValue'),
  levelValue: document.getElementById('levelValue'),
  linesValue: document.getElementById('linesValue'),
  
  // Game
  board: document.getElementById('board'),
  boardCtx: document.getElementById('board').getContext('2d'),
  
  // Side panels
  nextCanvases: [
    document.getElementById('next1'),
    document.getElementById('next2'),
    document.getElementById('next3')
  ],
  holdCanvas: document.getElementById('hold'),
  
  // Stats
  recordValue: document.getElementById('recordValue'),
  timeValue: document.getElementById('timeValue'),
  
  // Overlays
  overlays: {
    start: document.getElementById('startOverlay'),
    pause: document.getElementById('pauseOverlay'),
    gameOver: document.getElementById('gameOverOverlay'),
  },
  
  // Buttons
  startButton: document.getElementById('startButton'),
  pauseButton: document.getElementById('pauseButton'),
};

export { DOM };

// Использование везде:
// Вместо: document.getElementById('scoreValue').textContent = score
// Теперь: DOM.scoreValue.textContent = score
```

**Плюсы:**
- Перформанс +15-20% (нет querySelector каждый кадр)
- Одна точка для обновления всех ссылок
- Автодополнение в IDE

---

## Этап 3: Event Bus (неделя 2)

### 3.1 Создать `js/event-bus.js`
Простая система событий для связи между модулями без прямых вызовов.

**Требования:**
- Методы: `on(event, handler)`, `emit(event, data)`, `off(event, handler)`
- Поддержка одноразовых подписок: `once(event, handler)`
- Для отладки: логирование всех событий (если включен debug режим)

**Пример:**
```javascript
export class EventBus {
  constructor() {
    this.events = new Map();
  }

  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push({ handler, once: false });
    return this;
  }

  once(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push({ handler, once: true });
    return this;
  }

  emit(event, data) {
    if (localStorage.getItem('debug-tetris')) {
      console.log(`[EVENT] ${event}`, data);
    }
    if (!this.events.has(event)) return;
    
    const handlers = this.events.get(event);
    this.events.set(event, 
      handlers.filter(h => {
        h.handler(data);
        return !h.once;
      })
    );
  }

  off(event, handler) {
    if (!this.events.has(event)) return;
    const handlers = this.events.get(event);
    this.events.set(event, 
      handlers.filter(h => h.handler !== handler)
    );
  }
}

export const bus = new EventBus();
```

**События для подписки:**
- `game:started` — игра начата
- `game:scoreChanged` — счёт изменился
- `game:lineCleared` — очищены линии
- `game:levelUp` — повышение уровня
- `game:paused` — игра на паузе
- `game:gameOver` — конец игры
- `ui:modalOpened` — открыта модаль
- `audio:play` — проиграть звук
- `settings:changed` — изменена настройка

**Миграция:**
- Вместо: `gameUI.updateScore(score)` → `bus.emit('game:scoreChanged', { score })`
- Вместо: `audio.playSound('lineClear')` → `bus.emit('audio:play', { name: 'lineClear' })`

---

## Этап 4: Game State Manager (неделя 3)

### 4.1 Создать `js/game-state.js`
Единое хранилище состояния игры.

**Требования:**
- Инкапсулировать все переменные состояния
- Методы для изменения состояния с уведомлением event bus
- Сохранение и загрузка состояния (для автосейва)
- История состояний для отката (опционально)

**Пример:**
```javascript
import { bus } from './event-bus.js';

export class GameState {
  constructor(modeConfig) {
    this.mode = modeConfig;
    this.score = 0;
    this.level = modeConfig.startLevel;
    this.lines = 0;
    this.board = makeBoard();
    this.active = null;
    this.queue = [];
    this.hold = null;
    this.holdUsed = false;
    this.combo = 0;
    this.isPaused = false;
    this.isGameOver = false;
    
    this.stats = {
      pieces: 0,
      time: 0,
      maxHeight: 0,
      lineClears: 0
    };
  }

  updateScore(delta) {
    const oldScore = this.score;
    this.score += delta;
    if (this.score !== oldScore) {
      bus.emit('game:scoreChanged', { score: this.score, delta });
    }
  }

  updateLines(count) {
    this.lines += count;
    this.stats.lineClears += count;
    bus.emit('game:linesCleared', { count, totalLines: this.lines });
  }

  levelUp() {
    this.level++;
    bus.emit('game:levelUp', { level: this.level });
  }

  setPaused(paused) {
    this.isPaused = paused;
    bus.emit(paused ? 'game:paused' : 'game:resumed', {});
  }

  setGameOver() {
    this.isGameOver = true;
    bus.emit('game:gameOver', { 
      score: this.score, 
      level: this.level,
      lines: this.lines,
      stats: this.stats
    });
  }

  toJSON() {
    return {
      mode: this.mode.name,
      score: this.score,
      level: this.level,
      lines: this.lines,
      stats: this.stats,
      savedAt: new Date().toISOString()
    };
  }

  static fromJSON(data, modeConfig) {
    const state = new GameState(modeConfig);
    Object.assign(state, data);
    return state;
  }
}
```

---

## Этап 5: Утилиты (параллельно)

### 5.1 Создать `js/utils.js`
Вспомогательные функции для форматирования и валидации.

**Пример:**
```javascript
export const format = {
  score: (n) => n.toLocaleString('ru-RU'),
  
  time: (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  },
  
  level: (n) => `Уровень ${n}`,
  lines: (n) => `${n} линий`,
  combo: (n) => n > 1 ? `${n}x комбо!` : '',
  percentage: (n) => `${Math.round(n * 100)}%`,
  truncate: (str, len) => str.length > len ? str.slice(0, len) + '...' : str
};

export const validate = {
  roomName: (name) => /^[A-Z0-9]{1,16}$/.test(name),
  playerName: (name) => name.length >= 1 && name.length <= 18,
  score: (n) => Number.isInteger(n) && n >= 0
};

export const calc = {
  progress: (current, target) => Math.min(current / target, 1),
  nextLevel: (currentLines, threshold) => threshold - (currentLines % threshold),
  comboMultiplier: (combo) => Math.min(1 + combo * 0.1, 3)
};
```

---

## Этап 6: CSS переменные

### 6.1 Расширить `styles.css`
Добавить недостающие переменные для единства дизайна.

**Добавить в `:root`:**
```css
/* Duration */
--duration-fast: 180ms;
--duration-normal: 300ms;
--duration-slow: 500ms;

/* Border radius */
--radius-small: 6px;
--radius-normal: 8px;
--radius-large: 12px;

/* Shadows */
--shadow-light: 0 5px 15px rgba(0, 0, 0, 0.1);
--shadow-normal: 0 14px 36px var(--shadow);
--shadow-heavy: 0 28px 80px rgba(0, 0, 0, 0.42);

/* Transitions */
--transition-smooth: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-bounce: all 300ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
```

---

## Этап 7: Документация

### 7.1 Обновить README
Добавить раздел с архитектурой проекта.

**Добавить в README:**

```markdown
## Архитектура модулей

### Слой игровой логики
- **`js/game-core.js`** — чистая логика Тетриса (без побочных эффектов)
  - Генерация фигур, проверка коллизий, очистка линий, SRS
  - Функции экспортируют новое состояние, ничего не меняют

- **`js/config.js`** — все константы игры
  - Форм блоков, таблицы очков, физические параметры
  - Нет магических чисел в коде

- **`js/modes.js`** — конфигурация игровых режимов
  - Параметры Classic, Sprint, Zen, Chaos
  - Легко добавлять новые режимы

### Слой состояния
- **`js/game-state.js`** — управление состоянием игры
  - Единый источник истины
  - Методы для безопасного изменения состояния
  - Интеграция с event bus для уведомлений

### Слой взаимодействия
- **`js/game.js`** — основной игровой цикл
  - Оркестрация между модулями
  - RequestAnimationFrame и таймеры

- **`js/input.js`** — обработка ввода (клавиатура, мышь, сенсор)

- **`js/ui.js`** — отрисовка интерфейса
  - Canvas отрисовка доски
  - DOM обновления, модали

- **`js/audio.js`** — звуки и вибрация (Web Audio API)

- **`js/online.js`** — мультиплеер (WebSocket)

- **`js/storage.js`** — локальное хранилище

### Вспомогательный слой
- **`js/event-bus.js`** — система событий (слабая связанность модулей)
- **`js/utils.js`** — утилиты (форматирование, валидация, математика)

---

## Добавление новой фичи (пример)

Чтобы добавить новый режим:

1. **Добавить конфиг в `modes.js`:**
   ```javascript
   survival: { name: 'Survival', goal: 'Выжить 3 минуты', /* ... */ }
   ```

2. **Добавить опцию в select (`index.html`)** — может быть автоматически через JS

3. **Может быть, добавить логику в `game.js`** — если режим требует специального поведения

4. **Готово!** Event bus и game state работают одинаково для всех режимов
```

---

## Критерии успеха

✅ Код чище, без дублирования  
✅ Легче добавлять новые режимы и фичи  
✅ Модули слабо связаны между собой  
✅ Тесты пишутся проще  
✅ Новичкам легче разобраться в коде  
✅ Перформанс не деградирует  
✅ Обратная совместимость — всё работает как раньше  

---

## Timeline

| Этап | Дней | Статус |
|------|------|--------|
| 1. Modes + Config | 5-7 | ⏳ |
| 2. DOM Cache | 2-3 | ⏳ |
| 3. Event Bus | 5-7 | ⏳ |
| 4. Game State | 7-10 | ⏳ |
| 5. Utils | 3-5 | ⏳ |
| 6. CSS vars | 1-2 | ⏳ |
| 7. Документация | 2-3 | ⏳ |
| **ИТОГО** | **25-37 дней** | |

**Можно делать параллельно (этапы 5, 6, 7)**

---

## Notes

- Каждый этап должен оставлять игру в рабочем состоянии
- Писать тесты параллельно
- Code review после каждого этапа
- Обновлять документацию после завершения этапа
- Каждый коммит должен быть логически завершён
