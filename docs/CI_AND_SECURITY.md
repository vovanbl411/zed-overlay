# CI и модель безопасности

[English](CI_AND_SECURITY.en.md) | Русский

## Обычный CI

Workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) запускается
для событий `pull_request` и событий `push` в `main`. Он имеет право
`contents: read` и выполняет следующие проверки:

- `scripts/overlay_policy.py` проверяет структуру оверлея и политику Wayland-only.
- `bash -n scripts/ci/*.sh` проверяет синтаксис shell без установки ShellCheck.
- `python3 -m unittest discover -s tests -v` запускает unit tests.

В рекомендуемом ниже ruleset обязательной проверкой служит `Overlay policy`.
Это имя job, а не workflow; при его изменении нужно также обновить GitHub
ruleset.
`actions/checkout` закреплён полным commit SHA и использует
`persist-credentials: false`.

Обычный CI для pull request имеет только read-only permissions для token и не
запрашивает repository secrets. Он не собирает Zed и не выполняет runtime
acceptance.

## Workflow проверки релизов

Workflow
[`.github/workflows/zed-release-watcher.yml`](../.github/workflows/zed-release-watcher.yml)
запускается ежедневно в 06:17 UTC; его также можно запустить через
`workflow_dispatch`. Он ищет новый релиз и готовит candidate в отдельном
временном workspace.

Job `check` запускает overlay policy и unit tests, затем вызывает
`scripts/ci/validate-release-candidate.sh`. Скрипт создаёт workspace без Git
метаданных через `git archive` и один раз запускает
`release_handoff.py --prepare`. Эта команда находит последний стабильный
upstream-релиз и возвращает `up-to-date` или `new-release`. Ошибки discovery и
preparation останавливают job.

Для нового релиза проверяются точные пути candidate ebuild и patch, затем
Portage выполняет проверки в закреплённых Gentoo container images. Скрипт
убеждается, что `--prepare` не изменил исходный Manifest; команда
`ebuild "$CANDIDATE_EBUILD" manifest` обновляет его позже, внутри контейнера.
Затем job выполняет `emerge -pv --oneshot`, сверяет Cargo и WebRTC snapshots с
извлечённым source archive, проверяет Wayland patch через dry-run, запускает
overlay policy и убеждается, что исходный checkout остался чистым. Для
результата `up-to-date` проверки candidate path и Docker пропускаются, но overlay
policy и проверка чистоты исходного checkout выполняются.

Проверки в контейнере выполняются только для amd64. Сборка и запуск на arm64
пока не проверялись.

Только для нового релиза создаётся sanitized handoff artifact. Отдельный
read-only job проверяет точный состав его файлов и соответствие base commit
commit-у workflow. Job публикации запускается только для `main` и после
успешной проверки handoff. Он получает чистый checkout `main`, применяет
проверенный handoff, повторно запускает overlay policy и создаёт Draft PR в
ветке `automation/zed-v<version>`. Если automation PR уже открыт, повторный
запуск завершается успешно; существующая удалённая ветка без открытого PR
приводит к fail-closed ошибке.

В Draft PR есть checklist ручной приёмки. До признания релиза проверенным в
runtime необходимо собрать пакет командой
`emerge -1av =app-editors/zed-<version>::zed-overlay`, проверить linkage через
`scanelf` и `lddtree`, а также проверить нативный запуск в Wayland без нежелательных
X11 runtime linkage. CI не выполняет эти шаги и не собирает Zed полностью.

## Permissions и граница artifact

По умолчанию workflow выдаёт `contents: read`. Шаги checkout используют
`persist-credentials: false`; Actions закреплены полными commit SHA, а Gentoo
container images — digest-ами.

Только job `publish-draft-release-pr` получает `contents: write` и
`pull-requests: write`. Он запускается только для `main` после успешной
валидации handoff. Artifact содержит только разрешённые Manifest, candidate
ebuild, candidate patch и `release.json`; перед применением его проверяют на
чистом checkout. Автоматический merge не настроен.

## Рекомендуемый ruleset для `main`

Настройте его вручную в `Settings → Rules → Rulesets`:

```text
Ruleset: Protect main
Enforcement: Active
Target: Default branch
Bypass list: empty

Restrict deletions: ON
Block force pushes: ON

Require pull request before merging: ON
Required approvals: 0
Require conversation resolution: ON

Require status checks: ON
Required check: Overlay policy
Require branches to be up to date: ON

Require signed commits: OFF for now
Require linear history: OFF
Merge queue: OFF
```

`Required approvals: 0` подходит для персонального репозитория: изменения всё
равно проходят через pull request, обязательный CI и решение владельца.
Содержимое репозитория не позволяет подтвердить, включён ли этот GitHub-level
ruleset.

## GitHub Actions и поиск секретов

- Оставляйте только необходимые Actions. Сторонние Actions закрепляйте полными
  неизменяемыми commit SHA, а не подвижными тегами.
- Сохраняйте read-only permissions по умолчанию. Обычный CI для pull request не
  запрашивает repository secrets.
- Dependabot в [`.github/dependabot.yml`](../.github/dependabot.yml) еженедельно
  проверяет обновления GitHub Actions. Проверяйте его pull request и запускайте
  CI; auto-merge не включайте.
- Write permissions должны оставаться только у описанного выше job публикации.
- Рекомендуется вручную включить GitHub Secret Scanning и Push Protection.
  Их состояние нельзя подтвердить по файлам репозитория.
