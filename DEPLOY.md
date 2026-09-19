# Приватний deployment

Production-режим запускає Crown Board у Docker, клонує приватну кампанію на persistent disk і після кожної зміни виконує:

1. `git pull --ff-only`;
2. атомарний запис файлу;
3. `git add`, `commit`, `push` у кампанію.

`.cache/board/` залишається лише на диску сервісу. Медіафайли проходять через Git LFS.

## Необхідні секрети

Створити fine-grained GitHub personal access token:

- repository access: тільки `orestgav/crown`;
- repository permission **Contents: Read and write**;
- без доступу до інших репозиторіїв.

Токен не записувати у файли, git або чат. Він задається лише як secret `GITHUB_TOKEN` у хостингу.

Змінні середовища:

| Змінна | Значення |
|---|---|
| `BOARD_REPOSITORY` | `orestgav/crown` |
| `BOARD_BRANCH` | `main` |
| `BOARD_AUTH_USER` | логін для входу, типово `dm` |
| `BOARD_AUTH_PASSWORD` | довгий випадковий пароль |
| `GITHUB_TOKEN` | fine-grained PAT із правами вище |
| `BOARD_DATA_DIR` | `/data` |

## Render Blueprint

У репозиторії є `render.yaml` і `Dockerfile`.

1. Запушити `crown-board` і `crown` у GitHub.
2. У Render вибрати **New → Blueprint** і підключити `orestgav/board`.
3. Під час створення ввести secret `GITHUB_TOKEN`.
4. Перевірити згенерований `BOARD_AUTH_PASSWORD` або замінити його власним.
5. Після deploy відкрити URL сервісу та ввійти через `BOARD_AUTH_USER` / `BOARD_AUTH_PASSWORD`.

Persistent disk обов'язковий: без нього clone і `.cache/` зникатимуть при рестарті. Канва має відкриватися лише через HTTPS, який Render надає на зовнішньому URL.

## Локальна перевірка Docker

```powershell
docker build -t crown-board .
docker run --rm -p 4173:4173 -v crown-board-data:/data `
  -e BOARD_REPOSITORY=orestgav/crown `
  -e BOARD_AUTH_USER=dm `
  -e BOARD_AUTH_PASSWORD=<password> `
  -e GITHUB_TOKEN=<token> `
  crown-board
```

Секрети краще передавати через env-file поза репозиторієм, щоб вони не лишилися в історії shell.

## Конфлікти

Якщо GitHub-репозиторій змінився паралельно, сервер спершу робить fast-forward pull. Якщо merge неможливий, запис і push зупиняються замість автоматичного розв'язання конфлікту. Поточний захист revision/ETag для `canvas.json` залишається активним.
