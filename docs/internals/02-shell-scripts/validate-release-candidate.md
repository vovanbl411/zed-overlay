---
layout: handbook
title: Bash — подготовка кандидата Zed
description: От команды в GitHub Actions до первых проверок кандидата во временном каталоге.
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
{% capture next_source %}  if grep -Fxq 'Result: new-release' "$prepare_log"; then{% endcapture %}

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
  <figcaption>Выделены действия, которые разбираем до строки 140. При результате <code>up-to-date</code> скрипт пропускает проверку путей нового кандидата, контейнерный этап и создание handoff.</figcaption>
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

Эти проверки разрешают скрипту прочитать результат подготовки. Проверки
кандидата продолжаются после строки 142. Со следующего условия начнётся
фаза 3.2.

{% include source-preview.html source=next_source label="Следующая развилка · строка 142" path=script revision=revision start=142 open=true %}
