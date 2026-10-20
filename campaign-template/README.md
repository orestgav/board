# Моя кампанія

База знань кампанії D&D 5e у Markdown, у форматі [дошки кампанії](https://github.com/orestgav/board).
Відкривається на https://orestgav.github.io/board/ → **«Обрати теку кампанії»** → ця тека.

## Структура

- `world_data/` — дані світу:
  - `players/` — персонажі гравців (type: `player`)
  - `npcs/` — NPC (type: `npc`)
  - `locations/` — локації (type: `location`)
  - `world/` — глобальний лор (type: `world`)
  - `factions/` — фракції (type: `faction`)
  - `sessions/` — записи сесій (type: `session`)
  - `bestiary/` — статблоки (type: `creature`)
  - `items/` — предмети (type: `item`)
  - `encounters/` — сутички (type: `encounter`)
- `ai-context/` — службовий контекст для AI; формат метаданих — `ai-context/SCHEMA.md`
- `_media/` — портрети й арти карток (WebP, Git LFS): `npcs/`, `locations/`, `items/`, `creatures/`, `maps/`
- `_templates/` — порожні шаблони сутностей
- `board/` — розкладка дошки (`canvas.json` зʼявиться після першої зміни), нотатки на картах і медіа полотна
- `board.config.json` — налаштування дошки для цієї кампанії

Підпапки — лише розкладка по полицях: посилання `[[слаг]]` шляху не знають, а
дошка й валідатор орієнтуються на `type:` у YAML.

## Як працювати з AI

Правила роботи — `ai-context/AI_INSTRUCTIONS.md`. Порядок читання перед відповіддю чи оновленням:

1. `ai-context/current-state.md` — де партія зараз
2. `ai-context/active-quests.md` — квести
3. `ai-context/important-npcs.md` — індекс фігур
4. `world_data/world/timeline.md` — **хронологія, джерело істини**
5. `ai-context/loose-threads.md` — незакриті наслідки
6. `ai-context/dm-plans.md` — наміри ДМа (**ще не сталося**)
7. `ai-context/next-sessions.md` — плани найближчих сесій
8. Останні файли в `world_data/sessions/`

## Конвенції

- Один файл = одна сутність, імʼя файла в kebab-case.
- Внутрішні посилання — `[[file-name]]`.
- Картинки — WebP в `_media/`; у полі `image:` лише імʼя файла.
- Текст для картки на дошці — секція `## На дошці`, звʼязки — `## Звʼязки`.

## Перевірка

```
node tools/validate.mjs
```
