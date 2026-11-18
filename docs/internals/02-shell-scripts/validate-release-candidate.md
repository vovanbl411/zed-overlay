---
layout: handbook
title: Bash — подготовка кандидата Zed
description: От запуска в GitHub Actions до проверки файлов кандидата и Manifest во временном каталоге.
chapter: 2
eyebrow: Глава 02 / Shell scripts
permalink: /internals/02-shell-scripts/validate-release-candidate/
shell_labs: true
sections:
  - { id: yaml-to-bash, label: "3.1. От YAML к Bash" }
  - { id: startup, label: "3.2. Как запускается скрипт" }
  - { id: environment, label: "3.3. Обязательные переменные окружения" }
  - { id: main, label: "3.4. Функции и точка входа main" }
  - { id: mode, label: "3.5. Выбираем режим выполнения" }
  - { id: paths, label: "3.6. Подготавливаем рабочие пути" }
  - { id: workspace, label: "3.7. Создаём disposable workspace" }
  - { id: snapshot, label: "3.8. Фиксируем исходное состояние кандидата" }
  - { id: streams, label: "3.9. Потоки данных, перенаправления и tee" }
  - { id: boundary, label: "3.10. Проверяем границу первичной подготовки" }
  - { id: prepare-result, label: "3.11. Что вернула первичная подготовка?" }
  - { id: file-comparison, label: "3.12. Сравниваем списки файлов до и после" }
  - { id: process-substitution, label: "3.13. Что такое process substitution?" }
  - { id: arrays, label: "3.14. Превращаем список файлов в массив Bash" }
  - { id: candidate-ebuild, label: "3.15. Находим ebuild кандидата" }
  - { id: candidate-patch, label: "3.16. Определяем путь к Wayland patch" }
  - { id: candidate-paths, label: "3.17. Проверяем допустимый набор новых файлов" }
  - { id: identifiers, label: "3.18. Получаем Portage atom и версию пакета" }
  - { id: independent-crates, label: "3.19. Передаём кандидата следующему скрипту" }
  - { id: manifest-lifecycle, label: "3.20. Проверяем результат контейнерной валидации" }
  - { id: up-to-date, label: "3.21. Что происходит, если пакет уже актуален?" }
---

{% assign revision = '38531d4e4cfe0506f0f5f6b551c60897b6bea83c' %}
{% assign script = 'scripts/ci/validate-release-candidate.sh' %}
{% assign workflow = '.github/workflows/zed-release-watcher.yml' %}
{% assign yaml = '/internals/01-release-watcher/yaml/' | relative_url %}
{% capture invocation %}        run: scripts/ci/validate-release-candidate.sh{% endcapture %}
{% capture startup %}#!/usr/bin/env bash
set -euo pipefail{% endcapture %}
{% capture required_source %}: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GENTOO_PORTAGE_IMAGE:?GENTOO_PORTAGE_IMAGE is required}"
: "${GENTOO_STAGE3_IMAGE:?GENTOO_STAGE3_IMAGE is required}"{% endcapture %}
{% capture first_requirement %}: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"{% endcapture %}
{% assign first_helper = 'validate_candidate_paths() {' %}
{% capture main_start %}main() {
  local validation_mode="${INDEPENDENT_VALIDATION:-false}"{% endcapture %}
{% capture main_call %}main "$@"{% endcapture %}
{% capture mode_source %}  local validation_mode="${INDEPENDENT_VALIDATION:-false}"
  local total_started=$SECONDS
  case "$validation_mode" in
    false) ;;
    true) test "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ;;
    *) echo "ERROR: invalid independent validation mode" >&2; exit 1 ;;
  esac{% endcapture %}
{% capture temp_requirement %}: "${RUNNER_TEMP:?RUNNER_TEMP is required}"{% endcapture %}
{% capture paths_source %}  local tracked_paths="$RUNNER_TEMP/zed-overlay-tracked-paths"
  local disposable_workspace="$RUNNER_TEMP/zed-overlay"
  local before_paths="$RUNNER_TEMP/zed-overlay-before-paths"
  local prepare_log="$RUNNER_TEMP/zed-overlay-prepare.log"
  local manifest_checksum{% endcapture %}
{% capture filesystem_source %}  echo "handoff_ready=false" >> "$GITHUB_OUTPUT"
  git -C "$GITHUB_WORKSPACE" ls-files -z > "$tracked_paths"
  mkdir -p "$disposable_workspace"
  # Проверяем архив HEAD, а не рабочий checkout: подготовка candidate не должна
  # загрязнять исходное дерево, а в архив не попадает каталог .git.
  git -C "$GITHUB_WORKSPACE" archive HEAD | tar -x -C "$disposable_workspace"
  test ! -e "$disposable_workspace/.git"{% endcapture %}
{% capture snapshot_source %}  cd "$disposable_workspace"
  manifest_checksum="$(sha256sum app-editors/zed/Manifest)"
  find app-editors/zed -type f -print0 | sort -z > "$before_paths"{% endcapture %}
{% capture pipeline_source %}  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py --prepare | tee "$prepare_log" | tee -a "$GITHUB_STEP_SUMMARY"{% endcapture %}
{% capture git_gate_source %}  test ! -e .git{% endcapture %}
{% capture boundary_source %}  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py --prepare | tee "$prepare_log" | tee -a "$GITHUB_STEP_SUMMARY"
  test ! -e .git
  # Этот checksum фиксирует границу: --prepare добавляет candidate-файлы,
  # но Manifest разрешено менять только позднее через ebuild manifest.
  test "$manifest_checksum" = "$(sha256sum app-editors/zed/Manifest)"{% endcapture %}

## 3.1. От YAML к Bash {#yaml-to-bash}

{% include source-preview.html source=invocation label="Команда workflow · строка 60" path=workflow revision=revision start=60 open=true %}

GitHub Actions назначает заданию `check` [runner с Ubuntu]({{ yaml }}#gentoo-on-ubuntu).
После checkout оболочка шага выполняет команду из `run:` в каталоге репозитория.
Путь содержит `/`, поэтому оболочка запускает файл по этому относительному пути.
Решения о создании файлов и проверках принимает Bash-скрипт.

<figure class="figure lesson-figure shell-diagram">
  <h3>Путь кандидата для нового релиза</h3>
  <ol class="lesson-flow shell-sequence" role="list">
    <li class="flow-node">GitHub Actions<small>workflow</small></li>
    <li class="flow-node">Ubuntu runner<small>job check</small></li>
    <li class="flow-node shell-focus">Bash<small>окружение → <code>main</code> → временная копия</small></li>
    <li class="flow-node shell-focus">Python<small><code>--prepare</code>, затем Bash проверяет <code>.git</code> и Manifest</small></li>
  </ol>
  <p class="shell-diagram-transition"><span aria-hidden="true">↓</span> Если найден новый релиз</p>
  <ol class="lesson-flow shell-sequence" role="list">
    <li class="flow-node">Проверка путей<small><code>validate_<wbr>candidate_<wbr>paths</code></small></li>
    <li class="flow-node">Independent crates<small>подготовка и контейнерная проверка</small></li>
    <li class="flow-node">Валидация<small><code>validate_<wbr>manifest_<wbr>update</code><br><code>validate_<wbr>disposable_<wbr>policy</code><br><code>assert_<wbr>source_<wbr>workspace_<wbr>clean</code></small></li>
    <li class="flow-node">Handoff<small><code>create_<wbr>release_<wbr>handoff</code><br>вне режима «только проверка»</small></li>
  </ol>
  <figcaption>Подсветка отмечает запуск и первичную подготовку. При результате <code>up-to-date</code> скрипт пропускает проверку путей нового кандидата, контейнерный этап и создание handoff.</figcaption>
</figure>

`main` управляет всем проходом. Bash сначала регистрирует пять вспомогательных
функций. Их вызовы находятся в теле этой функции. В ветке нового релиза
`validate_candidate_paths` сначала проверяет перечень добавленных файлов и
определяет пути кандидата. После запуска `independent-crates.sh` функция
`validate_manifest_update` проверяет, что Manifest обновился, а в копии по-прежнему
нет `.git`. Затем `validate_disposable_policy` проверяет политику оверлея
в копии, а `assert_source_workspace_clean` проверяет чистоту исходного checkout.
Если нужен handoff, `create_release_handoff` собирает файлы передачи и записывает
выходные параметры шага.

## 3.2. Как запускается скрипт {#startup}

{% include source-preview.html source=startup label="Интерпретатор и опции · строки 1–2" path=script revision=revision start=1 open=true %}

Первая строка начинается с `#!` и называется *shebang*. При прямом запуске
файла с правом исполнения ядро запускает `/usr/bin/env` и передаёт ему
`bash` и путь к скрипту. `env` ищет исполняемый `bash` в каталогах из `PATH`.
Поэтому файл, запущенный из интерактивного fish, читает и выполняет Bash.

При явном вызове `bash scripts/ci/validate-release-candidate.sh` оболочка
запускает Bash, который открывает файл для чтения. Разрешение на исполнение
файла и выбор интерпретатора по shebang нужны при прямом запуске.

`set -euo pipefail` включает `errexit`, `nounset` и `pipefail`. Сравните
поведение на тех же примерах, что и в [разборе Bash-шага Job 2]({{ yaml }}#handoff-bash).
У `-e` есть исключения, в том числе для команды в условии `if`. Опции
реагируют на сбои команд. Содержимое кандидата проверяют отдельные условия.

{% include bash-options.html heading="h3" %}

## 3.3. Обязательные переменные окружения {#environment}

`:` — встроенная команда Bash, которая обычно ничего не делает и возвращает
успех. Перед её вызовом Bash раскрывает аргумент. Для `${VARIABLE:?message}`
заданное непустое значение становится аргументом `:`. Двойные кавычки
сохраняют его целиком, включая пробелы. При пустом значении или отсутствующей
переменной раскрытие завершается ошибкой. Неинтерактивный Bash выходит,
поэтому команда `:` на этой строке даже не вызывается.

GitHub Actions задаёт `GITHUB_WORKSPACE` (путь к checkout), `GITHUB_OUTPUT`
(файл выходных параметров шага), `GITHUB_STEP_SUMMARY` (файл сводки шага),
`GITHUB_SHA` (коммит события, передаваемый в метаданных как базовый) и
`RUNNER_TEMP` (каталог временных файлов runner). См. [выходные параметры]({{ yaml }}#job-outputs).
`GENTOO_PORTAGE_IMAGE` указывает образ с деревом Portage, а
`GENTOO_STAGE3_IMAGE` — Gentoo stage3 для контейнерной проверки. Оба образа
закреплены по digest в [`env` задания]({{ yaml }}#job-env).

[Справочник стандартных переменных GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables).

<div class="figure lesson-figure shell-lab" data-shell-lab="environment" markdown="1">
<h3>Где остановится Bash</h3>

{% assign required = 'GITHUB_WORKSPACE GITHUB_OUTPUT GITHUB_STEP_SUMMARY GITHUB_SHA RUNNER_TEMP GENTOO_PORTAGE_IMAGE GENTOO_STAGE3_IMAGE' | split: ' ' %}
<div class="lab-controls" data-lab-controls hidden>
  <label>Переменная <select name="variable">{% for name in required %}<option value="{{ forloop.index0 }}">{{ name }}</option>{% endfor %}</select></label>
  <label>Состояние <select name="presence"><option value="valid">Задана и непуста</option><option value="empty">Пустая строка</option><option value="unset">Не задана</option></select></label>
</div>

<p class="model-result" role="status">Все семь переменных заданы. Раскрытие проходит, <code>:</code> возвращает 0 на каждой строке. Вход в <code>main</code> достижим.</p>

{% include source-preview.html source=required_source label="Обязательные переменные · строки 4–10" path=script revision=revision start=4 open=true %}

<ol class="shell-gates" aria-label="Порядок проверок" role="list">
  {% for name in required %}<li class="flow-node" data-gate-state="PASS"><strong><code>{{ name }}</code></strong><span class="lesson-status" data-status="PASS">PASS</span></li>{% endfor %}
</ol>
</div>

В модели все остальные переменные заданы и непусты. Примеры значений вымышлены.
Проверка требует непустое значение. Права доступа, существование файла или
доступность образа проверяются при соответствующих операциях.

## 3.4. Функции и точка входа main {#main}

`main() {` объявляет функцию. Между фигурными скобками находится её тело.
Объявление хранит команды для последующего вызова. Имя `main` выбрал автор
скрипта, для Bash действует обычное правило вызова по имени.

Вызов `main "$@"` передаёт функции позиционные параметры скрипта. Внутри
функции первый аргумент доступен как `$1`, второй как `$2`. Выражение
`"$@"` расширяется в отдельное слово для каждого аргумента. Пробелы внутри
аргумента и пустые аргументы сохраняются, а при отсутствии аргументов
раскрытие даёт ноль слов. Здесь `main` получает параметры, но тело функции
их не читает. Первые решения зависят от окружения.

<div class="figure lesson-figure shell-lab" data-shell-lab="function" markdown="1">
<h3>Когда выполняется тело функции</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Этап <select name="step">
    <option value="0">1. Запуск интерпретатора</option><option value="1">2. Настройка опций</option><option value="2">3. Проверка окружения</option><option value="3">4. Объявление функций</option><option value="4">5. Вызов main</option><option value="5">6. Выполнение тела</option>
  </select></label>
  <div class="shell-step-buttons" role="group" aria-label="Переход по шагам">
    <button type="button" data-step="-1">Назад</button>
    <button type="button" data-step="1">Далее</button>
  </div>
</div>

<p class="model-result" role="status">Ядро читает shebang и запускает интерпретатор.</p>

{% include source-preview.html source=startup label="Запуск и опции · строки 1–2" path=script revision=revision start=1 open=true %}
{% include source-preview.html source=first_requirement label="Первая проверка окружения · строка 4" path=script revision=revision start=4 open=true %}
{% include source-preview.html source=first_helper label="Первое объявление функции · строка 12" path=script revision=revision start=12 open=true %}
{% include source-preview.html source=main_start label="Объявление main и первая команда · строки 111–112" path=script revision=revision start=111 open=true %}
{% include source-preview.html source=main_call label="Вызов main · строка 172" path=script revision=revision start=172 open=true %}

<ol class="lesson-flow shell-sequence shell-function-flow" role="list">
  <li class="flow-node shell-focus" data-phase aria-current="step">Запуск<small>интерпретатор</small></li>
  <li class="flow-node" data-phase>Опции<small>set</small></li>
  <li class="flow-node" data-phase>Окружение<small>семь проверок</small></li>
  <li class="flow-node" data-phase>Объявление<small>тело сохранено</small></li>
  <li class="flow-node" data-phase>Вызов<small>передача аргументов</small></li>
  <li class="flow-node" data-phase>Выполнение<small>команды в теле main</small></li>
</ol>
</div>

Самостоятельный пример Bash с двумя заранее заданными аргументами:

```bash
show_args() { printf '<%s>\n' "$@"; }
show_args 'stable' 'папка с пробелами'
```

```text
<stable>
<папка с пробелами>
```

## 3.5. Выбираем режим выполнения {#mode}

`local` объявляет переменную, область жизни которой ограничена вызовом
функции. `${INDEPENDENT_VALIDATION:-false}` подставляет `false` при пустом
или отсутствующем значении. В этих же случаях оператор `:?` прервал бы
скрипт. `SECONDS` — специальный целочисленный счётчик прошедших секунд Bash.
В режиме «только проверка» скрипт вычитает `total_started` из текущего
`SECONDS` и выводит длительность подготовки и проверки.

`case … in` выбирает первый подходящий шаблон, `;;` завершает ветку,
`esac` закрывает конструкцию. Для `false` в ветке нет команд. Для `true`
команда `test` сравнивает событие с `workflow_dispatch` и возвращает 0 при
совпадении или 1 при несовпадении. Здесь ненулевой статус прекращает
выполнение из-за `-e`. Шаблон `*` принимает любое оставшееся значение.
`>&2` направляет вывод `echo` в стандартный поток ошибок, а `exit 1`
завершает скрипт с ошибкой явно.

<div class="figure lesson-figure shell-lab" data-shell-lab="mode" markdown="1">
<h3>Как значение попадает в ветку case</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>INDEPENDENT_VALIDATION <select name="mode"><option value="unset">Не задана</option><option value="empty">Пустая строка</option><option>false</option><option>true</option><option value="invalid">Недопустимое значение: yes</option></select></label>
  <label>GITHUB_EVENT_NAME <select name="event"><option>schedule</option><option>workflow_dispatch</option><option value="unset">Не задана</option></select></label>
</div>

<p class="model-result" role="status">Статус 0. Скрипт переходит к объявлению путей.</p>

{% include source-preview.html source=mode_source label="Режим и начальное время · строки 112–118" path=script revision=revision start=112 open=true %}

<ol class="lesson-flow three-stage-flow shell-mode-flow" role="list">
  <li class="flow-node"><strong>Подстановка</strong><small data-mode-expansion>Не задана → false</small></li>
  <li class="flow-node"><strong><code>validation_mode</code></strong><small data-mode-local>false</small></li>
  <li class="flow-node"><strong>Ветка <code>case</code></strong><small data-mode-branch>false · test не вызывается</small></li>
</ol>
</div>

YAML вычисляет режим для обычного запуска, а Bash проверяет собственный
вход перед операциями с файлами. Это важно и при прямом вызове скрипта
с другим окружением. Условия допуска к публикации проверяются [в отдельном
задании]({{ yaml }}#job-publish).

## 3.6. Подготавливаем рабочие пути {#paths}

`имя=значение` присваивает строку. Bash раскрывает `$RUNNER_TEMP` и добавляет
к результату суффикс пути внутри кавычек. На этом этапе четыре переменные
хранят пути, а файловые операции ещё не выполнялись. `local manifest_checksum`
объявляет локальную переменную без явного присваивания. Вывод `sha256sum`
попадёт в неё после перехода во временный каталог.

<div class="figure lesson-figure shell-lab" data-shell-lab="paths" markdown="1">
<h3>От строки пути к объекту на диске</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Путь <select name="path"><option>GITHUB_WORKSPACE</option><option>RUNNER_TEMP</option><option>tracked_paths</option><option>disposable_workspace</option><option>before_paths</option><option>prepare_log</option></select></label>
</div>

<p class="model-result" role="status">GITHUB_WORKSPACE указывает на уже существующий checkout. Git читает здесь индекс и HEAD.</p>

{% include source-preview.html source=first_requirement label="Проверка пути checkout · строка 4" path=script revision=revision start=4 open=true %}
{% include source-preview.html source=temp_requirement label="Проверка временного каталога · строка 8" path=script revision=revision start=8 open=true %}
{% include source-preview.html source=paths_source label="Локальные переменные · строки 119–124" path=script revision=revision start=119 trailing_blank=true open=true %}

<div class="workspace shell-path-tree" aria-label="Условные пути runner">
  <ul role="list">
    <li data-path="GITHUB_WORKSPACE"><code>/home/runner/work/zed-overlay/zed-overlay/</code><small>Checkout уже выполнился.</small></li>
    <li data-path="RUNNER_TEMP"><code>/home/runner/work/_temp/</code><small>Каталог уже предоставлен runner.</small>
      <ul role="list">
        <li data-path="tracked_paths"><code>zed-overlay-tracked-paths</code><small>126 · <code>&gt;</code> открывает файл для списка Git.</small></li>
        <li data-path="disposable_workspace"><code>zed-overlay/</code><small>127 · <code>mkdir</code> создаёт каталог, 130 · <code>tar</code> наполняет его.</small></li>
        <li data-path="before_paths"><code>zed-overlay-before-paths</code><small>135 · <code>&gt;</code> открывает файл для списка до подготовки.</small></li>
        <li data-path="prepare_log"><code>zed-overlay-prepare.log</code><small>136 · первый <code>tee</code> открывает файл журнала.</small></li>
      </ul>
    </li>
  </ul>
</div>
</div>

## 3.7. Создаём disposable workspace {#workspace}

- **125.** `echo` печатает `handoff_ready=false`. Оператор `>>` дописывает
  строку в файл `GITHUB_OUTPUT`, сохраняя прежнее содержимое. Готовность
  подтвердит позже только успешное создание handoff.
- **126.** `git -C "$GITHUB_WORKSPACE"` велит Git работать в каталоге
  checkout, не меняя текущий каталог Bash. `ls-files` перечисляет пути,
  отслеживаемые в индексе. `-z` завершает каждую запись байтом NUL.
  Перенаправление `>` открывает `tracked_paths` для записи с обнулением
  прежнего содержимого. Список пригодится при проверке политики в копии
  без собственного индекса Git.
- **127.** `mkdir -p` создаёт каталог и нужные родительские каталоги,
  а существующий каталог оставляет на месте. В модели путь при старте свободен.
- **128–130.** `git archive HEAD` пишет архив дерева коммита в stdout.
  `|` передаёт его в stdin `tar`. Ключ `-x` распаковывает архив, а
  `-C "$disposable_workspace"` задаёт каталог назначения. В архиве нет
  истории Git, незакоммиченных правок и неотслеживаемых файлов.
- **131.** `test -e` проверяет существование пути, а `!` инвертирует
  результат. Здесь успешный статус означает, что `.git` не обнаружен.

Индекс перечисляет отслеживаемые пути, в том числе подготовленные к следующему
коммиту. `HEAD` указывает на коммит, из которого Git берёт снимок. Рабочее дерево
содержит файлы, которые видит редактор. В примере правка в ebuild и
неотслеживаемая заметка показывают разницу между рабочим деревом и
`HEAD`. Позже проверка чистоты исходного checkout отклонит такое состояние. Временный каталог даёт отдельное место для записи файлов, но не
ограничивает права процессов как песочница. Модель показывает обычные файлы
без правил `export-ignore`.

<div class="figure lesson-figure shell-lab" data-shell-lab="filesystem" markdown="1">
<h3>Что создаётся на каждом шаге</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Шаг <select name="step">
    <option value="0">До первой команды</option><option value="1">1. Записать output</option><option value="2">2. Сохранить список Git</option><option value="3">3. Создать каталог</option><option value="4">4. Распаковать HEAD</option><option value="5">5. Проверить .git</option>
  </select></label>
  <div class="shell-step-buttons" role="group" aria-label="Переход по шагам">
    <button type="button" data-step="-1">Назад</button>
    <button type="button" data-step="1">Далее</button>
  </div>
</div>

<p class="model-result" role="status">До первой команды существует checkout. Во временной области копии и списка путей ещё нет.</p>

{% include source-preview.html source=filesystem_source label="Создание временной копии · строки 125–131" path=script revision=revision start=125 open=true %}

<div class="candidate-workspaces shell-filesystem">
  <div class="workspace"><strong>Исходный checkout</strong><code>$GITHUB_WORKSPACE/</code>
    <pre><code>├── .git/
├── app-editors/zed/
│   ├── Manifest
│   └── zed-1.28.1.ebuild
└── notes.txt</code></pre>
    <small>В ebuild есть правка. <code>notes.txt</code> вне Git.</small>
  </div>
  <div class="workspace-transfer"><span aria-hidden="true"></span><code>archive HEAD</code></div>
  <div class="workspace workspace-candidate"><strong>Временная копия</strong><code>$RUNNER_TEMP/zed-overlay/</code>
    <pre><code data-fs-tree>Каталог ещё не создан</code></pre>
    <small data-fs-content hidden>Ebuild распакован в версии из HEAD.</small>
  </div>
</div>
<div class="shell-file-grid">
  <div class="workspace"><strong><code>GITHUB_OUTPUT</code></strong><small>Файл шага</small><pre><code data-fs-output>Ещё нет записи handoff_ready</code></pre></div>
  <div class="workspace"><strong><code>tracked_paths</code></strong><small>Фрагмент списка из индекса, ␀ обозначает NUL</small><pre><code data-fs-index>Файл ещё не создан</code></pre></div>
</div>
</div>

## 3.8. Фиксируем исходное состояние кандидата {#snapshot}

`cd "$disposable_workspace"` меняет текущий каталог Bash. Путь из окружения
в примере абсолютный, он начинается с `/`. Относительный путь
`app-editors/zed/Manifest` после `cd` указывает на файл в копии.
Следующая команда подставляет через `$(…)` вывод `sha256sum`, убирая
завершающий перевод строки. В `manifest_checksum` остаётся вся строка
с хешем и именем файла. Позже скрипт сравнит её с выводом той же команды.

`find app-editors/zed -type f` обходит каталог пакета и выбирает обычные
файлы. `-print0` печатает каждый путь с байтом NUL в конце, `sort -z`
сортирует записи с тем же разделителем, а `>` сохраняет результат в
`before_paths`. Это снимок имён до подготовки. Проверка путей сравнит его
со списком, собранным после подготовки, чтобы обнаружить добавленные файлы.

<div class="figure lesson-figure shell-lab" data-shell-lab="snapshot" markdown="1">
<h3>Где заканчивается имя файла</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Разделитель записей <select name="separator"><option value="nul">NUL · как в скрипте</option><option value="newline">Перевод строки</option></select></label>
</div>

<p class="model-result" role="status">Три записи. Перевод строки внутри условного имени остаётся частью имени. ␀ обозначает байт NUL, ⏎ — перевод строки.</p>

{% include source-preview.html source=snapshot_source label="Снимок исходного состояния · строки 133–135" path=script revision=revision start=133 open=true %}

<div class="workspace"><strong>После <code>cd</code></strong><code>/home/runner/work/_temp/zed-overlay/</code>
  <small>Условный вывод <code>sha256sum</code>, записанный в <code>manifest_checksum</code></small>
  <pre><code>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  app-editors/zed/Manifest</code></pre>
</div>
<div class="shell-file-grid">
  <div class="workspace"><strong><code>before_paths</code> · фрагмент</strong>
    <pre><code data-record-bytes>app-editors/zed/Manifest ␀
app-editors/zed/report⏎local.txt ␀
app-editors/zed/zed-1.28.1.ebuild ␀</code></pre>
  </div>
  <div class="workspace"><strong>Записи после чтения</strong><ol class="shell-records" data-records>
    <li><code>app-editors/zed/Manifest</code></li><li><code>app-editors/zed/report⏎local.txt</code></li><li><code>app-editors/zed/zed-1.28.1.ebuild</code></li>
  </ol></div>
</div>
</div>

В имени файла Linux может быть перевод строки, но не байт NUL. В модели
`report⏎local.txt` — одно придуманное имя. При разделении по переводу
строки оно распадается на две записи. `find -print0 | sort -z` сохраняет
границы именно этого списка. Последующие команды скрипта работают со
своими представлениями путей.

## 3.9. Потоки данных, перенаправления и tee {#streams}

{% include source-preview.html source=pipeline_source label="Подготовка и два назначения вывода · строка 136" path=script revision=revision start=136 open=true %}

У каждого процесса здесь три стандартных файловых дескриптора. STDIN
(`0`) — вход, STDOUT (`1`) — обычный вывод, STDERR (`2`) — поток
диагностики. Символ `|` соединяет дескриптор `1` процесса слева
с дескриптором `0` процесса справа. stderr Python runner получает
отдельно, поскольку в команде нет перенаправления `2>&1`.

<div class="figure selector command-anatomy" data-selector data-label="Фрагменты конвейера Bash" markdown="1">
<h3>Из чего состоит команда подготовки</h3>
<div class="annotated-command" data-selection-controls role="group" aria-label="Фрагменты конвейера Bash"><code>  <span data-select="prep-env">PYTHONDONTWRITEBYTECODE=1</span> <span data-select="prep-python">python3 scripts/release_handoff.py --prepare</span> <span data-select="prep-pipes">|</span> <span data-select="prep-log">tee "$prepare_log"</span> <span data-highlight-for="prep-pipes">|</span> <span data-select="prep-summary">tee -a "$GITHUB_STEP_SUMMARY"</span></code></div>
<div data-panel id="prep-env" markdown="1">
**`PYTHONDONTWRITEBYTECODE=1`** передаётся в окружение процесса Python. Python не записывает файлы байткода при импорте модулей. Присваивание перед командой не меняет окружение процессов `tee`.
</div>
<div data-panel id="prep-python" markdown="1">
**`python3 … --prepare`** запускает подготовку кандидата из текущего каталога. Скрипт получает аргумент `--prepare`.
</div>
<div data-panel id="prep-pipes" markdown="1">
Оба оператора **`|`** передают байты из stdout слева в stdin справа. Процессы могут работать одновременно.
</div>
<div data-panel id="prep-log" markdown="1">
**Первый `tee`** читает stdin, записывает его в `prepare_log` и повторяет в stdout. При открытии файла прежнее содержимое стирается.
</div>
<div data-panel id="prep-summary" markdown="1">
**Второй `tee -a`** сохраняет прежние строки сводки и дописывает новые. Его stdout идёт в лог шага runner.
</div>
</div>

{% include shell-stream-labs.html pipeline=pipeline_source next=git_gate_source script=script revision=revision %}

При установленном `pipefail` статус конвейера равен статусу самой правой
команды, завершившейся с ошибкой, или 0, если успешны все команды. Когда
`pipefail` выключен, статус задаёт последний `tee`. Поэтому с `pipefail`
успешная запись лога не скрывает сбой Python. Здесь конвейер — обычная
команда в теле функции, и `errexit` прекращает выполнение при его ненулевом
статусе.

## 3.10. Проверяем границу первичной подготовки {#boundary}

`--prepare` может добавить ebuild кандидата и версионный патч. Строка 136
должна завершиться успешно. Затем строка 137 проверяет, что `.git`
по-прежнему отсутствует в текущем каталоге. Строка 140 сравнивает строку
`sha256sum` со значением из строки 134. На этом этапе Manifest должен
сохранить исходное содержимое. Обновить его через `ebuild manifest` можно
на более позднем этапе контейнерной проверки. Раннее изменение нарушило бы
границу между подготовкой файлов и проверкой кандидата контейнером.

<div class="figure lesson-figure shell-lab" data-shell-lab="boundary" markdown="1">
<h3>Какой контроль сработает первым</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Результат подготовки <select name="scenario"><option value="ok">Подготовка успешна, Manifest прежний</option><option value="pipeline">Конвейер завершился ошибкой</option><option value="git">В копии появился .git</option><option value="manifest">Manifest изменился слишком рано</option></select></label>
</div>

<p class="model-result" role="status">Все три проверки прошли. Скрипт доходит до чтения результата в журнале.</p>

{% include source-preview.html source=boundary_source label="Граница первичной подготовки · строки 136–140" path=script revision=revision start=136 open=true %}

<div class="shell-file-grid">
  <div class="workspace"><strong>До подготовки</strong><pre><code>app-editors/zed/
├── Manifest [исходный]
└── zed-1.28.1.ebuild

.git отсутствует</code></pre></div>
  <div class="workspace workspace-candidate"><strong>После попытки подготовки</strong><pre><code data-boundary-tree>app-editors/zed/
├── Manifest [исходный]
├── zed-1.28.1.ebuild
└── zed-1.29.0.ebuild [новый]

.git отсутствует</code></pre></div>
</div>
<ol class="lesson-flow three-stage-flow gate-flow" role="list">
  <li class="flow-node" data-gate-state="PASS"><strong>Конвейер</strong><small>136</small><span class="lesson-status" data-status="PASS">PASS</span></li>
  <li class="flow-node" data-gate-state="PASS"><strong>Без <code>.git</code></strong><small>137</small><span class="lesson-status" data-status="PASS">PASS</span></li>
  <li class="flow-node" data-gate-state="PASS"><strong>Manifest</strong><small>140</small><span class="lesson-status" data-status="PASS">PASS</span></li>
</ol>
<p class="figure-caption">Дерево показывает возможные результаты на условном ebuild. Ошибка команды сама по себе не откатывает уже записанные файлы.</p>
</div>

После этих проверок Bash читает журнал, который сохранил первый `tee`.
От строки в этом журнале зависит, понадобится ли контейнерная проверка.

{% assign container = 'scripts/ci/independent-crates.sh' %}
{% capture branch_source %}  if grep -Fxq 'Result: new-release' "$prepare_log"; then
    validate_candidate_paths "$before_paths"
    "$disposable_workspace/scripts/ci/independent-crates.sh" \
      "$candidate_version" "$disposable_workspace/$candidate_ebuild" \
      "$disposable_workspace/$candidate_patch" "$disposable_workspace"
    validate_manifest_update "$manifest_checksum"
  else
    grep -Fxq 'Result: up-to-date' "$prepare_log"
    echo 'Result: up-to-date' >> "$GITHUB_STEP_SUMMARY"
    mapfile -d '' -t candidate_paths < <(
      comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
    )
    test "${#candidate_paths[@]}" -eq 0
  fi{% endcapture %}
{% capture compare_source %}validate_candidate_paths() {
  local before_paths="$1"

  # Сравниваем список файлов до и после подготовки: ожидаем новый ebuild и,
  # если подходящего patch ещё не было, его версионную пару.
  mapfile -d '' -t candidate_paths < <(
    comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
  ){% endcapture %}
{% capture process_source %}  mapfile -d '' -t candidate_paths < <(
    comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
  ){% endcapture %}
{% capture array_source %}  mapfile -d '' -t candidate_paths < <(
    comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
  )
  candidate_ebuild="$(printf '%s\n' "${candidate_paths[@]}" | grep -Ex 'app-editors/zed/zed-[0-9]+\.[0-9]+\.[0-9]+\.ebuild')"{% endcapture %}
{% capture ebuild_source %}  candidate_ebuild="$(printf '%s\n' "${candidate_paths[@]}" | grep -Ex 'app-editors/zed/zed-[0-9]+\.[0-9]+\.[0-9]+\.ebuild')"{% endcapture %}
{% capture patch_source %}  candidate_patch="app-editors/zed/files/$(basename "${candidate_ebuild%.ebuild}")-wayland-only.patch"
  test -f "$candidate_ebuild"
  test -f "$candidate_patch"{% endcapture %}
{% capture allowlist_source %}  if [ "${#candidate_paths[@]}" -eq 1 ]; then
    test "${candidate_paths[0]}" = "$candidate_ebuild"
  else
    test "${#candidate_paths[@]}" -eq 2
    printf '%s\n' "${candidate_paths[@]}" | sort | cmp -s - <(
      printf '%s\n' "$candidate_ebuild" "$candidate_patch" | sort
    )
  fi{% endcapture %}
{% capture candidate_source %}  candidate_ebuild="$(printf '%s\n' "${candidate_paths[@]}" | grep -Ex 'app-editors/zed/zed-[0-9]+\.[0-9]+\.[0-9]+\.ebuild')"
  candidate_patch="app-editors/zed/files/$(basename "${candidate_ebuild%.ebuild}")-wayland-only.patch"
  test -f "$candidate_ebuild"
  test -f "$candidate_patch"
  if [ "${#candidate_paths[@]}" -eq 1 ]; then
    test "${candidate_paths[0]}" = "$candidate_ebuild"
  else
    test "${#candidate_paths[@]}" -eq 2
    printf '%s\n' "${candidate_paths[@]}" | sort | cmp -s - <(
      printf '%s\n' "$candidate_ebuild" "$candidate_patch" | sort
    )
  fi

  candidate_atom="=app-editors/${candidate_ebuild##*/}"
  candidate_atom="${candidate_atom%.ebuild}::zed-overlay"
  candidate_version="${candidate_ebuild##*/zed-}"
  candidate_version="${candidate_version%.ebuild}"
}{% endcapture %}
{% capture identifiers_source %}  candidate_atom="=app-editors/${candidate_ebuild##*/}"
  candidate_atom="${candidate_atom%.ebuild}::zed-overlay"
  candidate_version="${candidate_ebuild##*/zed-}"
  candidate_version="${candidate_version%.ebuild}"{% endcapture %}
{% capture container_call %}    validate_candidate_paths "$before_paths"
    "$disposable_workspace/scripts/ci/independent-crates.sh" \
      "$candidate_version" "$disposable_workspace/$candidate_ebuild" \
      "$disposable_workspace/$candidate_patch" "$disposable_workspace"
    validate_manifest_update "$manifest_checksum"{% endcapture %}
{% capture manifest_update %}validate_manifest_update() {
  local manifest_checksum="$1"

  if test ! -e .git; then
    echo "Git-less workspace after container validation: OK"
  else
    echo "ERROR: disposable workspace gained .git" >&2
    exit 1
  fi

  if test "$manifest_checksum" != "$(sha256sum app-editors/zed/Manifest)"; then
    echo "Manifest update after container validation: OK"
  else
    echo "ERROR: app-editors/zed/Manifest was not updated by container validation" >&2
    exit 1
  fi
}{% endcapture %}
{% capture early_checksum %}  test "$manifest_checksum" = "$(sha256sum app-editors/zed/Manifest)"{% endcapture %}
{% capture container_exec %}    "$disposable_workspace/scripts/ci/independent-crates.sh" \
      "$candidate_version" "$disposable_workspace/$candidate_ebuild" \
      "$disposable_workspace/$candidate_patch" "$disposable_workspace"{% endcapture %}
{% capture current_source %}  else
    grep -Fxq 'Result: up-to-date' "$prepare_log"
    echo 'Result: up-to-date' >> "$GITHUB_STEP_SUMMARY"
    mapfile -d '' -t candidate_paths < <(
      comm -z -13 "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)
    )
    test "${#candidate_paths[@]}" -eq 0
  fi{% endcapture %}
{% capture current_test %}    test "${#candidate_paths[@]}" -eq 0{% endcapture %}
{% capture next_phase %}  validate_disposable_policy "$disposable_workspace" "$tracked_paths"
  assert_source_workspace_clean{% endcapture %}
{% capture container_args %}version="${1:?candidate version required}"
candidate="${2:?candidate ebuild required}"
patch="${3:?candidate patch required}"
overlay="${4:?disposable overlay required}"{% endcapture %}
{% capture container_manifest %}      ebuild "$CANDIDATE_EBUILD" manifest{% endcapture %}
{% capture container_archives %}      PYTHONDONTWRITEBYTECODE=1 python3 scripts/inspect_zed_archive.py --archive "/experiment/dist/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" --manifest /overlay/app-editors/zed/Manifest
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/inspect_zed_archive.py --archive "/experiment/dist/zed-${CANDIDATE_VERSION}.tar.gz" --manifest /overlay/app-editors/zed/Manifest
      PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py preserve-manifest /experiment/original-Manifest /overlay/app-editors/zed/Manifest{% endcapture %}
{% capture container_atom %}      emerge -pv --oneshot "=app-editors/zed-${CANDIDATE_VERSION}::zed-overlay"{% endcapture %}

## 3.11. Что вернула первичная подготовка? {#prepare-result}

Python печатает `Result: new-release`, когда подготовил новый кандидат,
или `Result: up-to-date`, когда пакет уже актуален. Bash ищет эти маркеры
в файле `prepare_log`. Во всех примерах ниже Zed 1.29.0 — условная версия
кандидата для обучения.

Конструкция `if …; then … else … fi` проверяет **код завершения** команды.
При статусе 0 выполняется блок после `then`, при ненулевом — блок после
`else`. `fi` закрывает условие. У `grep -Fxq` три отдельных флага.
`-F` ищет буквальный текст, `-x` требует совпадения всей строки,
а `-q` отключает обычный вывод. Статус 0 означает совпадение, 1 означает
его отсутствие, а 2 у GNU grep обозначает ошибку, например отказ при
открытии файла. В режиме `-q` найденное совпадение может дать статус 0
даже при ошибке чтения.

У `errexit` есть исключение для команды в условии `if`. Первый `grep`
может вернуть ненулевой статус, и Bash перейдёт в `else`. Второй `grep`
внутри `else` — обычная команда. Если он вернёт ненулевой статус,
скрипт остановится, не дойдя до записи в сводку. Отсутствие маркера и
ошибка чтения по-разному объясняют ненулевой статус. Здесь показаны
сценарии с читаемым файлом.

<div class="figure lesson-figure shell-lab" data-shell-lab="result-branch" markdown="1">
<h3>Какой маршрут откроет запись в журнале</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Содержимое журнала <select name="scenario">
    <option value="new">Точный new-release</option><option value="current">Точный up-to-date</option><option value="missing">Без маркера</option><option value="similar">Похожая строка</option><option value="both">Оба маркера</option>
  </select></label>
</div>
<p class="model-result" role="status">Первая проверка вернула 0. Открыта ветка нового релиза.</p>

<div class="workspace"><strong>Условный <code>prepare_log</code></strong><pre><code data-branch-log><mark>Result: new-release</mark></code></pre></div>
<ol class="lesson-flow three-stage-flow gate-flow" role="list">
  <li class="flow-node" data-gate-state="PASS"><strong>142 · new-release</strong><small data-first-grep>0 · совпадение</small><span class="lesson-status" data-status="PASS">PASS</span></li>
  <li class="flow-node" data-gate-state="SKIP"><strong>149 · up-to-date</strong><small data-second-grep>Пропущен</small><span class="lesson-status" data-status="SKIP">SKIP</span></li>
  <li class="flow-node" data-gate-state="PASS"><strong>Следующая операция</strong><small data-branch-next>Проверить пути → запустить контейнерную проверку → проверить Manifest</small><span class="lesson-status" data-status="PASS">PASS</span></li>
</ol>

{% include source-preview.html source=branch_source label="Развилка по журналу · строки 142–155" path=script revision=revision start=142 open=true %}
</div>

Если в условном журнале есть оба маркера, срабатывает первая проверка,
и ветка `else` пропускается. Скрипт проверяет маркеры по очереди.
Эта развилка не проверяет формат всего журнала и число маркеров.
Сценарии с отсутствующим, похожим или противоречивым маркером придуманы
для демонстрации.

## 3.12. Сравниваем списки файлов до и после {#file-comparison}

{% include source-preview.html source=compare_source label="Начало validate_candidate_paths · строки 12–19" path=script revision=revision start=12 open=true %}

`$1` внутри функции — её первый аргумент. `local before_paths="$1"`
сохраняет путь к списку, который `main` записал
[до подготовки](#snapshot). После подготовки `find` снова обходит
`app-editors/zed`, а `sort -z` упорядочивает новый список. Обе стороны
`comm` должны быть отсортированы по одним правилам, включая одинаковую
локаль. Ключ `-z` разделяет записи байтом NUL.

У `comm` три колонки. В первую попадают записи только из первого
списка, во вторую — только из второго, в третью — общие записи.
`-1` скрывает первую колонку, `-3` скрывает третью, а `-13` объединяет
эти два ключа. В скрипте остаются пути, появившиеся после подготовки.

<div class="figure lesson-figure shell-lab" data-shell-lab="file-comparison" markdown="1">
<h3>Какие пути увидит comm</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Изменение <select name="scenario">
    <option value="pair">Новые ebuild и patch</option><option value="ebuild">Только новый ebuild</option><option value="patch">Только новый patch</option><option value="unexpected">Добавить лишний файл</option><option value="removed">Удалить старый ebuild</option><option value="edited">Изменить содержимое старого ebuild</option>
  </select></label>
  <fieldset class="candidate-toggles"><legend>Колонки результата</legend>
    <label><input name="column1" type="checkbox">1 · только до</label>
    <label><input name="column2" type="checkbox" checked>2 · только после</label>
    <label><input name="column3" type="checkbox">3 · общие</label>
  </fieldset>
</div>
<p class="model-result" role="status">С ключами <code>-z -13</code> остаются два добавленных пути.</p>

<div class="shell-file-grid candidate-comparison-inputs">
  <div class="workspace"><strong>До подготовки</strong><pre><code data-compare-before>app-editors/zed/Manifest
app-editors/zed/files/zed-1.28.1-wayland-only.patch
app-editors/zed/zed-1.28.1.ebuild</code></pre></div>
  <div class="workspace"><strong>После подготовки</strong><pre><code data-compare-after>app-editors/zed/Manifest
app-editors/zed/files/zed-1.28.1-wayland-only.patch
app-editors/zed/files/zed-1.29.0-wayland-only.patch
app-editors/zed/zed-1.28.1.ebuild
app-editors/zed/zed-1.29.0.ebuild</code></pre></div>
</div>
<div class="candidate-merge"><span aria-hidden="true">↓</span><code data-compare-command>comm -z -13 "$before_paths" &lt;(find app-editors/zed -type f -print0 | sort -z)</code></div>
<div class="candidate-grid candidate-columns" aria-label="Логические колонки comm">
  <div class="workspace" data-column="1" data-suppressed="true"><strong>Только до</strong><small data-column-state>Скрыта ключом -1</small><pre><code data-column-records>∅</code></pre></div>
  <div class="workspace" data-column="2" data-suppressed="false"><strong>Только после</strong><small data-column-state>В выводе</small><pre><code data-column-records>app-editors/zed/files/zed-1.29.0-wayland-only.patch
app-editors/zed/zed-1.29.0.ebuild</code></pre></div>
  <div class="workspace" data-column="3" data-suppressed="true"><strong>Общие пути</strong><small data-column-state>Скрыта ключом -3</small><pre><code data-column-records>app-editors/zed/Manifest
app-editors/zed/files/zed-1.28.1-wayland-only.patch
app-editors/zed/zed-1.28.1.ebuild</code></pre></div>
</div>
<div class="workspace candidate-record-output"><strong>Записи на выходе</strong><small>␀ обозначает границу записи. Отступы колонок здесь опущены.</small><pre><code data-compare-output>app-editors/zed/files/zed-1.29.0-wayland-only.patch ␀
app-editors/zed/zed-1.29.0.ebuild ␀</code></pre></div>
</div>

При изменении содержимого без переименования путь остаётся в третьей
колонке. Удалённый файл виден только в первой. С настройкой `-13`
оба события исключены из выводимого списка. Другие свойства кандидата
скрипт проверяет отдельно.

## 3.13. Что такое process substitution? {#process-substitution}

{% include source-preview.html source=process_source label="Вложенные подстановки · строки 17–19" path=script revision=revision start=17 open=true %}

- `$(command)` подставляет текст из stdout команды и убирает завершающие
  переводы строки.
- `<(command)` подставляет читаемый путь к потоку вывода команды.
  В Linux это может быть путь вроде `/dev/fd/63`. Номер дескриптора и
  способ реализации зависят от запуска и платформы.
- `command1 | command2` соединяет stdout первой команды со stdin второй.

Во фрагменте `< <(…)` первый `<` перенаправляет stdin `mapfile`.
Далее начинается `<(…)`, которое даёт путь к потоку `comm`.
Внутренняя подстановка работает как второй аргумент-файл `comm`,
а первый аргумент — сохранённый `"$before_paths"`. По обоим путям
`comm` читает NUL-разделённые записи.

<div class="figure lesson-figure shell-lab" data-shell-lab="process" markdown="1">
<h3>Внутренний и внешний поток</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Фрагмент <select name="stage">
    <option value="find">find</option><option value="sort">sort</option><option value="inner">Внутренняя подстановка</option><option value="comm">comm</option><option value="outer">Внешняя подстановка</option><option value="redirect">Перенаправление stdin</option><option value="mapfile">mapfile</option>
  </select></label>
</div>
<p class="model-result" role="status">find перечисляет обычные файлы и отправляет записи с NUL в stdin sort.</p>

<pre class="candidate-fragments" aria-label="Фрагменты строк 17–19"><code>  <span data-fragment="mapfile">mapfile -d '' -t candidate_paths</span> <span data-fragment="redirect">&lt;</span> <span data-fragment="outer">&lt;(</span>
    <span data-fragment="comm">comm -z -13 "$before_paths"</span> <span data-fragment="inner">&lt;(</span><span data-fragment="find" class="candidate-highlight">find app-editors/zed -type f -print0</span> | <span data-fragment="sort">sort -z</span><span data-fragment="inner">)</span>
  <span data-fragment="outer">)</span></code></pre>
<div class="candidate-process-layer" data-stage="outer">
  <strong>Внешняя <code>&lt;(…)</code> · stdout comm доступен через путь</strong>
  <div class="candidate-process-layer" data-stage="inner">
    <strong>Внутренняя <code>&lt;(…)</code> · второй аргумент comm</strong>
    <ol class="lesson-flow two-stage-flow" role="list">
      <li class="flow-node shell-focus" data-stage="find"><strong>find</strong><small>stdout · пути с NUL</small></li>
      <li class="flow-node" data-stage="sort"><strong>sort -z</strong><small>stdin → отсортированный stdout</small></li>
    </ol>
  </div>
  <div class="candidate-merge"><span aria-hidden="true">↓</span> Путь к внутреннему потоку</div>
  <div class="flow-node" data-stage="comm"><strong>comm</strong><small>Файл before_paths + путь к потоку sort → stdout с NUL</small></div>
</div>
<ol class="lesson-flow two-stage-flow candidate-process-exit" role="list">
  <li class="flow-node" data-stage="redirect"><strong>&lt; путь</strong><small>stdout comm становится stdin mapfile</small></li>
  <li class="flow-node" data-stage="mapfile"><strong>mapfile</strong><small>stdin → массив candidate_paths</small></li>
</ol>
</div>

Стрелки показывают передачу данных. Например, `sort` может читать
вывод `find` во время его работы. Передача не требует, чтобы процесс-производитель сначала завершился.

В отдельном примере производитель завершается с кодом 7,
а `mapfile` успешно читает пустой поток.

```bash
set -euo pipefail
mapfile -d '' -t rows < <(exit 7)
printf 'mapfile status=%s; length=%s\n' "$?" "${#rows[@]}"
```

```text
mapfile status=0; length=0
```

`pipefail` вычисляет статус конвейера с `|`. Подстановка процесса
в перенаправлении сама по себе не передаёт код производителя
команде-потребителю. В вызывающем коде здесь нет отдельной проверки
статуса каждого производителя.

## 3.14. Превращаем список файлов в массив Bash {#arrays}

Встроенная команда `mapfile -d '' -t candidate_paths` читает записи
в индексированный массив. Пустой аргумент `-d ''` задаёт разделитель NUL.
Ключ `-t` убирает разделитель из каждого сохранённого элемента.
Первый индекс — 0.

- `"${candidate_paths[0]}"` раскрывает элемент с индексом 0.
  Обращение к отсутствующему элементу этой формой при `nounset`
  может завершиться ошибкой.
- `"${#candidate_paths[@]}"` даёт число элементов.
- `"${candidate_paths[@]}"` даёт по одному слову на элемент.
  Кавычки сохраняют границы, даже если имя содержит пробелы.
  Пустой массив даёт ноль слов.

<div class="figure lesson-figure shell-lab" data-shell-lab="arrays" markdown="1">
<h3>Одна запись становится одним элементом</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Записи <select name="scenario">
    <option value="pair">Ebuild и patch</option><option value="empty">Пустой поток</option><option value="one">Только ebuild</option><option value="three">Ebuild, patch и лишний файл</option><option value="spaces">Путь с пробелами</option>
  </select></label>
</div>
<p class="model-result" role="status">mapfile прочитал две записи и заполнил индексы 0 и 1.</p>

{% include source-preview.html source=array_source label="Чтение массива и передача в printf · строки 17–20" path=script revision=revision start=17 open=true %}

<div class="workspace"><strong>Вход mapfile · записи с NUL</strong><pre><code data-array-input>app-editors/zed/files/zed-1.29.0-wayland-only.patch ␀
app-editors/zed/zed-1.29.0.ebuild ␀</code></pre></div>
<div class="candidate-merge"><span aria-hidden="true">↓</span> <code>mapfile -d '' -t</code></div>
<ul class="candidate-array" data-array-cells role="list">
  <li class="flow-node"><strong><code>candidate_paths[0]</code></strong><code>app-editors/zed/files/zed-1.29.0-wayland-only.patch</code></li>
  <li class="flow-node"><strong><code>candidate_paths[1]</code></strong><code>app-editors/zed/zed-1.29.0.ebuild</code></li>
</ul>
<div class="candidate-grid">
  <div class="workspace"><strong><code>${#candidate_paths[@]}</code></strong><code data-array-length>2</code></div>
  <div class="workspace"><strong><code>"${candidate_paths[0]}"</code></strong><code data-array-first>app-editors/zed/files/zed-1.29.0-wayland-only.patch</code></div>
  <div class="workspace"><strong><code>"${candidate_paths[@]}"</code></strong><pre><code data-array-words>1 → «app-editors/zed/files/zed-1.29.0-wayland-only.patch»
2 → «app-editors/zed/zed-1.29.0.ebuild»</code></pre></div>
</div>
</div>

На строке 20 каждый элемент приходит в `printf` отдельным аргументом.
Затем `printf` разделяет вывод переводами строк. Имя с переводом строки
на этом переходе может превратиться в несколько строк для `grep`,
хотя внутри массива оно было одним элементом.

## 3.15. Находим ebuild кандидата {#candidate-ebuild}

{% include source-preview.html source=ebuild_source label="Поиск ebuild · строка 20" path=script revision=revision start=20 open=true %}

`printf '%s\n'` печатает каждый аргумент как строку с переводом строки
в конце. Через `|` этот текст попадает в `grep -Ex`. Ключ `-E`
включает расширенное регулярное выражение, а `-x` требует совпадения всей
строки. `$(…)` получает вывод и присваивает его строковой переменной
`candidate_ebuild`, убрав завершающие переводы строки.

<div class="figure selector command-anatomy" data-selector data-label="Части выражения grep" markdown="1">
<h3>Из чего состоит шаблон</h3>
<div class="annotated-command" data-selection-controls role="group" aria-label="Части регулярного выражения"><code>'<span data-select="regex-directory">app-editors/zed/</span><span data-select="regex-package">zed-</span><span data-select="regex-number">[0-9]+</span><span data-select="regex-dot">\.</span><span data-highlight-for="regex-number">[0-9]+</span><span data-highlight-for="regex-dot">\.</span><span data-highlight-for="regex-number">[0-9]+</span><span data-select="regex-suffix">\.ebuild</span>'</code></div>
<div data-panel id="regex-directory" markdown="1">
Фиксированный каталог `app-editors/zed/`.
</div>
<div data-panel id="regex-package" markdown="1">
Фиксированное начало имени `zed-`.
</div>
<div data-panel id="regex-number" markdown="1">
Каждая группа `[0-9]+` принимает одну или больше цифр. Таких групп три.
</div>
<div data-panel id="regex-dot" markdown="1">
`\.` означает буквальную точку между числовыми компонентами.
</div>
<div data-panel id="regex-suffix" markdown="1">
Имя заканчивается буквальным суффиксом `.ebuild`. Ключ `-x` исключает продолжение после него.
</div>
</div>

<div class="figure lesson-figure shell-lab" data-shell-lab="regex" markdown="1">
<h3>Какие имена проходят grep -Ex</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Путь <select name="scenario">
    <option value="stable">Обычная версия 1.29.0</option><option value="revision">Ревизия -r1</option><option value="pre">Суффикс _pre1</option><option value="short">Два числа</option><option value="dots">Буквы вместо точек</option><option value="patch">Wayland patch</option><option value="directory">Другой каталог</option>
  </select></label>
</div>
<p class="model-result" role="status">MATCH · каталог, имя пакета, три числовых компонента и суффикс совпали.</p>

<div class="workspace"><strong>Строка на входе <code>grep -Ex</code></strong><code data-regex-path>app-editors/zed/zed-1.29.0.ebuild</code></div>

{% include source-preview.html source=ebuild_source label="Точное выражение grep · строка 20" path=script revision=revision start=20 open=true %}
</div>

Шаблон соответствует принятому здесь формату имени кандидата
с тремя числовыми компонентами. Проверка происхождения исходников
и общие правила версий Gentoo лежат за пределами этого выражения.

Если совпадений нет, `grep` возвращает 1. С `pipefail` конвейер и
присваивание тоже возвращают ненулевой статус, и обычный вызов функции
останавливается по `errexit`. Если совпали два ebuild, `grep` печатает
обе строки. Подстановка сохраняет перевод строки **между** ними.
Сортировка по версии и выбор первой записи здесь отсутствуют.
В обычном дереве пакета последующий `test -f "$candidate_ebuild"`
отклоняет единственный аргумент, в котором оказались два пути.

```text
app-editors/zed/zed-1.29.0.ebuild
app-editors/zed/zed-1.29.1.ebuild
```

## 3.16. Определяем путь к Wayland patch {#candidate-patch}

{% include source-preview.html source=patch_source label="Имя patch и проверки наличия · строки 21–23" path=script revision=revision start=21 open=true %}

`${candidate_ebuild%.ebuild}` снимает суффикс `.ebuild`.
Результат в кавычках становится аргументом `basename`.
Подстановка `$(basename …)` возвращает имя без каталога. Bash добавляет
к нему префикс `app-editors/zed/files/` и суффикс `-wayland-only.patch`.
Имя patch привязано к версии конкретного ebuild.

<div class="figure lesson-figure shell-lab" data-shell-lab="patch-path" markdown="1">
<h3>Из пути ebuild в путь patch</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Преобразование <select name="stage">
    <option value="input">Исходный путь</option><option value="suffix">Убрать .ebuild</option><option value="basename">Взять имя без каталога</option><option value="patch">Собрать путь patch</option>
  </select></label>
</div>
<p class="model-result" role="status">Вход — полный относительный путь ebuild кандидата.</p>

<pre class="candidate-fragments" aria-label="Фрагменты строки 21"><code>  candidate_patch="<span data-fragment="patch">app-editors/zed/files/</span><span data-fragment="basename">$(basename</span> "<span data-fragment="suffix">${</span><span data-fragment="input" class="candidate-highlight">candidate_ebuild</span><span data-fragment="suffix">%.ebuild}</span>"<span data-fragment="basename">)</span><span data-fragment="patch">-wayland-only.patch</span>"</code></pre>
<ol class="lesson-flow shell-sequence candidate-transform" role="list">
  <li class="flow-node shell-focus" data-stage="input"><strong>Вход</strong><code>app-editors/zed/zed-1.29.0.ebuild</code></li>
  <li class="flow-node" data-stage="suffix"><strong>Снять суффикс</strong><code>app-editors/zed/zed-1.29.0</code></li>
  <li class="flow-node" data-stage="basename"><strong>Взять имя</strong><code>zed-1.29.0</code></li>
  <li class="flow-node" data-stage="patch"><strong>Собрать путь</strong><code>app-editors/zed/files/zed-1.29.0-wayland-only.patch</code></li>
</ol>
</div>

`test -f` проверяет, что путь разрешается в обычный файл, поэтому
принимает и символическую ссылку на такой файл. Содержимое ebuild
и patch эти две команды не проверяют.

## 3.17. Проверяем допустимый набор новых файлов {#candidate-paths}

{% include source-preview.html source=allowlist_source label="Один или два новых пути · строки 24–31" path=script revision=revision start=24 open=true %}

`[` — команда, работающая как `test`, с обязательным закрывающим
аргументом `]`. Оператор `-eq` сравнивает целые числа. Оператор `=`
в `test` сравнивает строки. Если добавлен один путь, это должен быть
найденный ebuild, а проверка на строке 23 уже подтвердила наличие patch.
Такая проверка не устанавливает, сохранились ли прежние байты patch.

При двух путях первая часть конвейера печатает элементы массива и
сортирует строки. Внутри `<(…)` другой `printf` печатает ожидаемые
пути ebuild и patch, а `sort` упорядочивает их по тем же правилам.
`cmp -s -` тихо сравнивает байты из stdin (операнд `-`) с байтами
из второго операнда. Статус 0 означает равенство, 1 — различие, другой
код — ошибку. Сортировка делает результат независимым от порядка
подачи двух ожидаемых обычных имён.

{% include candidate-path-lab.html %}

Проверка наличия файлов, сравнение добавленных путей и проверка
содержимого отвечают на разные вопросы. Здесь `test -f` отвечает
на первый, а проверки числа и имён — на второй.

## 3.18. Получаем Portage atom и версию пакета {#identifiers}

{% include source-preview.html source=identifiers_source label="Сборка atom и версии · строки 33–36" path=script revision=revision start=33 open=true %}

`${variable#pattern}` удаляет кратчайший подходящий префикс,
а `${variable##pattern}` — самый длинный. Для суффикса эту пару
образуют `${variable%pattern}` и `${variable%%pattern}`.
Здесь `pattern` — шаблон оболочки. Например, `*` соответствует
любой последовательности символов.

В отдельном примере префикс `*/` может захватить один или два
каталога, а у суффикса `.*` есть две подходящие точки начала.

```bash
path=a/b/pkg.tar.gz
printf '%s\n' "${path#*/}" "${path##*/}" "${path%.*}" "${path%%.*}"
```

```text
b/pkg.tar.gz
pkg.tar.gz
a/b/pkg.tar
a/b/pkg
```

<div class="figure lesson-figure shell-lab" data-shell-lab="identifiers" markdown="1">
<h3>Что отрезается и что добавляется</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Шаг <select name="stage">
    <option value="atom-prefix">Atom · убрать путь к каталогу</option><option value="atom-category">Atom · добавить категорию</option><option value="atom-repository">Atom · заменить суффикс</option><option value="version-prefix">Версия · убрать путь и zed-</option><option value="version-suffix">Версия · убрать .ebuild</option>
  </select></label>
</div>
<p class="model-result" role="status">Шаблон */ захватывает префикс до последнего /, остаётся имя файла.</p>

<div class="workspace candidate-transform-detail">
  <strong>Вход</strong><code data-transform-input><mark>app-editors/zed/</mark>zed-1.29.0.ebuild</code>
  <strong>Шаблон</strong><code data-transform-pattern>${candidate_ebuild##*/}</code>
  <strong>Результат</strong><code data-transform-output>zed-1.29.0.ebuild</code>
</div>
<div class="shell-file-grid candidate-identifier-pair">
  <div class="workspace"><strong>Atom</strong><ol class="candidate-value-steps">
    <li data-stage="atom-input"><code>app-editors/zed/zed-1.29.0.ebuild</code></li>
    <li class="shell-focus" data-stage="atom-prefix"><code>zed-1.29.0.ebuild</code></li>
    <li data-stage="atom-category"><code>=app-editors/zed-1.29.0.ebuild</code></li>
    <li data-stage="atom-repository"><code>=app-editors/zed-1.29.0::zed-overlay</code></li>
  </ol></div>
  <div class="workspace"><strong>Версия</strong><ol class="candidate-value-steps">
    <li><code>app-editors/zed/zed-1.29.0.ebuild</code></li>
    <li data-stage="version-prefix"><code>1.29.0.ebuild</code></li>
    <li data-stage="version-suffix"><code>1.29.0</code></li>
  </ol></div>
</div>

{% include source-preview.html source=identifiers_source label="Преобразования · строки 33–36" path=script revision=revision start=33 open=true %}
</div>

В atom `=` запрашивает точную версию, `app-editors/zed` задаёт
категорию и пакет, `1.29.0` — версию, а `::zed-overlay`
ограничивает поиск этим репозиторием. В закреплённой ревизии
`candidate_atom` вычисляется, но дальше в этом скрипте не читается.
Контейнер собирает свой atom из `CANDIDATE_VERSION`.

### Как значения остаются доступны в main

Bash использует динамическую область видимости. Локальная переменная
активного вызова видна функциям, которые он вызывает. Здесь
`local before_paths="$1"` создаёт отдельную привязку в
`validate_candidate_paths`. Для `candidate_paths`,
`candidate_ebuild`, `candidate_patch`, `candidate_atom` и
`candidate_version` внутри неё объявления `local` нет. В данном
скрипте эти имена остаются доступны после возврата. Если бы вызывающая
функция объявила одно из имён локально, вложенная функция могла бы
обновить именно эту видимую привязку.

Самостоятельный пример с видимой локальной переменной и значением,
доступным за пределами вызова:

```bash
inner() { visible=updated; discovered=1.29.0; }
outer() { local visible=original; inner; printf '%s\n' "$visible"; }
outer
printf '%s\n' "$discovered"
```

Вывод — две строки, `updated` и `1.29.0`.

## 3.19. Передаём кандидата следующему скрипту {#independent-crates}

{% include source-preview.html source=container_call label="Проверка и передача аргументов · строки 143–147" path=script revision=revision start=143 open=true %}

После успешной проверки путей Bash запускает файл по указанному в
кавычках пути. Пара «обратная косая черта и перевод строки» продолжает
команду. Пробелы между выражениями разделяют четыре аргумента.
Кавычки сохраняют каждый раскрытый путь одним аргументом, даже если
в пути есть пробелы. `main` добавляет абсолютный путь временного
каталога перед двумя относительными путями. Следующий скрипт получает
полные пути к файлам независимо от своего рабочего каталога.

{% include source-preview.html source=container_args label="Приём аргументов · строки 5–8" path=container revision=revision start=5 open=true %}

<div class="figure lesson-figure shell-lab" data-shell-lab="transfer" markdown="1">
<h3>Четыре аргумента, четыре места назначения</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>Аргумент <select name="stage">
    <option value="version">$1 · версия</option><option value="ebuild">$2 · ebuild</option><option value="patch">$3 · patch</option><option value="overlay">$4 · каталог оверлея</option>
  </select></label>
</div>
<p class="model-result" role="status">candidate_version передаёт версию через $1 в переменную version.</p>

{% include source-preview.html source=container_call label="Вызывающая сторона · строки 143–147" path=script revision=revision start=143 open=true %}
{% include source-preview.html source=container_args label="Принимающая сторона · строки 5–8" path=container revision=revision start=5 open=true %}

<ul class="candidate-arguments" role="list">
  <li class="workspace shell-focus" data-stage="version"><div><code>candidate_version</code><span aria-hidden="true">→</span><code>$1 → version</code></div><code>1.29.0</code></li>
  <li class="workspace" data-stage="ebuild"><div><code>$disposable_workspace/$candidate_ebuild</code><span aria-hidden="true">→</span><code>$2 → candidate</code></div><code>/home/runner/work/_temp/zed-overlay/app-editors/zed/zed-1.29.0.ebuild</code></li>
  <li class="workspace" data-stage="patch"><div><code>$disposable_workspace/$candidate_patch</code><span aria-hidden="true">→</span><code>$3 → patch</code></div><code>/home/runner/work/_temp/zed-overlay/app-editors/zed/files/zed-1.29.0-wayland-only.patch</code></li>
  <li class="workspace" data-stage="overlay"><div><code>disposable_workspace</code><span aria-hidden="true">→</span><code>$4 → overlay</code></div><code>/home/runner/work/_temp/zed-overlay</code></li>
</ul>
</div>

Позиционные параметры задаёт вызов. Переменные окружения процесс
наследует отдельно. Например, `RUNNER_TEMP` не входит в эти четыре
аргумента. Проверки `${1:?...}` и следующие работают по тому же
правилу непустого значения, что и [проверки окружения](#environment).

`independent-crates.sh` получает и сверяет исходный архив Zed,
генерирует или повторно использует проверенный crates-архив,
подготавливает distfiles и синхронизирует сведения о crates в ebuild.
В контейнере он обновляет Manifest, проверяет архивы и разрешение
зависимостей Portage, сверяет Cargo snapshot и пробует применить patch
в режиме dry run. Полная сборка Zed и проверка его запуска относятся
к ручной приёмке.

## 3.20. Проверяем результат контейнерной валидации {#manifest-lifecycle}

{% include source-preview.html source=manifest_update label="Проверка после контейнера · строки 39–55" path=script revision=revision start=39 open=true %}

Строка 134 сохраняет исходный результат `sha256sum`. После
`--prepare` строка 140 требует равенства, потому что этот этап
добавляет файлы кандидата и сохраняет Manifest. После успешного
возврата из контейнерного скрипта строка 49 требует различия,
поскольку контейнер должен записать сведения о новых архивах в Manifest.
В обоих случаях сравнивается вся подставленная строка `sha256sum`,
включая имя файла. Перед вторым сравнением строка 42 проверяет
отсутствие `.git` в рабочей копии.

{% include candidate-manifest-lab.html %}

При успешном вычислении контрольной суммы различие подтверждает,
что изменилось сравниваемое значение. Корректность записей проверяют
дополнительные команды контейнера. Он создаёт Manifest, сверяет с ним
оба архива, проверяет сохранение прежних записей DIST и запускает
решение зависимостей для atom, собранного из версии.

{% include source-preview.html source=container_manifest label="Генерация Manifest · строка 132" path=container revision=revision start=132 %}
{% include source-preview.html source=container_archives label="Сверка архивов и прежних записей DIST · строки 136–138" path=container revision=revision start=136 %}
{% include source-preview.html source=container_atom label="Проверка разрешения зависимостей · строка 140" path=container revision=revision start=140 %}

У сравнения на строке 49 есть ещё одна граница. Статус `sha256sum`
в аргументе подстановки сам по себе не становится статусом `test`.
В отдельном примере в пустом каталоге `sha256sum` пишет ошибку в
stderr, подстановка возвращает пустую строку, а `test` считает её
отличной от сохранённой непустой строки.

```bash
set -euo pipefail
saved='условная контрольная строка'
if test "$saved" != "$(sha256sum ./absent-Manifest)"; then
  printf '%s\n' 'test: разные строки'
fi
```

Функция сама по себе не доказывает успешное чтение Manifest.
Успешное завершение контейнера и перечисленные выше проверки
также входят в условия этого пути.

## 3.21. Что происходит, если пакет уже актуален? {#up-to-date}

{% include source-preview.html source=current_source label="Ветка up-to-date · строки 148–155" path=script revision=revision start=148 open=true %}

Ветка `else` проверяет точный маркер `Result: up-to-date` и
дописывает его в сводку. Затем [та же разность списков](#file-comparison)
попадает в [массив](#arrays). Нового пакета нет, поэтому ожидается
ноль добавленных путей. Ветка пропускает запуск контейнера и
`validate_manifest_update`. Требование строки 140 сохранить Manifest
уже проверено до чтения журнала.

<div class="figure lesson-figure shell-lab" data-shell-lab="up-to-date" markdown="1">
<h3>Что проверяет пустой массив</h3>
<div class="lab-controls" data-lab-controls hidden>
  <label>После подготовки <select name="scenario">
    <option value="empty">Добавленных путей нет</option><option value="extra">Добавлен неожиданный файл</option>
  </select></label>
</div>
<p class="model-result" role="status">PASS · новых путей нет, условие на строке 154 выполнено.</p>

<div class="shell-file-grid">
  <div class="workspace"><strong>Сводка шага · строка 150</strong><code>Result: up-to-date</code></div>
  <div class="workspace"><strong>Массив добавленных путей</strong><code data-current-paths>∅ · длина 0</code></div>
</div>

{% include source-preview.html source=current_test label="Проверка длины · строка 154" path=script revision=revision start=154 open=true %}
</div>

Ноль добавленных путей допускает изменения содержимого уже
существующего файла или удаление пути. После успешной проверки
массива, как и после успешной проверки нового кандидата, поток
возвращается к общим проверкам. С этих двух вызовов начнётся
фаза 3.3.

{% include source-preview.html source=next_phase label="Общие проверки · строки 157–158" path=script revision=revision start=157 open=true %}
