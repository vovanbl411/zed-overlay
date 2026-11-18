---
layout: handbook
title: Release watcher — разбор YAML
description: "Как workflow готовит кандидат, передаёт артефакты и проверяет их перед публикацией."
chapter: 1
eyebrow: Глава 01 / Продолжение
permalink: /internals/01-release-watcher/yaml/
sections:
  - { id: yaml, label: "2.1. Основы YAML" }
  - { id: triggers, label: "2.2. Название и события" }
  - { id: permissions, label: "2.3. Разрешения" }
  - { id: concurrency, label: "2.4. Параллельные запуски" }
  - { id: job-check, label: "2.5. Job 1 — начало выполнения workflow" }
  - { id: job-steps, label: "2.6. Job 1 — первые шаги выполнения" }
  - { id: job-results, label: "2.7. Job 1 — результаты и отчёт" }
  - { id: job-validate-handoff, label: "2.8. Job 2 — проверка handoff" }
---

{% assign reviewed_revision = '38531d4e4cfe0506f0f5f6b551c60897b6bea83c' %}
{% assign job2_script_revision = 'fbf4f2a6adcaa99a585fd487a9c77d024f2b7adf' %}
{% assign workflow_path = '.github/workflows/zed-release-watcher.yml' %}
{% assign docker_path = 'scripts/ci/independent-crates.sh' %}
{% assign candidate_path = 'scripts/ci/validate-release-candidate.sh' %}

## 2.1. Первые строки: учимся читать YAML {#yaml}

YAML — текстовый формат для описания структурированных данных. В этом файле
мы описываем настройки workflow. GitHub Actions читает структуру и по своим
правилам определяет, когда запустить workflow и в каком порядке выполнять
задания (jobs). Команды Bash или Python исполняются внутри отдельных шагов.
Строки YAML с настройками сами по себе команд не запускают.

Выберите конструкцию. Те же примеры есть в [разборе начала workflow](#triggers).

<div class="selector" data-selector data-label="Конструкции YAML" markdown="1">
<div class="selection-panel" data-panel data-label="Ключ и значение" id="yaml-pair" markdown="1">
### Ключ и значение · строка 2

```yaml
name: Zed release watcher
```

Слева от двоеточия стоит ключ `name`, справа — его значение `Zed release watcher`.
</div>
<div class="selection-panel" data-panel data-label="Вложенность" id="yaml-indent" markdown="1">
### Отступы и вложенность · строки 4–5

```yaml
on:
  schedule:
```

Два пробела перед `schedule` показывают, что этот раздел вложен в `on`.
Если изменить уровень отступа, раздел окажется в другой части структуры или
файл перестанет читаться как корректный YAML.
</div>
<div class="selection-panel" data-panel data-label="Элемент списка" id="yaml-list" markdown="1">
### Элемент списка · строка 8

```yaml
    - cron: "17 6 * * *"
```

Дефис с пробелом открывает элемент списка. Здесь он содержит настройку
`cron`. На том же уровне можно добавить ещё один элемент с расписанием.
</div>
<div class="selection-panel" data-panel data-label="Комментарий" id="yaml-comment" markdown="1">
### Комментарий · строки 6–7

```yaml
    # Запуск в 06:17 UTC снижает вероятность попасть в пик нагрузки GitHub Actions
    # в начале часа.
```

На этих строках `#` начинает комментарий. Комментарии помогают объяснить
выбор настройки и не меняют её значение. В строке в кавычках `#` остаётся
частью текста.
</div>
</div>

## 2.2. Название и события запуска {#triggers}

По расписанию оверлей автоматически проверяет, вышел ли стабильный Zed.
Ручной запуск удобен, когда сопровождающему нужно проверить обновление до
следующего утра или подготовить кандидат без публикации.

Выберите строку или группу строк, чтобы прочитать пояснение.

{% capture triggers_source %}---
name: Zed release watcher

on:
  schedule:
    # Запуск в 06:17 UTC снижает вероятность попасть в пик нагрузки GitHub Actions
    # в начале часа.
    - cron: "17 6 * * *"
  workflow_dispatch:
    inputs:
      independent_validation:
        description: Validate independent crates generation without publishing
        type: boolean
        default: false
        required: false{% endcapture %}

<div class="selector" data-selector markdown="1">
{% include source-lines.html source=triggers_source start=1 label="Строки 1–15 workflow" interactive=true comment="#" %}
<div class="selection-panel" data-panel data-lines="1" data-label="Строка 1" id="line-1" markdown="1">
### Строка 1 · начало документа

`---` явно отмечает начало YAML-документа. Здесь документ один, поэтому
маркер можно опустить. На запуск watcher это не повлияет.
</div>
<div class="selection-panel" data-panel data-lines="2" data-label="Строка 2" id="line-2" markdown="1">
### Строка 2 · имя workflow

GitHub показывает `Zed release watcher` во вкладке Actions. Если изменить
`name`, отображаемое имя поменяется, а события запуска останутся прежними.
</div>
<div class="selection-panel" data-panel data-lines="4" data-label="Строка 4" id="line-4" markdown="1">
### Строка 4 · события

Под ключом `on` перечислены события, при которых GitHub запускает workflow.
Здесь их два. Например, обычная отправка коммита в репозиторий сама по себе
watcher не запускает: в списке нет события `push`.
</div>
<div class="selection-panel" data-panel data-lines="5" data-label="Строка 5" id="line-5" markdown="1">
### Строка 5 · расписание

`schedule` включает запуск по времени. GitHub берёт конфигурацию из
последнего коммита ветки по умолчанию. Изменение расписания в отдельной ветке
не меняет автоматические запуски. Если убрать `schedule`, останется ручной запуск.
</div>
<div class="selection-panel" data-panel data-lines="6-7" data-label="Строки 6–7" id="line-6" markdown="1">
### Строки 6–7 · почему выбрана 17-я минута

В начале часа нагрузка GitHub Actions может быть выше. Отступ в 17 минут
снижает вероятность попасть в этот пик. Фактический старт может задержаться.
Правка комментария сама по себе расписание не меняет.
</div>
<div class="selection-panel" data-panel data-lines="8" data-label="Строка 8" id="line-8" markdown="1">
### Строка 8 · время запуска

`cron` задаёт ежедневную проверку в 06:17 UTC. Если заменить первые два
числа, изменится минута и час проверки. Ниже можно попробовать это на примере.
</div>
<div class="selection-panel" data-panel data-lines="9" data-label="Строка 9" id="line-9" markdown="1">
### Строка 9 · ручной запуск

`workflow_dispatch` позволяет запустить watcher по запросу. Например,
сопровождающий может выбрать workflow во вкладке Actions и нажать
**Run workflow**. Если убрать это событие, из двух способов останется расписание.
</div>
<div class="selection-panel" data-panel data-lines="10" data-label="Строка 10" id="line-10" markdown="1">
### Строка 10 · параметры ручного запуска

В `inputs` описаны параметры ручного запуска. В оверлее объявлен один
переключатель. Если добавить ещё один параметр, в форме запуска появится
новое поле. При запуске по расписанию эта форма не используется.
</div>
<div class="selection-panel" data-panel data-lines="11" data-label="Строка 11" id="line-11" markdown="1">
### Строка 11 · имя параметра

`independent_validation` — имя, по которому остальная часть workflow читает
значение переключателя. При переименовании нужно обновить и обращения к нему.
</div>
<div class="selection-panel" data-panel data-lines="12" data-label="Строка 12" id="line-12" markdown="1">
### Строка 12 · подсказка

`description` объясняет сопровождающему, что переключатель включает
проверку подготовки crates без публикации. GitHub показывает этот текст
в форме запуска. Его изменение не переключает режим.
</div>
<div class="selection-panel" data-panel data-lines="13" data-label="Строка 13" id="line-13" markdown="1">
### Строка 13 · тип значения

`type: boolean` означает логический тип с двумя значениями, `true` и
`false`. В форме GitHub это флажок. Если выбрать другой тип, изменятся и
возможные значения, и то, как их нужно обрабатывать в workflow.
</div>
<div class="selection-panel" data-panel data-lines="14" data-label="Строка 14" id="line-14" markdown="1">
### Строка 14 · значение по умолчанию

`default: false` оставляет флажок снятым. При ручном запуске по умолчанию
действует обычный режим, в котором публикация возможна при выполнении её
условий. Если поставить `true` по умолчанию, ручной запуск без явного выбора
будет выполнять только проверку.
</div>
<div class="selection-panel" data-panel data-lines="15" data-label="Строка 15" id="line-15" markdown="1">
### Строка 15 · обязательность

`required: false` разрешает не передавать параметр ручного запуска.
Значение в этом случае берётся из `default`. Если сделать параметр
обязательным, он должен получить значение. Логическое `false` остаётся
допустимым значением.
</div>
</div>

При `independent_validation=true` watcher ищет стабильную версию Zed по
тем же правилам, что и при обычном запуске. Если есть обновление, он может
сгенерировать новый архив crates или проверить и использовать уже опубликованный.
В этом режиме watcher не публикует релиз с архивом и не создаёт PR.
Если пакет уже актуален, подготовка архива пропускается в обоих режимах.

{% capture handoff_upload %}{% raw %}      # Между jobs передаём только handoff с ограниченным списком файлов;
      # временный workspace и остальные результаты проверки остаются внутри job.
      - name: Upload release handoff
        if: steps.prepare-and-validate.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff
          if-no-files-found: error
          retention-days: 14

      - name: Upload crates distribution bundle
        if: steps.prepare-and-validate.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution
          if-no-files-found: error
          retention-days: 14{% endraw %}{% endcapture %}

{% include source-preview.html source=handoff_upload label="Условия загрузки артефактов, строки 71–89" path=workflow_path revision=reviewed_revision start=71 comment="#" %}

{% capture publish_guard %}  # PR создаётся только после успешной проверки handoff и при запуске из main;
  # остальные события не доходят до job с правами на запись.
  publish-draft-release-pr:
    name: Publish Draft release PR
    needs: [check, validate-release-handoff]
    if: >-
      needs.check.outputs.handoff_ready == 'true' &&
      !(github.event_name == 'workflow_dispatch' && inputs.independent_validation) &&
      needs['validate-release-handoff'].result == 'success' &&
      github.ref == 'refs/heads/main'{% endcapture %}

{% include source-preview.html source=publish_guard label="Условия публикации, строки 149–158" path=workflow_path revision=reviewed_revision start=149 comment="#" %}

### Расписание в пяти полях {#cron}

Поля cron читаются слева направо. Три звёздочки в нашем расписании означают,
что подходит любой допустимый день месяца, любой месяц и любой день недели.
В этом учебном примере можно менять час и минуту ежедневной проверки.

<form class="panel" data-cron aria-label="Ежедневное расписание">
  <div class="walkthrough-controls" data-cron-controls hidden>
    <label>Час
      <select name="hour">
        {% for hour in (0..23) %}<option{% if hour == 6 %} selected{% endif %}>{{ hour }}</option>{% endfor %}
      </select>
    </label>
    <label>Минута
      <select name="minute">
        {% for minute in (0..59) %}<option{% if minute == 17 %} selected{% endif %}>{{ minute }}</option>{% endfor %}
      </select>
    </label>
    <button type="reset">Вернуть 06:17 UTC</button>
  </div>
  <dl class="cron-fields">
    <div class="flow-node"><dt>Минута <span>(0–59)</span></dt><dd data-cron-field>17</dd></div>
    <div class="flow-node"><dt>Час <span>(0–23)</span></dt><dd data-cron-field>6</dd></div>
    <div class="flow-node"><dt>День месяца</dt><dd>*</dd></div>
    <div class="flow-node"><dt>Месяц</dt><dd>*</dd></div>
    <div class="flow-node"><dt>День недели</dt><dd>*</dd></div>
  </dl>
  <p class="cron-result" data-cron-result role="status"><code>17 6 * * *</code> · <span>Ежедневно в 06:17 UTC.</span></p>
</form>

[События `schedule` и `workflow_dispatch` в документации GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## 2.3. Разрешения: permissions {#permissions}

Перед каждым заданием GitHub выдаёт временный `GITHUB_TOKEN`. Задание может
использовать этот токен, чтобы обратиться к GitHub от имени автоматизации
репозитория. В `permissions` перечислены права токена.
Если перечислить права явно, остальные настраиваемые права получают значение
`none`. Ограничение токена касается доступа к GitHub. Задание по-прежнему
может работать с файлами на runner и скачивать данные из сети.
[Как GitHub выдаёт токен заданию](https://docs.github.com/en/actions/concepts/security/github_token).

{% capture permissions_source %}permissions:
  contents: read{% endcapture %}
{% capture permissions_panels %}
<div class="selection-panel" data-panel data-lines="17" data-label="Строка 17" id="line-17" markdown="1">
### Строка 17 · права по умолчанию

Верхнеуровневый ключ `permissions` задаёт права для заданий workflow.
Задание может явно указать собственный набор прав. Если убрать этот ключ,
задания без собственных настроек будут зависеть от прав по умолчанию в GitHub.
</div>
<div class="selection-panel" data-panel data-lines="18" data-label="Строка 18" id="line-18" markdown="1">
### Строка 18 · чтение содержимого

`contents: read` разрешает читать содержимое репозитория, включая сведения
о коммитах. Значение `write` расширило бы права по умолчанию для заданий,
у которых нет собственного блока `permissions`.
</div>
{% endcapture %}

{% include source-preview.html source=permissions_source label="Настройки на уровне workflow, строки 17–18" path=workflow_path revision=reviewed_revision start=17 panels=permissions_panels open=true %}

Задания watcher получают только те права, которые нужны им для работы. Это
принцип **минимальных привилегий**. [Роли заданий в общей архитектуре]({{ '/internals/01-release-watcher/' | relative_url }}#jobs).

### Что разрешено токену {#token-capabilities}

{% capture check_permissions %}    permissions:
      contents: read{% endcapture %}
{% capture publish_permissions %}    permissions:
      contents: write
      pull-requests: write{% endcapture %}
{% assign permission_modes = 'Job 1 / Job 2|Job 3' | split: '|' %}
{% assign token_operations = 'read:Читать содержимое репозитория|read:Читать сведения о коммитах|publish:Создавать ветки|publish:Публиковать GitHub Releases|publish:Создавать pull requests|admin:Менять административные настройки репозитория' | split: '|' %}

<div class="selector" data-selector data-label="Права заданий" markdown="1">
{% for mode in permission_modes %}
{% if forloop.first %}
  {% assign panel_id = 'read-permissions' %}
  {% assign token_access = 'read' %}
{% else %}
  {% assign panel_id = 'publish-permissions' %}
  {% assign token_access = 'publish' %}
{% endif %}
<div class="selection-panel permissions-panel" data-panel data-label="{{ mode }}" id="{{ panel_id }}" markdown="1">
#### {{ mode }}

{% if panel_id == 'read-permissions' %}
{% include source-lines.html source=check_permissions start=29 label="Права Job 1, строки 29–30" %}

Job 1 готовит кандидат, а Job 2 повторно проверяет переданные файлы и сверяет
их с коммитом. Обоим достаточно `contents: read`, чтобы прочитать файлы и
сведения о коммитах. [Разбор объявления Job 1](#job-declaration).

{% include source-preview.html source=check_permissions label="Тот же блок в Job 2, строки 112–113" path=workflow_path revision=reviewed_revision start=112 %}

{% else %}
{% include source-lines.html source=publish_permissions start=160 label="Права Job 3, строки 160–162" %}

Job 3 использует `contents: write`, чтобы опубликовать релиз с архивом
crates и отправить ветку. Для создания черновика PR дополнительно нужно
`pull-requests: write`. Если убрать одно из этих прав, GitHub отклонит
операции, для которых оно требуется.
{% endif %}

<ul class="token-capabilities" role="list" aria-label="Возможности токена">
  {% for operation in token_operations %}
  {% assign capability = operation | split: ':' %}
  <li>
    <span>{{ capability[1] }}</span>
    {% if capability[0] == 'read' or capability[0] == token_access %}
    <span class="permission-status permission-allowed"><span aria-hidden="true">✓</span> Разрешено</span>
    {% else %}
    <span class="permission-status permission-absent">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false">
        <rect x="3.5" y="7" width="9" height="7" rx="1"/>
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>
      </svg>
      Нет права
    </span>
    {% endif %}
  </li>
  {% endfor %}
</ul>
</div>
{% endfor %}
</div>

Даже с нужным правом операция может не пройти. На неё влияют правила
репозитория (rulesets), защита веток и настройки GitHub Actions. Например,
для создания PR в настройках репозитория должно быть разрешено создание
pull requests из GitHub Actions.
[Справочник `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) ·
[Настройки создания PR](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).

## 2.4. Управление параллельными запусками {#concurrency}

Ручной запуск может поступить, пока watcher ещё занят проверкой по
расписанию. Блок `concurrency` определяет, как GitHub Actions обработает
эти запуски.

{% capture concurrency_source %}
concurrency:
  group: zed-release-watcher
  cancel-in-progress: false{% endcapture %}

<div class="selector" data-selector markdown="1">
{% include source-lines.html source=concurrency_source start=19 label="Настройки параллельных запусков" interactive=true %}
<div class="selection-panel" data-panel data-lines="20" data-label="Строка 20" id="line-20" markdown="1">
### Строка 20 · общий лимит

Блок `concurrency` стоит на уровне workflow, поэтому ограничение действует
на весь запуск. Если убрать блок, эта конфигурация больше не будет
удерживать два запуска watcher от одновременной работы.
</div>
<div class="selection-panel" data-panel data-lines="21" data-label="Строка 21" id="line-21" markdown="1">
### Строка 21 · имя группы

Постоянное имя `zed-release-watcher` объединяет запуски из разных веток
одного репозитория. Если включить в имя группы название ветки, запуски
из разных веток смогут выполняться одновременно.
</div>
<div class="selection-panel" data-panel data-lines="22" data-label="Строка 22" id="line-22" markdown="1">
### Строка 22 · отмена текущего запуска

При `cancel-in-progress: false` новый запуск в той же группе не отменяет
текущий автоматически. При `true` GitHub запрашивает отмену текущего
запуска. Ручная отмена, тайм-ауты и другие причины остановки возможны и
при `false`.
</div>
</div>

В этой конфигурации применяются ограничения GitHub по умолчанию. В группе
может быть одновременно до одного выполняющегося запуска и до одного
ожидающего. Следующий запуск занимает место в ожидании, а прежний ожидающий
отменяется. Порядок запуска по времени отправки запросов не гарантирован.
[Правила параллельных запусков в GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

### Как меняется состояние запусков {#concurrency-model}

На учебной схеме время идёт от первого события к последнему. По умолчанию
выбрано значение `false` из файла workflow, а в примере участвуют два запуска.
Переключатели меняют только сценарий на странице.

<div data-concurrency>
  <div class="walkthrough-controls" data-concurrency-controls hidden>
    <label><code>cancel-in-progress</code>
      <select>
        <option>false</option>
        <option>true</option>
      </select>
    </label>
    <label><input type="checkbox"> Добавить третий запуск (C)</label>
  </div>
  <div aria-live="polite">
    <figure class="figure" data-concurrency-scenario="false-2" aria-labelledby="timeline-a">
      <h3 id="timeline-a"><code>false</code> · два запуска</h3>
      <ol class="concurrency-timeline" aria-label="События по порядку">
        <li class="running"><strong>A выполняется</strong><span>A занял группу.</span></li>
        <li class="pending"><strong>B ожидает</strong><span>A продолжает работу.</span></li>
        <li class="running"><strong>B может начаться</strong><span>A завершился.</span></li>
      </ol>
      <figcaption>B ждёт, пока A освободит группу.</figcaption>
    </figure>
    <figure class="figure" data-concurrency-scenario="false-3" aria-labelledby="timeline-b">
      <h3 id="timeline-b"><code>false</code> · три запуска</h3>
      <ol class="concurrency-timeline" aria-label="События по порядку">
        <li class="running"><strong>A выполняется</strong><span>A занял группу.</span></li>
        <li class="pending"><strong>B ожидает</strong><span>A продолжает работу.</span></li>
        <li class="canceled"><strong>B отменён</strong><span>C занял место в ожидании.</span></li>
        <li class="running"><strong>C может начаться</strong><span>A завершился.</span></li>
      </ol>
      <figcaption>C приходит, пока A ещё работает, и заменяет B в единственном месте для ожидания.</figcaption>
    </figure>
    <figure class="figure" data-concurrency-scenario="true-2" aria-labelledby="timeline-c">
      <h3 id="timeline-c"><code>true</code> · два запуска</h3>
      <ol class="concurrency-timeline" aria-label="События по порядку">
        <li class="running"><strong>A выполняется</strong><span>A занял группу.</span></li>
        <li class="pending"><strong>B ожидает</strong><span>Запрошена отмена A.</span></li>
        <li class="canceled"><strong>A отменён</strong><span>GitHub обработал запрос.</span></li>
        <li class="running"><strong>B может начаться</strong><span>Группа освободилась.</span></li>
      </ol>
      <figcaption>При поступлении B GitHub запрашивает отмену A. Группа освобождается после обработки запроса.</figcaption>
    </figure>
    <figure class="figure" data-concurrency-scenario="true-3" aria-labelledby="timeline-d">
      <h3 id="timeline-d"><code>true</code> · три запуска</h3>
      <ol class="concurrency-timeline" aria-label="События по порядку">
        <li class="running"><strong>A выполняется</strong><span>A занял группу.</span></li>
        <li class="pending"><strong>B ожидает</strong><span>Запрошена отмена A.</span></li>
        <li class="running"><strong>B выполняется</strong><span>A отменён, B успел начаться.</span></li>
        <li class="pending"><strong>C ожидает</strong><span>Запрошена отмена B.</span></li>
        <li class="canceled"><strong>B отменён</strong><span>GitHub обработал запрос.</span></li>
        <li class="running"><strong>C может начаться</strong><span>Группа освободилась.</span></li>
      </ol>
      <figcaption>В этом примере C приходит после того, как B уже начал работу. Поэтому запрос на отмену касается выполняющегося B.</figcaption>
    </figure>
  </div>
</div>

### Почему в оверлее выбрано `false`

Представим, что запуск A создал черновик GitHub Release для crates и начал
загружать файлы. В это время поступает запуск B. При автоматической отмене
A загрузка может прерваться, и в репозитории останется черновик с неполным
набором файлов. Если на следующей попытке скрипт публикации обнаружит
конфликтующий черновик, он остановится с ошибкой и оставит состояние
для ручного восстановления. При `false` запуск A может закончить загрузку,
даже если B уже поступил и ждёт. Это снижает риск именно такого сбоя.

{% capture draft_conflict %}    tag = release_tag(version)
    matches = [r for r in all_releases(client) if r.get('tag_name') == tag]
    if len(matches) > 1:
        raise GitHubError('Multiple releases use the requested tag')
    if matches:
        release = matches[0]
        if release.get('draft') is not False:
            raise GitHubError('Conflicting draft release requires manual recovery')
        require_published_tag(client, version)
        verify_remote_assets(client, release, version, bundle, draft=False){% endcapture %}

{% include source-preview.html source=draft_conflict label="Проверка конфликтующего черновика, строки 229–238" path="scripts/crates_github.py" revision=reviewed_revision start=229 %}

## 2.5. Job 1 — начало выполнения workflow {#job-check}

Первое задание ищет новую стабильную версию Zed. Если находит обновление,
оно готовит и проверяет кандидат. Строки 24–38 задают среду запуска,
права и значения, которые задание может передать дальше.

### 2.5.1. Объявление job {#job-declaration}

Выберите строку или группу строк, чтобы прочитать пояснение.

{% capture job_declaration %}jobs:
  check:
    name: Check stable Zed release
    runs-on: ubuntu-24.04
    timeout-minutes: 90
{{ check_permissions }}{% endcapture %}

<div class="selector" data-selector markdown="1">
{% include source-lines.html source=job_declaration start=24 label="Объявление Job 1, строки 24–30" interactive=true %}
<div class="selection-panel" data-panel data-lines="24" data-label="Строка 24" id="line-24" markdown="1">
#### Строка 24 · `jobs`

Ключ `jobs` открывает список заданий workflow. Каждое задание объявляют
под собственным ключом внутри этого блока.
</div>
<div class="selection-panel" data-panel data-lines="25" data-label="Строка 25" id="line-25" markdown="1">
#### Строка 25 · `check`

`check` — идентификатор задания. Зависимые задания объявляют его в
`needs` и читают его значения через `needs.check`. При переименовании
идентификатора нужно обновить эти ссылки.
</div>
<div class="selection-panel" data-panel data-lines="26" data-label="Строка 26" id="line-26" markdown="1">
#### Строка 26 · `name`

**Check stable Zed release** — подпись в интерфейсе GitHub Actions.
Её можно поменять, сохранив идентификатор `check` и все ссылки на него.
</div>
<div class="selection-panel" data-panel data-lines="27" data-label="Строка 27" id="line-27" markdown="1">
#### Строка 27 · `runs-on`

Метка `ubuntu-24.04` выбирает runner GitHub с Ubuntu 24.04. Runner выполняет
шаги задания на выделенной для него машине.
</div>
<div class="selection-panel" data-panel data-lines="28" data-label="Строка 28" id="line-28" markdown="1">
#### Строка 28 · `timeout-minutes`

GitHub Actions отводит заданию `check` до 90 минут выполнения.
</div>
<div class="selection-panel" data-panel data-lines="29-30" data-label="Строки 29–30" id="line-29" markdown="1">
#### Строки 29–30 · `permissions` {#check-token-permissions}

Токен Job 1 получает `contents: read` для чтения содержимого репозитория.
Подготовка идёт во временной копии на runner. Загрузка артефактов передаёт
файлы между заданиями, а публикацией релиза и записью ветки занимается
Job 3. [Права заданий](#token-capabilities).
</div>
</div>

### 2.5.2. Почему Ubuntu, если мы используем Gentoo? {#gentoo-on-ubuntu}

Runner GitHub — исполнитель шагов задания. Ubuntu 24.04 — операционная
система его машины, то есть хоста для Docker. На хосте работают Git, Bash,
Python и Docker. Здесь же генератор `pycargoebuild` готовит архив crates,
если архив нужно создать.

Образ Docker содержит файлы, из которых Docker создаёт контейнер.
Когда контейнер запущен, его процессы видят собственную файловую систему
с программами и библиотеками. Эта часть среды называется userspace.
Контейнеры Linux используют ядро хоста, поэтому для проверки в userspace
Gentoo отдельная виртуальная машина Gentoo не нужна.

Portage — пакетный менеджер Gentoo. Для проверки ему нужны данные
репозитория Gentoo, в том числе описания пакетов и метаданные. Docker
подключает эти файлы в контейнер stage3 как том.

<figure class="figure runner-diagram" aria-labelledby="runner-diagram-caption">
  <figcaption id="runner-diagram-caption">Как Job 1 запускает проверку кандидата</figcaption>
  <strong>GitHub-hosted runner · Ubuntu 24.04</strong>
  <div class="runner-diagram-inputs">
    <div>
      <div class="flow-node"><strong>Инструменты хоста</strong><small>Git, Bash, Python, Docker</small></div>
      <div class="flow-arrow"><span aria-hidden="true">↓</span> Запуск через <code>docker run</code></div>
    </div>
    <div>
      <div class="flow-node"><strong>Контейнер данных</strong><small>Создан из <code>gentoo/portage</code>. Том репозитория <code>/var/db/repos/gentoo</code>.</small></div>
      <div class="flow-arrow"><span aria-hidden="true">↓</span> Том через <code>--volumes-from</code></div>
    </div>
    <div>
      <div class="flow-node"><strong>Каталоги хоста</strong><small>Временная копия оверлея и рабочие файлы проверки.</small></div>
      <div class="flow-arrow"><span aria-hidden="true">↓</span> Каталоги через <code>--mount</code></div>
    </div>
  </div>
  <div class="flow-node artifact"><strong>Контейнер проверки · <code>gentoo/stage3</code></strong><small>Userspace Gentoo с Portage. Внутри доступны репозиторий Gentoo, копия оверлея в <code>/overlay</code> и рабочие файлы в <code>/experiment</code>.</small></div>
</figure>

`prepare_portage` вызывает `docker create`. Контейнер остаётся
остановленным и служит источником тома. Команда `/bin/true`, указанная
при создании, здесь не запускается.

{% capture portage_container %}prepare_portage() {
  docker create --name zed-independent-portage "$GENTOO_PORTAGE_IMAGE" /bin/true > /dev/null
}{% endcapture %}

{% include source-preview.html source=portage_container label="prepare_portage · создание контейнера с данными, строки 58–60" path=docker_path revision=reviewed_revision start=58 %}

На пути `generation` функция `prepare_generator` устанавливает генератор в
Python-окружение на хосте. Затем она запускает короткоживущий контейнер
stage3 с тем же томом, читает через `cat` файл `license-mapping.conf`
и сохраняет его на хосте для генератора.

{% capture generator_setup %}prepare_generator() {
  python3 -m venv "$work/venv"
  env -u GITHUB_TOKEN "$work/venv/bin/python" -m pip install 'pycargoebuild==0.16.0'
  test "$("$work/venv/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("pycargoebuild"))')" = 0.16.0
  docker run --rm --volumes-from zed-independent-portage --entrypoint cat "$GENTOO_STAGE3_IMAGE" /var/db/repos/gentoo/metadata/license-mapping.conf > "$work/license-mapping.conf"
  test -s "$work/license-mapping.conf"
  summary 'Generator: pycargoebuild 0.16.0'
}{% endcapture %}

{% include source-preview.html source=generator_setup label="prepare_generator · установка генератора и чтение данных, строки 62–69" path=docker_path revision=reviewed_revision start=62 %}

После генерации или повторного использования архива `validate_candidate`
запускает контейнер stage3 для проверки. Внутри Portage обновляет
Manifest временной копии и проверяет разрешение зависимостей через
`emerge -pv`. Скрипт также проверяет исходники и применимость патча.
Полная компиляция Zed в эту проверку не входит.

{% capture validation_container %}validate_candidate() {
  cp "$overlay/app-editors/zed/Manifest" "$work/original-Manifest"
  docker run --rm --volumes-from zed-independent-portage \
    --mount "type=bind,src=$overlay,dst=/overlay" \
    --mount "type=bind,src=$work,dst=/experiment" \
    --workdir /overlay \
    --env CANDIDATE_VERSION="$version" \
    --env EXPECTED_ARCHIVE_SHA256="$(sha256sum "$archive" | cut -d' ' -f1)" \
    --env EXPECTED_SOURCE_SHA256="$source_hash" \
    --env CANDIDATE_EBUILD="/overlay/${candidate#"$overlay"/}" \
    --env CANDIDATE_PATCH="/overlay/${patch#"$overlay"/}" \
    "$GENTOO_STAGE3_IMAGE" /bin/bash -euo pipefail -c '
      mkdir -p /etc/portage/repos.conf /etc/portage/package.accept_keywords /etc/portage/package.use
      printf "%s\n" "[DEFAULT]" "main-repo = gentoo" "[gentoo]" "location = /var/db/repos/gentoo" "auto-sync = no" "[zed-overlay]" "location = /overlay" "masters = gentoo" "auto-sync = no" > /etc/portage/repos.conf/zed-overlay.conf{% endcapture %}

{% include source-preview.html source=validation_container label="validate_candidate · запуск stage3 и подключение данных, строки 111–124" path=docker_path revision=reviewed_revision start=111 %}

[Как Docker запускает контейнеры](https://docs.docker.com/engine/containers/run/).

### 2.5.3. Ограничение времени выполнения {#job-timeout}

`timeout-minutes: 90` ограничивает время выполнения `check`.
У остальных заданий свои пределы, поэтому суммарная длительность workflow
может быть больше. Лимит нужен на случай зависшего процесса, затянувшейся
сетевой операции или долгой перепаковки архива. Если работа за отведённое
время не завершилась, GitHub Actions может остановить её и освободить runner.

В проверочном запуске для Zed 1.28.1 подготовка и проверка кандидата заняли
1058 секунд (17 мин 38 с). Из них 937 секунд ушло на генерацию,
включая около 903 секунд на перепаковку. Первый production-запуск тоже
генерировал архив, затем опубликовал его и остановился на проверке перед
созданием ветки. Время подготовки кандидата, время работы `check` и
полная длительность workflow охватывают разные этапы. Эти замеры относятся
к конкретным запускам. [Проверочный запуск](https://github.com/vovanbl411/zed-overlay/actions/runs/44129394269) ·
[Production-запуск](https://github.com/vovanbl411/zed-overlay/actions/runs/44142769356) ·
[История запусков]({{ '/internals/01-release-watcher/' | relative_url }}#history).

<form class="panel" data-timeout aria-labelledby="timeout-model-title">
  <h4 id="timeout-model-title">Учебная модель тайм-аута</h4>
  <div class="walkthrough-controls timeout-controls" data-timeout-controls hidden>
    <label>
      Лимит задания <strong data-timeout-limit aria-hidden="true">90 мин</strong>
      <input type="range" name="limit" min="5" max="120" value="90" aria-label="Лимит задания в минутах">
    </label>
    <label>
      Нужно для выполнения <strong data-timeout-required aria-hidden="true">21 мин</strong>
      <input type="range" name="required" min="1" max="150" value="21" aria-label="Время, необходимое для выполнения, в минутах">
    </label>
    <button type="reset">Сбросить</button>
  </div>
  <div aria-hidden="true">
    <div class="timeout-track" data-timeout-track>
      <span class="timeout-required"></span>
      <span class="timeout-completed"></span>
      <span class="timeout-boundary"></span>
    </div>
    <div class="timeout-scale"><span>0</span><span>150 мин</span></div>
  </div>
  <p class="model-note">Сплошная полоса показывает выполненную работу, штриховка — незавершённую. Вертикальная черта отмечает лимит.</p>
  <p class="model-result" role="status" data-timeout-result data-status="PASS">Нужно 21 мин при лимите 90 мин. Выполнено 21 мин из 21. Задание укладывается в лимит.</p>
</form>

Модель показывает, сколько работы по времени укладывается в лимит.
Результат шагов и точный момент отмены она не предсказывает.

### 2.5.4. Outputs: как задания передают результаты {#job-outputs}

Output — именованное значение, которое шаг может передать другим шагам.
На строке 31 ключ `outputs` открывает список значений, доступных уже
другим заданиям. В этом списке workflow связывает каждое имя с output
одного из шагов. Outputs подходят для небольших значений. Сами файлы,
например JSON с метаданными, передаются в артефакте.

{% capture output_mapping %}{% raw %}    outputs:
      handoff_ready: ${{ steps.prepare-and-validate.outputs.handoff_ready }}
      archive_mode: ${{ steps.prepare-and-validate.outputs.archive_mode }}
      metadata_sha256: ${{ steps.prepare-and-validate.outputs.metadata_sha256 }}
      started_at: ${{ steps.run-clock.outputs.started_at }}{% endraw %}{% endcapture %}

{% include source-preview.html source=output_mapping label="Объявление outputs в Job 1, строки 31–35" path=workflow_path revision=reviewed_revision start=31 %}

#### Строка 32 · `handoff_ready`

Строка `"true"` означает, что проверенный комплект передачи (handoff)
готов. Скрипт сначала записывает `handoff_ready=false` в `$GITHUB_OUTPUT`.
Это путь к файлу, который runner предоставляет шагу для записи outputs.

{% capture handoff_initial %}  echo "handoff_ready=false" >> "$GITHUB_OUTPUT"{% endcapture %}

{% include source-preview.html source=handoff_initial label="Начальное значение handoff_ready, строка 125" path=candidate_path revision=reviewed_revision start=125 %}

После подготовки и проверки handoff скрипт дописывает `handoff_ready=true`.
Если имя встречается дважды, итоговое значение берётся из последней записи.
Для актуального пакета и в режиме validation-only остаётся `"false"`.
Сбой шага подготовки останавливает обычное выполнение зависимых заданий.

{% capture handoff_success %}  PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
    --create-handoff "$handoff_directory" \
    --candidate-version "$candidate_version" \
    --base-commit "$GITHUB_SHA"
  metadata_hash="$(sha256sum "$RUNNER_TEMP/crates-distribution/zed-${candidate_version}-overlay-crates.json" | cut -d' ' -f1)"
  [[ "$metadata_hash" =~ ^[0-9a-f]{64}$ ]]
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
    --bundle "$RUNNER_TEMP/crates-distribution" --handoff "$handoff_directory" \
    --base-commit "$GITHUB_SHA" --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
    --metadata-sha256 "$metadata_hash"
  echo "Sanitized release handoff and distribution bundle: OK"
  echo "Metadata SHA256: $metadata_hash" | tee -a "$GITHUB_STEP_SUMMARY"
  echo "metadata_sha256=$metadata_hash" >> "$GITHUB_OUTPUT"
  echo "handoff_ready=true" >> "$GITHUB_OUTPUT"{% endcapture %}

{% include source-preview.html source=handoff_success label="Проверка комплекта и запись outputs, строки 95–108" path=candidate_path revision=reviewed_revision start=95 %}

#### Строка 33 · `archive_mode`

`independent-crates.sh` выбирает `generation` или `reuse` по результату
поиска опубликованного архива. После проверки он записывает режим в
`logs/result.txt`. На пути нового релиза с включённой передачей handoff
скрипт читает этот файл и пишет output перед вызовом `create_release_handoff`.
Зависимые задания используют режим после успешной подготовки handoff.
При актуальном пакете и в режиме validation-only output остаётся незаполненным.

{% capture archive_selection %}summary '## Independent crates preparation'
timed 'Upstream source acquisition' acquire_source
mode="$(PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" lookup --version "$version")"
summary "Result: $mode"
timed 'Portage environment preparation' prepare_portage
case "$mode" in
  generation)
    timed 'Generator environment preparation' prepare_generator
    timed 'Archive generation and validation' generate
    ;;
  reuse) timed 'Archive download and validation' reuse ;;
  *) echo "ERROR: invalid archive selection" >&2; exit 1 ;;
esac
timed 'Metadata and source integrity validation' verify_inputs
timed 'GIT_CRATES synchronization' sync_metadata
timed 'Candidate validation' validate_candidate
mkdir "$RUNNER_TEMP/crates-distribution"
cp "$archive" "$metadata" "$RUNNER_TEMP/crates-distribution/"
printf '%s\n' "$mode" > "$work/logs/result.txt"
summary "Total independent preparation and validation: $((SECONDS - start_total))s"{% endcapture %}

{% include source-preview.html source=archive_selection label="Выбор режима и запись result.txt, строки 150–169" path=docker_path revision=reviewed_revision start=150 %}

{% capture archive_output %}  if [ "$validation_mode" = true ]; then
    echo "Total candidate preparation and validation: $((SECONDS - total_started))s" | tee -a "$GITHUB_STEP_SUMMARY"
    echo "Validation-only: release handoff disabled"
  elif grep -Fxq 'Result: new-release' "$prepare_log"; then
    local archive_mode
    archive_mode="$(cat "$RUNNER_TEMP/zed-independent/logs/result.txt")"
    case "$archive_mode" in generation|reuse) ;; *) echo "Invalid archive mode" >&2; exit 1 ;; esac
    echo "archive_mode=$archive_mode" >> "$GITHUB_OUTPUT"
    create_release_handoff
  fi{% endcapture %}

{% include source-preview.html source=archive_output label="Чтение result.txt и запись archive_mode, строки 160–169" path=candidate_path revision=reviewed_revision start=160 %}

#### Строка 34 · `metadata_sha256`

Скрипт вычисляет SHA256 JSON-файла с метаданными crates и записывает его
при подготовке handoff. Job 2 получает ожидаемую сумму через output
уже после скачивания артефакта и сверяет её с суммой скачанного JSON.
Сверка проверяет соответствие файла ожидаемому значению. Для подтверждения
авторства файла нужны отдельные доказательства.

{% capture metadata_consumer %}{% raw %}          EXPECTED_METADATA_SHA256: ${{ needs.check.outputs.metadata_sha256 }}
        shell: bash
        run: |
          set -euo pipefail
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
            --validate-handoff "$RUNNER_TEMP/release-handoff" \
            --expected-base-commit "$GITHUB_SHA"
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
            --bundle "$RUNNER_TEMP/crates-distribution" \
            --handoff "$RUNNER_TEMP/release-handoff" --base-commit "$GITHUB_SHA" \
            --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
            --metadata-sha256 "$EXPECTED_METADATA_SHA256"{% endraw %}{% endcapture %}

{% include source-preview.html source=metadata_consumer label="Ожидаемый SHA256 получает Job 2, строки 135–146" path=workflow_path revision=reviewed_revision start=135 %}

#### Строка 35 · `started_at`

Шаг `run-clock` записывает Unix timestamp. Команда `date +%s` возвращает
число секунд с 00:00:00 UTC 1 января 1970 года. В отчётах из текущего
значения вычитают `started_at`, чтобы получить прошедшие секунды.
Отсчёт начинается при выполнении шага, уже после ожидания runner.

{% capture run_clock %}      - name: Record workflow start
        id: run-clock
        run: echo "started_at=$(date +%s)" >> "$GITHUB_OUTPUT"{% endcapture %}

{% include source-preview.html source=run_clock label="Шаг run-clock, строки 40–42" path=workflow_path revision=reviewed_revision start=40 %}

{% capture report_clock %}{% raw %}      - name: Report check processing time
        if: always()
        env:
          CHECK_STARTED_AT: ${{ steps.run-clock.outputs.started_at }}
          HANDOFF_READY: ${{ steps.prepare-and-validate.outputs.handoff_ready }}
        run: |
          if [[ "$CHECK_STARTED_AT" =~ ^[0-9]+$ ]]; then
            elapsed=$(( $(date +%s) - CHECK_STARTED_AT ))
            echo "Check processing: ${elapsed}s" >> "$GITHUB_STEP_SUMMARY"
            if [[ "$HANDOFF_READY" != true ]]; then
              echo "Total workflow processing: ${elapsed}s" >> "$GITHUB_STEP_SUMMARY"
            fi
          fi{% endraw %}{% endcapture %}

{% include source-preview.html source=report_clock label="Отчёт о времени Job 1, строки 91–103" path=workflow_path revision=reviewed_revision start=91 %}

#### Из чего состоит выражение GitHub Actions

В строке 32 слева от двоеточия стоит имя output задания `handoff_ready`.
Справа GitHub Actions вычисляет {% raw %}`${{ steps.prepare-and-validate.outputs.handoff_ready }}`{% endraw %}:

- {% raw %}`${{ ... }}`{% endraw %} обозначает выражение GitHub Actions.
- `steps` содержит сведения о шагах текущего задания.
- `prepare-and-validate` — идентификатор шага подготовки.
- `outputs` содержит именованные результаты этого шага.
- `handoff_ready` выбирает конкретное значение.

В другом задании контекст `needs` даёт доступ к явно указанным в зависимостях
заданиям. Так `needs.check.outputs.handoff_ready` читает значение,
которое `check` объявил своим output. В условии `if` GitHub Actions
может вычислять выражение без внешней обёртки.
[Справочник по контекстам GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts).

{% capture handoff_consumer %}  validate-release-handoff:
    name: Validate release handoff
    needs: check
    if: needs.check.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation){% endcapture %}

{% include source-preview.html source=handoff_consumer label="Зависимость и условие Job 2, строки 107–110" path=workflow_path revision=reviewed_revision start=107 %}

<figure class="figure" data-output-flow aria-labelledby="output-flow-title">
  <h4 id="output-flow-title">Путешествие одного output</h4>
  <p>Учебная модель передачи данных. Предположим, что Job 1 завершился успешно.</p>
  <div class="walkthrough-controls" data-output-controls hidden>
    <label><input type="checkbox" data-handoff-ready> Handoff успешно подготовлен</label>
  </div>
  <ol class="output-stages">
    <li class="flow-node">
      <strong>Bash-скрипт</strong>
      <pre><code>handoff_ready=false</code><code data-handoff-write hidden>
handoff_ready=true</code></pre>
      <small>Записи в файл шага <code>$GITHUB_OUTPUT</code>, который предоставляет runner.</small>
    </li>
    <li class="flow-node">
      <strong>Output шага</strong>
      <code>steps.prepare-and-validate.outputs.handoff_ready</code>
      <small>Последняя запись даёт строку <code data-handoff-value>"false"</code>.</small>
    </li>
    <li class="flow-node">
      <strong>Объявление output задания</strong>
      <code>{% raw %}handoff_ready: ${{ steps.prepare-and-validate.outputs.handoff_ready }}{% endraw %}</code>
      <small>Workflow явно передаёт значение шага через output задания.</small>
    </li>
    <li class="flow-node">
      <strong>Зависимое задание</strong>
      <code>needs.check.outputs.handoff_ready</code>
      <small>Получает строку <code data-handoff-value>"false"</code> из Job 1.</small>
    </li>
    <li class="flow-node">
      <strong>Проверка условия</strong>
      <code>needs.check.outputs.handoff_ready == 'true'</code>
      <p class="model-result" role="status" data-output-decision data-status="SKIP">Результат false. Проверка handoff пропускается.</p>
    </li>
  </ol>
  <p class="model-note">Здесь показана часть условия. Для запуска действуют и другие требования. Сбой задания и успешное выполнение со строкой <code>"false"</code> дают разные результаты задания.</p>
</figure>

### 2.5.5. Переменные окружения и Docker images {#job-env}

Строка 36 открывает блок `env`. GitHub Actions делает эти переменные
окружения доступными шагам задания. Строка 37 задаёт образ с данными
Portage, строка 38 — образ со средой Gentoo для проверки.

{% capture job_environment %}    env:
      GENTOO_PORTAGE_IMAGE: gentoo/portage@sha256:ce69e5b771bfe9404731e846b835346c34f2c82817ac3626f13af198689a1961
      GENTOO_STAGE3_IMAGE: gentoo/stage3@sha256:d8536e52677e3efe4caf048ca588bc685bc2d24d7fdfc882de1cdc6d38c81d96{% endcapture %}

{% include source-preview.html source=job_environment label="Переменные Job 1, строки 36–38" path=workflow_path revision=reviewed_revision start=36 %}

При запуске Bash подставляет значения `"$GENTOO_PORTAGE_IMAGE"` и
`"$GENTOO_STAGE3_IMAGE"` вместо имён переменных. Docker получает готовые
ссылки на образы как аргументы команд. В [Docker-командах выше](#gentoo-on-ubuntu)
`prepare_portage` передаёт первую ссылку в `docker create`,
а `prepare_generator` и `validate_candidate` передают вторую в `docker run`.
Внутри контейнера своё окружение. Переменные задания появляются там
через явную передачу, например через `--env`, или из настроек самого
образа и контейнера. В команде проверки через `--env` передают, например,
`CANDIDATE_VERSION`.

Обе ссылки заданы в одном месте, поэтому видно, какие версии базы
репозитория и userspace Gentoo использует Job 1. Ссылка `gentoo/stage3:latest`
содержит тег — имя, которое издатель может переназначить. Ссылка с
`@sha256:…` закрепляет дайджест. Он идентифицирует конкретный манифест
образа или индекс образов для нескольких платформ.

<figure class="figure" data-image-reference aria-labelledby="image-reference-title">
  <h4 id="image-reference-title">Тег или дайджест</h4>
  <p>В учебной модели используются вымышленные сокращённые дайджесты. Оба образа предназначены для одной платформы и остаются доступны после публикации.</p>
  <div class="walkthrough-controls" data-image-controls hidden>
    <label>Тип ссылки
      <select data-image-address>
        <option value="digest" selected>Дайджест</option>
        <option value="tag">Тег</option>
      </select>
    </label>
    <label><input type="checkbox" data-image-published> Опубликован новый образ</label>
  </div>
  <div class="image-map">
    <div class="flow-node"><strong>Выбранная ссылка</strong><br><code data-image-ref>gentoo/stage3@sha256:aaa...</code></div>
    <div class="image-targets">
      <div>
        <div class="flow-arrow" aria-hidden="true"><span data-image-arrow="A">↓</span></div>
        <div class="flow-node artifact" data-image-target="A"><strong>Образ A</strong><br><code>sha256:aaa...</code></div>
      </div>
      <div>
        <div class="flow-arrow" aria-hidden="true"><span data-image-arrow="B" hidden>↓</span></div>
        <div class="flow-node" data-image-target="B"><strong>Образ B</strong><br><code>sha256:bbb...</code></div>
      </div>
    </div>
  </div>
  <p class="model-result" role="status" data-image-result>Тег latest пока указывает на A. Закреплённый дайджест выбирает образ A.</p>
</figure>

В этой модели издатель при выпуске B переводит `latest` на B. Ссылка с
дайджестом A продолжает выбирать A. Чтобы перейти на B, сопровождающий
меняет закреплённый дайджест. На практике Docker может взять образ из
локального кеша. Обновление тега в реестре и скачивание нового образа на
хост — отдельные события, скачивание зависит от настроек pull.

Watcher закрепляет оба дайджеста, чтобы изменение тегов не меняло
userspace Gentoo или набор данных Portage при очередной проверке. Образы
обновляются явной правкой workflow. Дайджест фиксирует выбранное содержимое
образа. Для доступности образа нужен реестр или локальная копия, для
подтверждения издателя — отдельная проверка, а воспроизводимость сборки
зависит также от остальных входных данных.
[Ссылки на образы в Docker](https://docs.docker.com/engine/containers/run/#image-references).

## 2.6. Job 1 — первые шаги выполнения {#job-steps}

### 2.6.1. Что такое steps и чем отличаются run и uses? {#step-explorer}

{% assign source_revision = 'b3fd7f3f01fcf9f4e8d39059fffcee1df3270256' %}

{% capture job_steps %}{% raw %}    steps:
      - name: Record workflow start
        id: run-clock
        run: echo "started_at=$(date +%s)" >> "$GITHUB_OUTPUT"

      - name: Check out the overlay
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          persist-credentials: false

      - name: Check overlay policy
        run: PYTHONDONTWRITEBYTECODE=1 python3 scripts/overlay_policy.py

      - name: Run unit tests
        run: PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v

      - name: Prepare and validate disposable candidate
        id: prepare-and-validate
        env:
          GITHUB_TOKEN: ${{ github.token }}
          INDEPENDENT_VALIDATION: ${{ github.event_name == 'workflow_dispatch' && inputs.independent_validation && 'true' || 'false' }}
        run: scripts/ci/validate-release-candidate.sh{% endraw %}{% endcapture %}

{% include source-preview.html source=job_steps label="Блок steps, строки 39–60" path=workflow_path revision=reviewed_revision start=39 comment="#" %}

Блок `steps` задаёт порядок действий внутри задания. В GitHub Actions
`name` подписывает шаг для человека, а `id` даёт ему идентификатор, по
которому к нему может обратиться workflow. `run` запускает команду или
скрипт. `uses` вызывает готовый action, а `with` передаёт ему параметры.

Шаги Job 1 используют одну файловую систему runner. Поэтому Python находит
файлы, которые скачал checkout. Каждый `run` выполняется в отдельном
процессе оболочки. Обычная переменная предыдущего Bash-процесса сама по
себе в следующий шаг не попадёт. Для передачи именованного результата
есть [outputs](#job-outputs).

<div class="selector figure step-explorer" data-selector data-label="Порядок шагов Job 1" markdown="1">
  <ol class="step-rail" data-selection-controls aria-label="Порядок шагов Job 1" hidden>
    <li><button type="button" data-select="step-clock"><small><code>run</code> · 40–42</small>Record workflow start</button></li>
    <li><button type="button" data-select="step-checkout"><small><code class="action-kind">uses</code> · 44–47</small>Check out the overlay</button></li>
    <li><button type="button" data-select="step-policy"><small><code>run</code> · 49–50</small>Check overlay policy</button></li>
    <li><button type="button" data-select="step-tests"><small><code>run</code> · 52–53</small>Run unit tests</button></li>
    <li><button type="button" data-select="step-candidate"><small><code>run</code> · 55–60</small>Prepare and validate disposable candidate</button></li>
  </ol>

<div class="selection-panel step-detail" data-panel id="step-clock" markdown="1">
#### Record workflow start

{% include source-lines.html source=run_clock start=40 label="Record workflow start, строки 40–42" %}

Записывает время начала отсчёта в output шага. [Разбор шага](#step-time).
</div>

<div class="selection-panel step-detail" data-panel id="step-checkout" markdown="1">
#### Check out the overlay

{% capture step_checkout %}      - name: Check out the overlay
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          persist-credentials: false{% endcapture %}

{% include source-lines.html source=step_checkout start=44 label="Check out the overlay, строки 44–47" %}

Помещает файлы оверлея в рабочий каталог runner. [Разбор шага](#step-checkout-explained).
</div>

<div class="selection-panel step-detail" data-panel id="step-policy" markdown="1">
#### Check overlay policy

{% capture step_policy %}      - name: Check overlay policy
        run: PYTHONDONTWRITEBYTECODE=1 python3 scripts/overlay_policy.py{% endcapture %}

{% include source-lines.html source=step_policy start=49 label="Check overlay policy, строки 49–50" %}

Проверяет правила репозитория до подготовки кандидата. [Разбор шага](#overlay-policy-step).
</div>

<div class="selection-panel step-detail" data-panel id="step-tests" markdown="1">
#### Run unit tests

{% capture step_tests %}      - name: Run unit tests
        run: PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v{% endcapture %}

{% include source-lines.html source=step_tests start=52 label="Run unit tests, строки 52–53" %}

Запускает тесты скриптов оверлея. [Разбор шага](#unit-tests-step).
</div>

<div class="selection-panel step-detail" data-panel id="step-candidate" markdown="1">
#### Prepare and validate disposable candidate

{% capture step_candidate %}{% raw %}      - name: Prepare and validate disposable candidate
        id: prepare-and-validate
        env:
          GITHUB_TOKEN: ${{ github.token }}
          INDEPENDENT_VALIDATION: ${{ github.event_name == 'workflow_dispatch' && inputs.independent_validation && 'true' || 'false' }}
        run: scripts/ci/validate-release-candidate.sh{% endraw %}{% endcapture %}

{% include source-lines.html source=step_candidate start=55 label="Prepare and validate disposable candidate, строки 55–60" %}

Передаёт скрипту токен чтения и режим проверки. [Разбор шага](#step-preparation).
</div>
</div>

### 2.6.2. Фиксируем время начала работы {#step-time}

{% include source-preview.html source=run_clock label="Строки 40–42" path=workflow_path revision=reviewed_revision start=40 comment="#" open=true %}

Отсчёт начинается до checkout, чтобы учесть время на получение
репозитория. Начальное ожидание runner в этот интервал не входит. В последующих заданиях отсчёт от той же точки
может включать ожидание между jobs. GitHub Actions читает `started_at`
из файла шага `run-clock`. Строка 35 [объявляет его output задания](#job-outputs).

<div class="figure selector command-anatomy" data-selector data-label="Фрагменты команды Bash" markdown="1">
<h4>Как Bash записывает время</h4>
<div class="annotated-command" data-selection-controls role="group" aria-label="Фрагменты команды Bash"><code><span data-select="cmd-echo">echo</span> "<span data-select="cmd-output">started_at=</span><span class="command-substitution" data-highlight-for="cmd-substitution"><span data-select="cmd-substitution" aria-label="Подстановка команды: $(date +%s)">$(</span><span data-select="cmd-date">date +%s</span>)</span>" <span data-select="cmd-append">&gt;&gt;</span> <span data-select="cmd-file">"$GITHUB_OUTPUT"</span></code></div>

<div data-panel id="cmd-echo" markdown="1">
**`echo`** печатает сформированный текст и перевод строки. Перенаправление отправляет эту строку в файл.
</div>
<div data-panel id="cmd-output" markdown="1">
**`started_at=`** задаёт имя output в записи вида `имя=значение`. Для Bash это часть аргумента `echo`.
</div>
<div data-panel id="cmd-substitution" markdown="1">
**`$(date +%s)`** запускает вложенную команду, убирает завершающий перевод строки из её вывода и подставляет число после `started_at=`.
</div>
<div data-panel id="cmd-date" markdown="1">
**`date +%s`** печатает Unix timestamp, то есть число секунд с 1 января 1970 года, 00:00:00 UTC.
</div>
<div data-panel id="cmd-append" markdown="1">
**`>>`** дописывает строку в конец файла. Одинарный `>` при открытии файла обнулил бы его содержимое.
</div>
<div data-panel id="cmd-file" markdown="1">
**`"$GITHUB_OUTPUT"`** раскрывается в путь к файлу, который GitHub Actions выделяет этому шагу. Кавычки сохраняют путь целиком, даже если в нём есть пробелы.
</div>
</div>

<figure class="figure lesson-figure" data-elapsed aria-labelledby="elapsed-title">
  <h4 id="elapsed-title">От двух отметок к длительности</h4>
  <div class="elapsed-axis">
    <div><code>started_at</code><strong>1790000000</strong></div>
    <span aria-hidden="true"></span>
    <div><code>Текущий date +%s</code><strong data-current-time>1790000075</strong></div>
  </div>
  <label class="elapsed-slider" hidden data-elapsed-control>Прошло секунд <strong data-elapsed-seconds>75</strong><input type="range" min="0" max="600" value="75"></label>
  <p class="lab-terminal" role="status"><code data-elapsed-equation>1790000075 − 1790000000 = 75 с</code><strong data-elapsed-duration>1 мин 15 с</strong></p>
  <figcaption>Учебные значения. Разность Unix timestamps сразу даёт секунды, без перевода местного времени между часовыми поясами.</figcaption>
</figure>

### 2.6.3. Получаем копию нашего репозитория {#step-checkout-explained}

{% include source-preview.html source=step_checkout label="Строки 44–47" path=workflow_path revision=reviewed_revision start=44 comment="#" open=true %}

`actions/checkout` получает файлы репозитория для ревизии, связанной с
событием запуска, и размещает их в `$GITHUB_WORKSPACE`. При запуске по
расписанию это ревизия ветки по умолчанию, при ручном запуске — коммит
выбранной ветки или тега. Здесь используется shallow checkout с
`fetch-depth: 1` по умолчанию. В рабочем каталоге есть дерево файлов
выбранного коммита, а глубина Git-истории ограничена одним коммитом.
[Документация закреплённой версии checkout](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1).

<figure class="figure lesson-figure" aria-labelledby="checkout-tree-title">
  <h4 id="checkout-tree-title">Как файлы попадают на runner</h4>
  <ol class="lesson-flow checkout-flow" role="list">
    <li class="flow-node"><strong>Репозиторий на GitHub</strong><small>Ревизия события</small></li>
    <li class="flow-node"><strong><code>actions/checkout</code></strong><small>Получает файлы</small></li>
    <li class="flow-node workspace"><strong>Ubuntu runner</strong>
      <code>$GITHUB_WORKSPACE</code>
      <pre aria-label="Дерево локальной копии"><code>├── .git/
├── .github/
├── app-editors/
├── metadata/
├── profiles/
├── scripts/
├── tests/
├── AGENTS.md
└── README.md</code></pre>
      <small>Отсюда запускаются следующие команды.</small>
    </li>
  </ol>
</figure>

Ссылка `uses: actions/checkout@v7` выбирала бы ревизию, на которую сейчас
указывает тег `v7`. Тег можно передвинуть. В строке 45 полный SHA закрепляет
конкретный коммит action, а комментарий `# v7.0.1` помогает человеку
узнать версию. Это тот же принцип выбора фиксированного содержимого, что
и в [примере с тегом и дайджестом Docker](#job-env). Доверие к выбранному
коду и наличие уязвимостей проверяют отдельно.

### 2.6.4. Зачем нужен persist-credentials: false? {#checkout-credentials}

{% capture checkout_input %}        with:
          persist-credentials: false{% endcapture %}

{% include source-preview.html source=checkout_input label="Строки 46–47" path=workflow_path revision=reviewed_revision start=46 comment="#" open=true %}

[Разрешения Job 1](#check-token-permissions) определяют, что токен может
делать на GitHub. `persist-credentials` определяет, останется ли после
checkout настройка Git-аутентификации для следующих команд. При `false`
сам токен задания остаётся доступен GitHub Actions. Шаг может явно
получить его через контекст, как это сделано в [строке 58](#step-preparation).
[Параметр в документации checkout v7](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1#usage).

<figure class="figure lesson-figure" data-credentials aria-labelledby="credentials-title">
  <h4 id="credentials-title">Что остаётся после checkout</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label>Настройка checkout
      <select>
        <option value="false">persist-credentials: false</option>
        <option value="true">persist-credentials: true</option>
      </select>
    </label>
  </div>
  <div class="credential-map">
    <div class="credential-heading"><strong>Checkout action</strong><span>граница шага</span><strong>Следующие шаги</strong></div>
    <div class="credential-lane" data-path="open"><span><span class="credential-icon file-icon" aria-hidden="true"></span> Файлы получены</span><span class="lane-connector" aria-hidden="true"></span><strong>Файлы доступны</strong></div>
    <div class="credential-lane" data-path="closed" data-auth-lane><span><span class="credential-icon key-icon" aria-hidden="true"></span> Git-аутентификация</span><span class="lane-connector" aria-hidden="true"></span><strong data-auth-state>Настройка не передана</strong></div>
  </div>
  <p class="model-result" role="status" data-auth-result>Checkout оставляет файлы. Следующая команда Git не получает аутентификацию из настройки checkout.</p>
</figure>

Оверлею нужны локальные файлы для проверок, поэтому checkout оставляет
аутентификацию только на время своего шага. При `true` последующие
команды Git могли бы пользоваться сохранённой настройкой с теми же
правами токена. При `false` последующие шаги всё ещё могут явно настроить
свою аутентификацию или использовать токен для запросов к API.

### 2.6.5. Проверяем правила нашего overlay {#overlay-policy-step}

{% include source-preview.html source=step_policy label="Строки 49–50" path=workflow_path revision=reviewed_revision start=49 comment="#" open=true %}

Присваивание перед командой передаёт переменную только запускаемому
процессу и его окружению. `PYTHONDONTWRITEBYTECODE=1` просит Python не
создавать кеши байт-кода `.pyc` при импорте. Скрипт по-прежнему может
записывать другие файлы. `python3` запускает интерпретатор, а
`scripts/overlay_policy.py` указывает файл проверки.

Скрипт проверяет имя репозитория, `masters = gentoo` и
`thin-manifests = true`, а также наличие `metadata.xml` и `Manifest`.
Он ищет ebuild для Zed и для каждого ebuild проверяет ссылку в `PATCHES`
на соответствующий версии Wayland-патч и наличие этого патча. Патч
должен быть unified diff, сохранять Wayland и убирать X11 и screen capture.
Добавление `x11`, `screen-capture` или `scap/wayland` вызывает ошибку.
Отдельно проверяется, что Git не отслеживает `metadata/md5-cache`.

{% capture policy_implementation %}    repository_root = repository_root.resolve()
    repo_name_path = repository_root / "profiles/repo_name"
    require_file(repo_name_path)
    if repo_name_path.read_text(encoding="utf-8").strip() != REPOSITORY_NAME:
        raise OverlayPolicyError(f"profiles/repo_name must be '{REPOSITORY_NAME}'.")

    layout_path = repository_root / "metadata/layout.conf"
    require_file(layout_path)
    settings = layout_settings(layout_path)
    for key, expected_value in REQUIRED_LAYOUT.items():
        if settings.get(key) != expected_value:
            raise OverlayPolicyError(
                f"metadata/layout.conf must set {key} = {expected_value}."
            )

    package_dir = repository_root / PACKAGE_DIRECTORY
    if not package_dir.is_dir():
        raise OverlayPolicyError(f"Package directory is missing: {PACKAGE_DIRECTORY}.")
    for required_name in ("metadata.xml", "Manifest"):
        require_file(package_dir / required_name)

    ebuilds = tuple(sorted(package_dir.glob("zed-*.ebuild")))
    if not ebuilds:
        raise OverlayPolicyError(f"No Zed ebuild found in {PACKAGE_DIRECTORY}.")
    for ebuild_path in ebuilds:
        if not PATCH_REFERENCE.search(ebuild_path.read_text(encoding="utf-8")):
            raise OverlayPolicyError(
                f"Ebuild must apply the Wayland-only patch through PATCHES: {ebuild_path}."
            )
        patch_path = package_dir / "files" / f"{ebuild_path.stem}-wayland-only.patch"
        require_file(patch_path)
        validate_wayland_patch(patch_path)

    # В git archive нет .git. CI передаёт сохранённый список tracked-файлов,
    # чтобы policy проверяла тот же снимок репозитория и в disposable workspace.
    tracked = set(tracked_paths) if tracked_paths is not None else git_tracked_paths(repository_root)
    if any(path == "metadata/md5-cache" or path.startswith("metadata/md5-cache/") for path in tracked):
        raise OverlayPolicyError("Pregenerated metadata/md5-cache must not be tracked by Git."){% endcapture %}

{% include source-preview.html source=policy_implementation label="Правила в validate_overlay, строки 113–150" path="scripts/overlay_policy.py" revision=source_revision start=113 %}

<figure class="figure lesson-figure" data-policy-lab aria-labelledby="policy-lab-title">
  <h4 id="policy-lab-title">Какая проверка остановит шаг?</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label>Учебный сценарий
      <select>
        <option value="">Все правила соблюдены</option>
        <option value="name">Неверное имя репозитория</option>
        <option value="layout">Отсутствует настройка layout</option>
        <option value="manifest">Отсутствует Manifest</option>
        <option value="patch">Патч добавляет X11</option>
        <option value="cache">Git отслеживает кеш</option>
      </select>
    </label>
  </div>
  <ul class="policy-rules" role="list">
    <li data-rule="name" data-failure="Указано other-overlay"><div><strong>Имя репозитория</strong><code>profiles/repo_name</code></div><span data-rule-state>Указано zed-overlay</span><strong class="lesson-status" data-status="PASS">PASS</strong></li>
    <li data-rule="layout" data-failure="Нет thin-manifests"><div><strong>Настройки layout</strong><code>metadata/layout.conf</code></div><span data-rule-state>Обе настройки заданы</span><strong class="lesson-status" data-status="PASS">PASS</strong></li>
    <li data-rule="manifest" data-failure="Нет Manifest"><div><strong>Метаданные пакета</strong><code>app-editors/zed/</code></div><span data-rule-state>Manifest и metadata.xml на месте</span><strong class="lesson-status" data-status="PASS">PASS</strong></li>
    <li data-rule="ebuild"><div><strong>Ebuild и ссылка на патч</strong><code>app-editors/zed/zed-*.ebuild</code></div><span data-rule-state>Есть ebuild, ссылки ведут к патчам своей версии</span><strong class="lesson-status" data-status="PASS">PASS</strong></li>
    <li data-rule="patch" data-failure="Патч добавляет x11"><div><strong>Wayland-патч</strong><code>app-editors/zed/files/*-wayland-only.patch</code></div><span data-rule-state>Wayland сохранён, запрещённых добавлений нет</span><strong class="lesson-status" data-status="PASS">PASS</strong></li>
    <li data-rule="cache" data-failure="Файл кеша отслеживается Git"><div><strong>Сгенерированный кеш</strong><code>metadata/md5-cache/</code></div><span data-rule-state>Git не отслеживает кеш</span><strong class="lesson-status" data-status="PASS">PASS</strong></li>
  </ul>
  <div class="lab-terminal" role="status"><div><code data-policy-result>overlay policy: OK</code><code data-policy-exit>Exit code: 0</code></div><small>Упрощённый вывод</small></div>
  <p class="model-result" data-policy-note>Код 0 позволяет перейти к unit tests.</p>
  <figcaption>Список моделирует состояние файлов. Реальный скрипт может остановиться на первом обнаруженном нарушении.</figcaption>
</figure>

Успех этой проверки подтверждает правила для исходных файлов. Отсутствие
связей с X11 в готовом бинарнике проверяют отдельно при ручной приёмке
пакета в Gentoo.

### 2.6.6. Запускаем unit tests. {#unit-tests-step}

{% include source-preview.html source=step_tests label="Строки 52–53" path=workflow_path revision=reviewed_revision start=52 comment="#" open=true %}

`python3 -m unittest` запускает встроенный тестовый модуль Python.
`discover` ищет тесты, `-s tests` задаёт начальный каталог, а `-v`
выводит имена тестов и результаты. Автоматические тесты проверяют
ожидаемое поведение кода на небольших примерах. Ошибки в логике лучше
обнаружить до запуска ресурсоёмкой подготовки архива.

<div class="selector figure test-explorer" data-selector data-label="Модули в tests/" markdown="1">
<div class="selection-panel test-detail" data-panel data-label="test_watch_zed_release.py" id="module-watch_zed_release" markdown="1">
#### `test_watch_zed_release.py`

Поиск стабильного релиза в `watch_zed_release.py`. Из трёх тегов выбирает `v1.10.0`, сравнивая числа версий.

{% capture sample_test %}    def test_selects_highest_release_numerically(self) -> None:
        selected = WATCHER.latest_stable_release(
            [release("v1.9.0"), release("v1.10.0"), release("v1.8.9")]
        )

        self.assertEqual(selected.version, (1, 10, 0)){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 79–84" path="tests/test_watch_zed_release.py" revision=source_revision start=79 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_prepare_zed_release.py" id="module-prepare_zed_release" markdown="1">
#### `test_prepare_zed_release.py`

Подготовка файлов новой версии в `prepare_zed_release.py`. Подготовка `1.16.0` сохраняет старые ebuild и патчи.

{% capture sample_test %}    def test_prepares_new_version_without_removing_existing_files(self) -> None:
        result = PREPARE.prepare_release(self.root, "1.16.0", dry_run=False)

        self.assertEqual(result.outcome, "prepared")
        self.assertEqual(result.plan.source.version, (1, 15, 0))
        self.assertTrue((self.root / "app-editors/zed/zed-1.14.0.ebuild").is_file())
        self.assertTrue((self.root / "app-editors/zed/zed-1.15.0.ebuild").is_file())
        self.assertTrue(
            (self.root / "app-editors/zed/files/zed-1.14.0-wayland-only.patch").is_file()
        )
        self.assertTrue(
            (self.root / "app-editors/zed/files/zed-1.15.0-wayland-only.patch").is_file()
        ){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 54–66" path="tests/test_prepare_zed_release.py" revision=source_revision start=54 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_check_zed_cargo_snapshot.py" id="module-check_zed_cargo_snapshot" markdown="1">
#### `test_check_zed_cargo_snapshot.py`

Сверка данных Cargo и WebRTC в `check_zed_cargo_snapshot.py`. Проверка отклоняет несовпадение версии WebRTC в `corgi.toml` и ebuild.

{% capture sample_test %}    def test_rejects_upstream_webrtc_version_drift(self) -> None:
        (self.source / "corgi.toml").write_text(
            '''[tools.webrtc-prebuilt]
version = "0001f00-7"
''',
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            CHECKER.CargoSnapshotError,
            "(?s)WEBRTC_COMMIT differs from upstream corgi.toml.*ebuild: 0001d84-4.*upstream: 0001f00-7",
        ):
            self.validate(){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 112–124" path="tests/test_check_zed_cargo_snapshot.py" revision=source_revision start=112 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_overlay_policy.py" id="module-overlay_policy" markdown="1">
#### `test_overlay_policy.py`

Правила репозитория в `overlay_policy.py`. После удаления `Manifest` проверка выдаёт ошибку.

{% capture sample_test %}    def test_policy_rejects_missing_manifest(self) -> None:
        (self.root / "app-editors/zed/Manifest").unlink()

        with self.assertRaisesRegex(OverlayPolicyError, "Manifest"):
            validate_overlay(self.root, tracked_paths=()){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 111–115" path="tests/test_overlay_policy.py" revision=source_revision start=111 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_release_handoff.py" id="module-release_handoff" markdown="1">
#### `test_release_handoff.py`

Подготовка и передача кандидата в `release_handoff.py`. Если версия актуальна, даже с `prepare=True` подготовка не вызывается и файлы остаются прежними.

{% capture sample_test %}    def test_up_to_date_prepare_still_does_not_create_files(self) -> None:
        before = self.snapshot()

        with patch.object(HANDOFF.preparer, "prepare_release") as prepare_release:
            result = HANDOFF.run_handoff(
                self.root, FakeClient([release("v1.15.0")]), prepare=True
            )

        self.assertEqual(result.watch_result.outcome, "up-to-date")
        self.assertIsNone(result.preparation)
        prepare_release.assert_not_called()
        self.assertEqual(self.snapshot(), before){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 146–157" path="tests/test_release_handoff.py" revision=source_revision start=146 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_independent_release.py" id="module-independent_release" markdown="1">
#### `test_independent_release.py`

Управление режимами в `scripts/ci/validate-release-candidate.sh`. В моделируемом validation-only запуске скрипт завершается успешно и оставляет `handoff_ready=false`.

{% capture sample_test %}    def test_validation_only_never_creates_handoff(self) -> None:
        result, output, handoff = self.run_validation(False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, 'handoff_ready=false\n')
        self.assertFalse(handoff){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 179–183" path="tests/test_independent_release.py" revision=source_revision start=179 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_inspect_zed_archive.py" id="module-inspect_zed_archive" markdown="1">
#### `test_inspect_zed_archive.py`

Проверка архива crates в `inspect_zed_archive.py`. После подмены SHA512 в Manifest проверка отклоняет архив.

{% capture sample_test %}    def test_manifest_digest_mismatch(self) -> None:
        self.create_archive()
        data = self.archive.read_bytes()
        manifest = self.root / 'Manifest'
        manifest.write_text(f'DIST {self.archive.name} {len(data)} BLAKE2B {hashlib.blake2b(data).hexdigest()} SHA512 {hashlib.sha512(data).hexdigest()}\n')
        inspect.verify_manifest(self.archive, manifest)
        manifest.write_text(manifest.read_text().replace(hashlib.sha512(data).hexdigest(), '0' * 128))
        with self.assertRaisesRegex(ValueError, 'SHA512 mismatch'):
            inspect.verify_manifest(self.archive, manifest){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 46–54" path="tests/test_inspect_zed_archive.py" revision=source_revision start=46 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_sync_zed_git_crates.py" id="module-sync_zed_git_crates" markdown="1">
#### `test_sync_zed_git_crates.py`

Обновление блока `GIT_CRATES` в `sync_zed_git_crates.py`. Для существующего crate старая ревизия A заменяется ревизией B.

{% capture sample_test %}    def test_existing_dependency_revision_is_updated(self) -> None:
        self.setup_generated(['old'])
        self.assertIn(A, self.candidate.read_text())
        self.assertEqual(self.run_sync(), 1)
        self.assertIn(entry('old', B, 'repo-%commit%/old'), self.candidate.read_text())
        self.assertNotIn(A, self.candidate.read_text()){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 69–74" path="tests/test_sync_zed_git_crates.py" revision=source_revision start=69 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_verify_zed_source.py" id="module-verify_zed_source" markdown="1">
#### `test_verify_zed_source.py`

Сверка архива исходников с Git-деревом в `verify_zed_source.py`. Изменение `Cargo.lock`, прав исполняемого файла, ссылки или состава файлов вызывает ошибку.

{% capture sample_test %}    def test_rejects_changed_content_mode_symlink_or_missing_file(self) -> None:
        for args in ({'lock': b'changed'}, {'executable': False}, {'link': '../outside'}, {'omit_lock': True}):
            with self.subTest(args=args):
                self.make_archive(**args)
                with self.assertRaises(source.SourceVerificationError):
                    source.verify_archive(self.archive, 'zed-1.2.3', self.expected){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 55–60" path="tests/test_verify_zed_source.py" revision=source_revision start=55 %}
</div>

<div class="selection-panel test-detail" data-panel data-label="test_crates_distribution.py" id="module-crates_distribution" markdown="1">
#### `test_crates_distribution.py`

Поиск опубликованного архива для `crates_distribution.py` через `crates_github.py`. Отсутствующий релиз ведёт к генерации. Конфликтующий тег или ошибка сети останавливают поиск.

{% capture sample_test %}    def test_absent_selects_generation_and_failures_do_not(self):
        self.assertEqual(gh.lookup(FakeClient(), VERSION)[0], 'generation')
        client = FakeClient(state='tag')
        with self.assertRaises(gh.GitHubError): gh.lookup(client, VERSION)
        with patch.object(client, 'api', side_effect=gh.GitHubError('network')):
            with self.assertRaises(gh.GitHubError): gh.lookup(client, VERSION){% endcapture %}

{% include source-preview.html source=sample_test label="Тест в исходнике, строки 248–253" path="tests/test_crates_distribution.py" revision=source_revision start=248 %}
</div>
</div>

В [историческом запуске 44148805330](https://github.com/vovanbl411/zed-overlay/actions/runs/44148805330)
прошли 119 тестов. В том запуске watcher повторно использовал опубликованный архив.

<figure class="figure lesson-figure" data-gates aria-labelledby="gates-title">
  <h4 id="gates-title">Когда начнётся подготовка кандидата?</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label>Результаты проверок
      <select>
        <option value="pass">Все проверки прошли</option>
        <option value="policy">Ошибка в overlay policy</option>
        <option value="tests">Ошибка в unit tests</option>
      </select>
    </label>
  </div>
  <ol class="lesson-flow gate-flow" role="list">
    <li class="flow-node"><strong>Checkout</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node"><strong>Overlay policy</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node"><strong>Unit tests</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="START"><strong>Prepare candidate</strong><span class="lesson-status" data-status="START">START</span></li>
  </ol>
  <p class="model-result" role="status" data-gate-result>Подготовка может начаться. START обозначает вход в следующий шаг.</p>
</figure>

По умолчанию шаги продолжаются, пока предыдущие завершались успешно.
Так быстрые проверки останавливают обычную цепочку до дорогой части.
Диагностические шаги с `if: always()` могут выполняться и после ошибки.

### 2.6.7. Передаём управление основному скрипту. {#step-preparation}

{% include source-preview.html source=step_candidate label="Строки 55–60" path=workflow_path revision=reviewed_revision start=55 comment="#" open=true %}

По идентификатору `prepare-and-validate` [outputs задания](#job-outputs)
читают результаты этого шага. Блок `env` передаёт ему две переменные. `GITHUB_TOKEN` нужен для чтения GitHub API, а
`INDEPENDENT_VALIDATION` задаёт режим проверки. Переменные [уровня задания](#job-env), включая ссылки на
образы Gentoo, также доступны скрипту. Строка 60 запускает Bash-скрипт
из checkout оверлея.

<figure class="figure lesson-figure" aria-labelledby="token-flow-title">
  <h4 id="token-flow-title">Как токен Job 1 доходит до запроса</h4>
  <ol class="lesson-flow token-flow" role="list">
    <li class="flow-node"><strong>GitHub Actions</strong><code>{% raw %}${{ github.token }}{% endraw %}</code><small>Токен Job 1 · <code>contents: read</code></small></li>
    <li class="flow-node"><strong><code>env</code> шага</strong><code>GITHUB_TOKEN</code></li>
    <li class="flow-node"><strong><code>validate-release-candidate.sh</code></strong><small><code>release_handoff.py</code> вызывает watcher</small></li>
    <li class="flow-node"><strong>GitHub API</strong><small>Запрос списка релизов Zed</small></li>
  </ol>
</figure>

Дочерний процесс обычно наследует окружение родителя. Передача токена
через `env` задаёт область его доступности, а изоляцию процессов
нужно обеспечивать отдельно. Так, перед установкой `pycargoebuild`
`env -u GITHUB_TOKEN` убирает переменную из окружения конкретного
запуска Python с `pip install`.

{% capture pip_env %}  env -u GITHUB_TOKEN "$work/venv/bin/python" -m pip install 'pycargoebuild==0.16.0'{% endcapture %}

{% include source-preview.html source=pip_env label="Окружение pip install, строка 64" path=docker_path revision=source_revision start=64 comment="#" %}

### 2.6.8. Разбираем логическое выражение. {#validation-expression}

{% capture validation_expr %}{% raw %}          INDEPENDENT_VALIDATION: ${{ github.event_name == 'workflow_dispatch' && inputs.independent_validation && 'true' || 'false' }}{% endraw %}{% endcapture %}

{% include source-preview.html source=validation_expr label="Строка 59" path=workflow_path revision=reviewed_revision start=59 comment="#" open=true %}

`github.event_name` читает имя события из контекста GitHub Actions.
`== 'workflow_dispatch'` проверяет, запустил ли workflow человек.
Первое `&&` переходит к булевому `inputs.independent_validation` только
при истинном сравнении. Следующее `&&` доходит до строки `'true'` только
при истинном input. `||` выбирает строку `'false'`, если левая часть
ложна. Если слева уже выбрана непустая строка `'true'`, правый операнд
`||` пропускается.

Такое вычисление называют *коротким замыканием*. `&&` и `||` проверяют
истинность операндов и возвращают значение выбранного операнда. Поэтому
шаблон `условие && значение || запасное_значение` работает, когда
`значение` считается истинным. Здесь итогом становится одна из двух
строк, а input ручного запуска остаётся булевым.
[Выражения GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions).

<figure class="figure lesson-figure expression-lab" data-expression data-route="schedule" aria-labelledby="expression-title">
  <h4 id="expression-title">Как вычисляется INDEPENDENT_VALIDATION</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label>Событие
      <select data-expression-event>
        <option value="schedule">schedule</option>
        <option value="workflow_dispatch">workflow_dispatch</option>
      </select>
    </label>
    <label hidden data-manual-control><input type="checkbox" data-expression-input disabled> <code>independent_validation</code></label>
    <small data-schedule-note>Ручной input недоступен</small>
  </div>
  <code class="expression-code">{% raw %}${{ <span data-part="event" data-eval="read">github.event_name == 'workflow_dispatch'</span> &amp;&amp; <span data-part="input" data-eval="skip">inputs.independent_validation</span> &amp;&amp; <span data-part="true" data-eval="skip">'true'</span> || <span data-part="false" data-eval="result">'false'</span> }}{% endraw %}</code>
  <ul class="expression-key" aria-label="Обозначения подсветки" role="list">
    <li data-eval="read">Вычислено</li><li data-eval="skip">Пропущено</li><li data-eval="result">Выбранный результат</li>
  </ul>
  <div class="expression-trace">
    <div class="trace-node trace-event"><strong>1. Сравнение события</strong><code data-event-value>schedule → false</code></div>
    <div class="trace-edge trace-manual" data-edge="manual"><span aria-hidden="true">↓</span> <code>&amp;&amp;</code> · ручной запуск</div>
    <div class="trace-edge trace-shortcut" data-edge="schedule"><span>Сравнение ложно</span><small><code>||</code> · input пропущен</small><b aria-hidden="true">↓</b></div>
    <div class="trace-node trace-input" data-eval="skip"><strong>2. Булев input</strong><code data-input-value>Не вычисляется</code></div>
    <div class="trace-edge trace-true-edge" data-edge="enabled"><span aria-hidden="true">↓</span> <code>&amp;&amp;</code> · input true</div>
    <div class="trace-edge trace-false-edge" data-edge="fallback"><span aria-hidden="true">↘</span> <code>||</code> · input false</div>
    <div class="trace-node trace-true" data-eval="skip"><strong>3. Строка <code>'true'</code></strong></div>
    <div class="trace-node trace-false" data-eval="result"><strong>3. Строка <code>'false'</code></strong></div>
    <div class="trace-edge trace-final"><span aria-hidden="true">↓</span> <code>env</code></div>
  </div>
  <div class="lab-terminal" role="status"><code data-expression-result>INDEPENDENT_VALIDATION="false"</code><strong data-expression-mode>Production mode</strong></div>
  <p class="model-result" data-expression-note>Сравнение ложно. Ветка с input пропущена, поэтому результат даёт <code>||</code>.</p>
  <noscript><p>При ручном запуске input по умолчанию равен false, и выражение выбирает строку «false». Если отметить input, выражение дойдёт до строки «true» и пропустит правый операнд <code>||</code>.</p></noscript>
</figure>

В **Production mode** новый кандидат может дойти до публикации, если
выполнены остальные условия workflow. В **Validation-only mode** скрипт
готовит и проверяет нового кандидата без release handoff для публикации.
Если пакет уже актуален, новый кандидат не создаётся ни в одном режиме.

### 2.6.9. Что такое disposable candidate? {#disposable-candidate}

{% capture candidate_archive %}  echo "handoff_ready=false" >> "$GITHUB_OUTPUT"
  git -C "$GITHUB_WORKSPACE" ls-files -z > "$tracked_paths"
  mkdir -p "$disposable_workspace"
  # Проверяем архив HEAD, а не рабочий checkout: подготовка candidate не должна
  # загрязнять исходное дерево, а в архив не попадает каталог .git.
  git -C "$GITHUB_WORKSPACE" archive HEAD | tar -x -C "$disposable_workspace"
  test ! -e "$disposable_workspace/.git"{% endcapture %}

{% include source-preview.html source=candidate_archive label="Строки 125–131" path=candidate_path revision=source_revision start=125 comment="#" open=true %}

`validate-release-candidate.sh` проверяет, есть ли новая версия Zed, и
готовит её в отдельном временном каталоге. Если править исходный checkout,
кандидат смешался бы с базовой версией, относительно которой проверяются
изменения. `git archive HEAD` экспортирует дерево коммита: локальные
правки, неотслеживаемые файлы и служебный каталог `.git/` в экспорт не
попадают. `tar -x` распаковывает поток во временный каталог. Список из
`git ls-files -z` сохраняется отдельно, чтобы проверка политики по-прежнему
могла обнаружить отслеживаемый Git кеш в копии без `.git/`.

<figure class="figure lesson-figure" aria-labelledby="candidate-tree-title">
  <h4 id="candidate-tree-title">Где меняются файлы кандидата</h4>
  <div class="candidate-workspaces">
    <div class="workspace">
      <strong>Исходный checkout</strong><code>$GITHUB_WORKSPACE</code>
      <pre aria-label="Файлы исходного checkout"><code>├── .git/
├── app-editors/zed/
│   ├── Manifest
│   ├── zed-*.ebuild
│   └── files/…patch
└── scripts/</code></pre>
      <small>После проверки <code>git status</code> должен оставаться чистым.</small>
    </div>
    <div class="workspace-transfer"><span aria-hidden="true"></span><code>git archive HEAD<br>| tar -x</code></div>
    <div class="workspace workspace-candidate">
      <strong>Временная копия</strong><code>$RUNNER_TEMP/zed-overlay</code>
      <pre aria-label="Дерево экспортированных файлов"><code>├── app-editors/zed/
│   ├── Manifest
│   ├── zed-*.ebuild
│   └── files/…patch
└── scripts/</code></pre>
      <small>Снимок коммита без <code>.git/</code></small>
      <ol class="candidate-changes">
        <li>Добавляется ebuild кандидата</li>
        <li>Готовится или переиспользуется патч версии</li>
        <li>Обновляется Manifest</li>
        <li>Кандидат проходит проверки</li>
      </ol>
    </div>
    <div class="handoff-branch"><span aria-hidden="true">↓</span><small>Только новая версия, успешная проверка и Production mode</small><strong>Release handoff с ограниченным набором файлов</strong></div>
  </div>
</figure>

`release_handoff.py --prepare` обнаруживает новую версию и при необходимости
готовит ebuild и патч. Для нового кандидата `independent-crates.sh`
готовит или переиспользует архив crates и выполняет проверки, включая
обновление Manifest. Основной скрипт затем проверяет политику временной
копии и чистоту исходного checkout, чтобы поймать случайные изменения
в базовом дереве. Файлы кандидата меняются в отдельном каталоге того же runner.
Границы изоляции процессов от этого не меняются.

На успешном производственном пути для новой версии `create_release_handoff`
собирает проверенный набор файлов для передачи дальше. При
`up-to-date` и в режиме Validation-only handoff для публикации
не создаётся.

{% capture candidate_finish %}  validate_disposable_policy "$disposable_workspace" "$tracked_paths"
  assert_source_workspace_clean

  if [ "$validation_mode" = true ]; then
    echo "Total candidate preparation and validation: $((SECONDS - total_started))s" | tee -a "$GITHUB_STEP_SUMMARY"
    echo "Validation-only: release handoff disabled"
  elif grep -Fxq 'Result: new-release' "$prepare_log"; then
    local archive_mode
    archive_mode="$(cat "$RUNNER_TEMP/zed-independent/logs/result.txt")"
    case "$archive_mode" in generation|reuse) ;; *) echo "Invalid archive mode" >&2; exit 1 ;; esac
    echo "archive_mode=$archive_mode" >> "$GITHUB_OUTPUT"
    create_release_handoff
  fi{% endcapture %}

{% include source-preview.html source=candidate_finish label="Проверки и условие handoff, строки 157–169" path=candidate_path revision=source_revision start=157 comment="#" %}

## 2.7. Job 1 — сохраняем результаты и формируем отчёт {#job-results}

### 2.7.1. Почему некоторые шаги выполняются даже после ошибки? {#diagnostic-steps}

GitHub Actions проверяет `if` перед запуском шага. К обычному условию без
функции проверки статуса GitHub добавляет `success()`. Поэтому после ошибки
обычные шаги загрузки пропускаются, даже если их собственное выражение истинно.

У шагов `Preserve crates validation logs` и `Report check processing time`
стоит явное `if: always()`. Оно снимает требование успешности предыдущих шагов.
Если runner продолжает выполнять job, можно попытаться сохранить логи и
записать время после ошибки. Потеря runner, жёсткий тайм-аут или принудительное
завершение могут прервать выполнение. [Функции проверки статуса в GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions).

<figure class="figure lesson-figure" data-diagnostic-flow aria-labelledby="diagnostic-flow-title">
  <h4 id="diagnostic-flow-title">Какие шаги останутся доступны после ошибки?</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label>Подготовка кандидата
      <select data-preparation>
        <option value="pass">Успешна</option>
        <option value="fail">Завершилась ошибкой</option>
      </select>
    </label>
    <label>Условие сохранения логов
      <select data-log-condition>
        <option value="always">always() · как в workflow</option>
        <option value="success">Обычное условие success()</option>
      </select>
    </label>
  </div>
  <ol class="lesson-flow gate-flow diagnostic-flow" role="list">
    <li class="flow-node" data-gate-state="PASS"><strong>Prepare candidate</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="PASS"><strong>Preserve validation logs</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="RUN"><strong>Upload handoff</strong><span class="lesson-status" data-status="RUN">RUN</span></li>
    <li class="flow-node" data-gate-state="RUN"><strong>Upload crates distribution</strong><span class="lesson-status" data-status="RUN">RUN</span></li>
    <li class="flow-node" data-gate-state="RUN"><strong>Report processing time</strong><span class="lesson-status" data-status="RUN">RUN</span></li>
  </ol>
  <p class="model-result" data-lab-result role="status">Кандидат и сохранение логов прошли. При успешной загрузке handoff обе загрузки допущены по очереди. Отчёт допущен независимо от их результата.</p>
  <figcaption>PASS — шаг успешно завершился в модели, FAIL — завершился ошибкой, RUN — условие допуска выполнено, SKIP — шаг пропущен. Успешная подготовка здесь означает production-запуск для новой версии с готовым handoff. Сохранение логов в этом сценарии считаем успешным.</figcaption>
  <noscript><p>При ошибке подготовки обе загрузки для публикации получают SKIP. Логи получают RUN с <code>always()</code> и SKIP с обычным условием. Отчёт в обоих случаях получает RUN.</p></noscript>
</figure>

### 2.7.2. Сохраняем диагностические логи. {#diagnostic-artifact}

{% capture diagnostic_upload %}{% raw %}      - name: Preserve crates validation logs
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: independent-validation-logs
          path: ${{ runner.temp }}/zed-independent/logs/
          if-no-files-found: ignore
          retention-days: 7{% endraw %}{% endcapture %}

{% include source-preview.html source=diagnostic_upload label="Строки 62–69" path=workflow_path revision=reviewed_revision start=62 comment="#" open=true %}

- `name` в строке 62 задаёт подпись шага в интерфейсе. `if: always()` в строке 63 позволяет собрать диагностику после ошибки.
- `uses` выбирает официальное действие `actions/upload-artifact`. Полный SHA после `@` закрепляет конкретный коммит действия. Ключ `with` передаёт ему параметры. [Документация actions/upload-artifact](https://github.com/actions/upload-artifact).
- `with.name` задаёт имя сохранённого артефакта `independent-validation-logs`. `path` указывает на каталог исходных файлов. Выражение `{% raw %}${{ runner.temp }}{% endraw %}` читает путь к временной папке runner из контекста Actions. В Bash к той же папке обращаются через предоставленную runner переменную `$RUNNER_TEMP`. [Контекст runner](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#runner-context) · [Переменные GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables).
- `if-no-files-found: ignore` позволяет завершить шаг без артефакта, когда по пути нет ни одного подходящего файла. При `up-to-date` или ранней ошибке подготовки каталог логов может ещё не существовать. Сетевые ошибки и другие сбои загрузки по-прежнему могут провалить шаг.
- `retention-days: 7` задаёт хранение загруженных логов на семь дней.

В GitHub откройте **Actions**, выберите запуск watcher и на странице **Summary**
найдите блок **Artifacts**. Нажмите на имя артефакта, чтобы скачать его, пока
он доступен. Для скачивания войдите в GitHub под учётной записью с доступом
на чтение репозитория. [Проверочный запуск 44129394269](https://github.com/vovanbl411/zed-overlay/actions/runs/44129394269) · [Скачивание артефактов в GitHub](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

### 2.7.3. Передаём проверенные файлы между jobs. {#publication-artifacts}

Временная копия overlay служит рабочей площадкой для проверок. Для передачи
в другие jobs скрипт собирает два отдельных набора с проверяемым составом.
В `release-handoff` лежат ровно четыре файла пакета и его описания. В
`crates-distribution` лежат архив crates и JSON с метаданными архива. Остальные
рабочие файлы остаются в Job 1. Диагностические логи загружаются отдельно для
разбора запуска.

{% capture handoff_upload %}{% raw %}      # Между jobs передаём только handoff с ограниченным списком файлов;
      # временный workspace и остальные результаты проверки остаются внутри job.
      - name: Upload release handoff
        if: steps.prepare-and-validate.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff
          if-no-files-found: error
          retention-days: 14{% endraw %}{% endcapture %}

{% capture distribution_upload %}{% raw %}      - name: Upload crates distribution bundle
        if: steps.prepare-and-validate.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution
          if-no-files-found: error
          retention-days: 14{% endraw %}{% endcapture %}

<div class="selector figure artifact-explorer" data-selector data-label="Артефакты первого job" markdown="1">

<div class="selection-panel" data-panel data-label="independent-validation-logs" id="artifact-diagnostics" markdown="1">

#### `independent-validation-logs`

<div class="artifact-tree workspace artifact-optional">
  <strong>Диагностика запуска</strong>
  <code>$RUNNER_TEMP/zed-independent/logs/</code>
  <ul role="list">
    <li><code>generator.log</code> <small>при генерации</small></li>
    <li><code>portage.log</code></li>
    <li><code>timing.txt</code></li>
    <li><code>result.txt</code> <small>после успешной проверки</small></li>
  </ul>
</div>

Состав зависит от пройденных этапов. Файлы читает человек, который разбирает
запуск. Срок хранения **7 дней**, при отсутствии файлов действует `ignore`.
`tee` сохраняет вывод генератора и Portage. Замеры дописываются в
`timing.txt`, а `result.txt` получает режим после завершения проверок.

{% capture log_generator %}{% raw %}  "$overlay/scripts/ci/run-pycargoebuild.sh" "$work/venv/bin/pycargoebuild" \
    "$source_dir" "$archive" "$work/cache" "$work/license-mapping.conf" \
    "$work/generated-zed.ebuild" "$work" 2>&1 | tee "$work/logs/generator.log"{% endraw %}{% endcapture %}

<div id="log-generator" markdown="1">

{% include source-preview.html source=log_generator label="Вывод генератора · строки 76–78" path=docker_path revision=source_revision start=76 comment="#" %}

</div>
{% capture log_timing %}{% raw %}      start=$SECONDS
      emerge -pv --oneshot "=app-editors/zed-${CANDIDATE_VERSION}::zed-overlay"
      echo "Portage dependency resolution: $((SECONDS-start))s" | tee -a /experiment/logs/timing.txt{% endraw %}{% endcapture %}

<div id="log-timing" markdown="1">

{% include source-preview.html source=log_timing label="Запись времени Portage · строки 139–141" path=docker_path revision=source_revision start=139 comment="#" %}

</div>
{% capture log_portage %}{% raw %}      echo "Snapshot and patch validation: $((SECONDS-start))s" | tee -a /experiment/logs/timing.txt
    ' 2>&1 | tee "$work/logs/portage.log"
  cat "$work/logs/timing.txt" >> "$GITHUB_STEP_SUMMARY"{% endraw %}{% endcapture %}

<div id="log-portage" markdown="1">

{% include source-preview.html source=log_portage label="Вывод Portage и замеры · строки 145–147" path=docker_path revision=source_revision start=145 comment="#" %}

</div>
{% capture log_result %}{% raw %}timed 'Metadata and source integrity validation' verify_inputs
timed 'GIT_CRATES synchronization' sync_metadata
timed 'Candidate validation' validate_candidate
mkdir "$RUNNER_TEMP/crates-distribution"
cp "$archive" "$metadata" "$RUNNER_TEMP/crates-distribution/"
printf '%s\n' "$mode" > "$work/logs/result.txt"{% endraw %}{% endcapture %}

<div id="log-result" markdown="1">

{% include source-preview.html source=log_result label="Запись итога подготовки · строки 163–168" path=docker_path revision=source_revision start=163 comment="#" %}

</div>

{% include source-preview.html source=diagnostic_upload label="Загрузка логов · строки 62–69" path=workflow_path revision=reviewed_revision start=62 comment="#" open=true %}

</div>

<div class="selection-panel" data-panel data-label="release-handoff" id="artifact-handoff" markdown="1">

#### `release-handoff`

<div class="artifact-tree workspace artifact-required">
  <strong>Файлы кандидата для публикации</strong>
  <code>$RUNNER_TEMP/release-handoff/</code>
  <ul role="list">
    <li><code>release.json</code></li>
    <li><code>app-editors/zed/</code>
      <ul role="list">
        <li><code>Manifest</code></li>
        <li><code>zed-{version}.ebuild</code></li>
        <li><code>files/zed-{version}-wayland-only.patch</code></li>
      </ul>
    </li>
  </ul>
</div>

Job 2 сверяет набор с исходным коммитом, Job 3 применяет файлы кандидата.
Срок хранения **14 дней**, при отсутствии файлов действует `error`.

{% include source-preview.html source=handoff_upload label="Загрузка handoff · строки 71–80" path=workflow_path revision=reviewed_revision start=71 comment="#" open=true %}

</div>

<div class="selection-panel" data-panel data-label="crates-distribution" id="artifact-distribution" markdown="1">

#### `crates-distribution`

<div class="artifact-tree workspace artifact-required">
  <strong>Архив crates и его метаданные</strong>
  <code>$RUNNER_TEMP/crates-distribution/</code>
  <ul role="list">
    <li><code>zed-{version}-overlay-crates.tar.xz</code></li>
    <li><code>zed-{version}-overlay-crates.json</code></li>
  </ul>
</div>

Job 2 проверяет согласованность архива и метаданных с handoff, Job 3
использует набор при публикации или повторном использовании архива.
Срок хранения **14 дней**, при отсутствии файлов действует `error`.

{% include source-preview.html source=distribution_upload label="Загрузка crates bundle · строки 82–89" path=workflow_path revision=reviewed_revision start=82 comment="#" open=true %}

</div>

</div>

Job 2 и Job 3 скачивают каждый из двух артефактов напрямую из хранилища
текущего запуска Actions. Для Job 3 успешная проверка Job 2 служит условием
запуска. Источник файлов у обоих один. [Скачивание в Job 2](#job2-download-all).

{% capture job3_downloads %}{% raw %}      - name: Download release handoff
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff

      - name: Download crates distribution bundle
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution{% endraw %}{% endcapture %}

<div id="job3-downloads" markdown="1">

{% include source-preview.html source=job3_downloads label="Скачивание в Job 3 · строки 170–180" path=workflow_path revision=reviewed_revision start=170 comment="#" %}

</div>

<figure class="figure lesson-figure artifact-retention">
  <figcaption>Срок хранения артефактов Actions со дня загрузки</figcaption>
  <div><label for="retention-logs">Диагностические логи · 7 дней</label><meter id="retention-logs" min="0" max="14" value="7">7 из 14</meter></div>
  <div><label for="retention-publication">Handoff и crates bundle · 14 дней</label><meter id="retention-publication" min="0" max="14" value="14">14 из 14</meter></div>
</figure>

GitHub Release assets прикреплены к релизу, откуда Portage может скачать
опубликованный архив. Сроки хранения артефактов Actions на assets не
распространяются. Доступность assets зависит от самого релиза и его файлов.
[Релиз с архивом crates для Zed 1.28.1](https://github.com/vovanbl411/zed-overlay/releases/tag/crates-v1.28.1).

### 2.7.4. Условия допуска к загрузке artifacts. {#artifact-upload-gates}

{% capture publication_uploads %}{{ handoff_upload }}

{{ distribution_upload }}{% endcapture %}

{% include source-preview.html source=publication_uploads label="Оба шага загрузки · строки 71–89" path=workflow_path revision=reviewed_revision start=71 comment="#" %}

Оба шага используют одну строку `if`. Контекст `steps` даёт доступ к шагам
текущего job по их `id`. В [разборе outputs](#job-check) значение
`handoff_ready` пришло из `prepare-and-validate` как строка. Выражение
сравнивает её с литералом `'true'`. Пустой output сравнение не проходит.

Как и в [предыдущей лаборатории выражений](#validation-expression), `&&`
требует истинности обоих операндов. Скобки группируют проверку ручного запуска
`workflow_dispatch` с включённым `inputs.independent_validation`.
`!` меняет результат всей группы на противоположный, поэтому режим «только
проверка» закрывает загрузку. GitHub также проверяет неявное `success()`.
Перед второй загрузкой оно учитывает результат первой.

<figure class="figure lesson-figure expression-lab" data-upload-gates aria-labelledby="upload-gates-title">
  <h4 id="upload-gates-title">Допущена ли загрузка?</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label><input type="checkbox" data-prior-success checked> Предыдущие шаги успешны</label>
    <label><input type="checkbox" data-handoff-true checked> <code>handoff_ready</code> равно <code>"true"</code></label>
    <label><input type="checkbox" data-validation-only> Ручной запуск только для проверки</label>
  </div>
  <code class="expression-code">if: <span data-upload-expr="ready" data-eval="read">steps.prepare-and-validate.outputs.handoff_ready == 'true'</span> &amp;&amp; <span data-upload-expr="guard" data-eval="read">!(github.event_name == 'workflow_dispatch' &amp;&amp; inputs.independent_validation)</span></code>
  <ol class="lesson-flow gate-flow three-stage-flow" role="list">
    <li class="flow-node"><strong>Неявный <code>success()</code></strong><span class="lesson-status" data-status="PASS" data-upload-check>true</span></li>
    <li class="flow-node"><strong>Сравнение output</strong><span class="lesson-status" data-status="PASS" data-upload-check>true</span></li>
    <li class="flow-node"><strong>Запрет validation-only</strong><span class="lesson-status" data-status="PASS" data-upload-check>true</span></li>
  </ol>
  <p class="model-result" role="status" data-lab-result>Все три условия истинны. Шаг допущен к попытке загрузки.</p>
  <figcaption>Значения показаны для каждого условия. GitHub может не вычислять оставшуюся часть выражения после первого ложного условия.</figcaption>
</figure>

#### Что произойдёт, если файлов нет?

`if-no-files-found` применяется внутри уже запущенного шага. Проверка
устанавливает, нашёлся ли хотя бы один файл. Полный состав, структуру и
целостность двух наборов отдельно проверяют `release_handoff.py` и
`crates_distribution.py`.

<figure class="figure lesson-figure" data-missing-artifact aria-labelledby="missing-artifact-title">
  <h5 id="missing-artifact-title">Загрузка допущена, но каталог пуст</h5>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label>Какой набор отсутствует?
      <select>
        <option value="logs">Диагностические логи</option>
        <option value="handoff">Release handoff</option>
        <option value="distribution">Crates distribution</option>
      </select>
    </label>
  </div>
  <ol class="lesson-flow gate-flow three-stage-flow" role="list">
    <li class="flow-node"><strong data-missing-name>Диагностические логи</strong><small>Подходящих файлов нет</small></li>
    <li class="flow-node"><strong>Политика действия</strong><code data-missing-policy>if-no-files-found: ignore</code></li>
    <li class="flow-node" data-gate-state="PASS"><strong>Результат шага</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
  </ol>
  <p class="model-result" role="status" data-lab-result>Шаг завершился без ошибки и без артефакта. Обычные шаги могут продолжиться при выполнении их условий.</p>
  <noscript><p>Для обоих наборов публикации действует <code>error</code>. Если отсутствует handoff, пропускается и следующая загрузка. Если отсутствует crates bundle, уже загруженный handoff может остаться, но Job 1 завершается ошибкой и зависимые jobs не запускаются. Отчёт о времени по-прежнему допущен.</p></noscript>
</figure>

### 2.7.5. Разбираем отчёт о времени выполнения. {#check-time-report}

У этого шага собственный `if: always()`. Через `env` GitHub передаёт в
окружение шага два значения. `CHECK_STARTED_AT` берёт отметку `started_at`
из `run-clock`, а `HANDOFF_READY` берёт output из шага подготовки. В
`run: |` знак `|` открывает литеральный многострочный блок YAML: переводы
строк сохраняются, и runner передаёт блок как скрипт Bash.

{% capture timing_report %}{% raw %}      - name: Report check processing time
        if: always()
        env:
          CHECK_STARTED_AT: ${{ steps.run-clock.outputs.started_at }}
          HANDOFF_READY: ${{ steps.prepare-and-validate.outputs.handoff_ready }}
        run: |
          if [[ "$CHECK_STARTED_AT" =~ ^[0-9]+$ ]]; then
            elapsed=$(( $(date +%s) - CHECK_STARTED_AT ))
            echo "Check processing: ${elapsed}s" >> "$GITHUB_STEP_SUMMARY"
            if [[ "$HANDOFF_READY" != true ]]; then
              echo "Total workflow processing: ${elapsed}s" >> "$GITHUB_STEP_SUMMARY"
            fi
          fi{% endraw %}{% endcapture %}

{% capture report_explanations %}
<div class="selection-panel" data-panel data-lines="91-92" data-label="Шаг отчёта" id="report-always" markdown="1">
`always()` допускает шаг после ошибки, пока runner продолжает выполнение.
</div>
<div class="selection-panel" data-panel data-lines="93-96" data-label="Входные данные Bash" id="report-env" markdown="1">
`env` связывает outputs предыдущих шагов с переменными окружения. После `run: |` начинается многострочный скрипт.
</div>
<div class="selection-panel" data-panel data-lines="97" data-label="Проверка формата отметки" id="report-timestamp" markdown="1">
`if` проверяет условие, `then` открывает ветку при истинном результате, `fi` закрывает её. Внутри `[[ ... ]]` оператор `=~` сравнивает значение с регулярным выражением. `^` привязывает проверку к началу значения, `[0-9]` означает десятичную цифру, `+` требует одну или больше цифр, `$` привязывает проверку к концу. Пустое или явно нечисловое значение минует вычисление. Формат сам по себе ничего не говорит о корректности отметки по времени.
</div>
<div class="selection-panel" data-panel data-lines="98" data-label="Вычисление разницы" id="report-arithmetic" markdown="1">
`$(date +%s)` запускает команду и подставляет текущую отметку в секундах Unix. `$(( ... ))` вычисляет разницу, а `elapsed=` сохраняет её в переменной. Это показания системных часов, которые могут корректироваться.
</div>
<div class="selection-panel" data-panel data-lines="99" data-label="Первая строка отчёта" id="report-check-line" markdown="1">
`${elapsed}` подставляет значение переменной, после которого добавляется `s`. Перенаправление `>> "$GITHUB_STEP_SUMMARY"` дописывает строку в файл отчёта шага, сохраняя прежнее содержимое.
</div>
<div class="selection-panel" data-panel data-lines="100-102" data-label="Условие второй строки" id="report-total-line" markdown="1">
`!= true` даёт истину, если значение отличается от строки `true` в Bash. При `false` или пустом значении скрипт дописывает ещё одну строку с тем же числом секунд. Первый `fi` закрывает внутреннее условие.
</div>
<div class="selection-panel" data-panel data-lines="103" data-label="Конец проверки формата" id="report-end" markdown="1">
Последний `fi` закрывает внешнее условие. Обе строки находятся внутри этой проверки.
</div>
{% endcapture %}

{% include source-preview.html source=timing_report panels=report_explanations label="Строки 91–103 · выберите строку для разбора" path=workflow_path revision=reviewed_revision start=91 comment="#" open=true %}

#### Куда попадает текст?

<figure class="figure lesson-figure">
  <ol class="lesson-flow three-stage-flow" role="list">
    <li class="flow-node"><strong>Команда Bash</strong><small><code>echo</code> формирует строку</small></li>
    <li class="flow-node"><strong>Файл отчёта шага</strong><small><code>$GITHUB_STEP_SUMMARY</code> содержит путь</small></li>
    <li class="flow-node"><strong>Summary запуска</strong><small>GitHub показывает отчёт job</small></li>
  </ol>
</figure>

Файл `GITHUB_STEP_SUMMARY` принимает Markdown. GitHub объединяет отчёты
шагов в сводку job на странице запуска. Через `GITHUB_OUTPUT` шаг передаёт
именованные значения для выражений workflow. Артефакты хранят скачиваемые
файлы, а обычный вывод команды виден в логах шага. Через `tee -a` проект
показывает одну строку и в логах, и в сводке. Так скрипт пишет
`Metadata SHA256: …` при подготовке handoff. Отдельный пример из проекта —
`Result: up-to-date` в сводке, когда новый кандидат не нужен.
[Сводка в GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary) · [Исторический запуск с повторным использованием архива](https://github.com/vovanbl411/zed-overlay/actions/runs/44148805330).

<figure class="figure lesson-figure expression-lab" data-summary-lab aria-labelledby="summary-lab-title">
  <h4 id="summary-lab-title">Что появится в Summary?</h4>
  <div class="walkthrough-controls" hidden data-lab-controls>
    <label><input type="checkbox" data-valid-timestamp checked> Числовой формат <code>CHECK_STARTED_AT</code></label>
    <label><input type="checkbox" data-handoff-true checked> <code>HANDOFF_READY</code> равно <code>"true"</code></label>
    <label>Пример времени, с <input type="number" min="0" step="1" value="133" data-example-seconds></label>
  </div>
  <ol class="lesson-flow gate-flow two-stage-flow" role="list">
    <li class="flow-node"><code data-eval="read">[[ "$CHECK_STARTED_AT" =~ ^[0-9]+$ ]]</code><span class="lesson-status" data-summary-check data-status="PASS">true</span></li>
    <li class="flow-node"><code data-eval="read">[[ "$HANDOFF_READY" != true ]]</code><span class="lesson-status" data-summary-check data-status="FAIL">false</span></li>
  </ol>
  <div class="lab-terminal summary-preview" role="status" aria-atomic="true" data-summary-result><code>Check processing: 133s</code></div>
  <figcaption>133 секунды — условное число. При корректной отметке и неготовом handoff появится ещё строка <code>Total workflow processing: 133s</code>. При пустой или нечисловой отметке блок ничего не допишет.</figcaption>
</figure>

Отсчёт начинается в `run-clock`, когда runner уже выделен. Время показывает
продолжительность обработки. О результате запуска судят по статусам jobs и
шагов. Пустой или ложный `handoff_ready` встречается на разных путях, в том
числе при `up-to-date`, проверочном запуске и ошибке подготовки.

Если `handoff_ready` равен `true`, Job 1 пишет только время проверки.
Итоговую строку тогда дописывает шаг Job 3, если job запустился и шаг отчёта выполнился с числовой отметкой. Поздний расчёт от того же
`started_at` включает и прошедшее между jobs время. При сбое загрузки либо
пропуске публикации итоговая строка может отсутствовать.

{% capture job3_report %}{% raw %}      - name: Report workflow processing time
        if: always()
        env:
          CHECK_STARTED_AT: ${{ needs.check.outputs.started_at }}
        run: |
          if [[ "$CHECK_STARTED_AT" =~ ^[0-9]+$ ]]; then
            echo "Total workflow processing: $(( $(date +%s) - CHECK_STARTED_AT ))s" >> "$GITHUB_STEP_SUMMARY"
          fi{% endraw %}{% endcapture %}

<div id="job3-report" markdown="1">

{% include source-preview.html source=job3_report label="Итоговый шаг отчёта · строки 233–240" path=workflow_path revision=reviewed_revision start=233 comment="#" %}

</div>

### 2.7.6. Как связаны результаты первого job. {#job-check-data-flow}

<figure class="figure lesson-figure job-results-flow" aria-labelledby="job-results-flow-title">
  <h4 id="job-results-flow-title">От рабочей копии до потребителей Job 1</h4>
  <ol class="lesson-flow three-stage-flow" role="list">
    <li class="flow-node"><strong>Скрипт подготовки</strong><small><code>validate-release-candidate.sh</code></small></li>
    <li class="flow-node"><strong>Временная копия</strong><small><code>$RUNNER_TEMP/zed-overlay</code></small></li>
    <li class="flow-node"><strong>Проверки кандидата</strong><small>Готовят результаты для передачи</small></li>
  </ol>
  <div class="job-result-branches">
    <div class="job-publication">
      <p class="job-result-edge"><span aria-hidden="true">↓</span> Путь публикации</p>
      <div class="flow-node job-result-payload">
        <div><strong>Значения job outputs</strong><small><code>handoff_ready</code>, <code>archive_mode</code>, <code>metadata_sha256</code>, <code>started_at</code> из <code>run-clock</code></small></div>
        <div><strong>Файлы в Actions Artifacts</strong><small><code>release-handoff</code> и <code>crates-distribution</code></small></div>
      </div>
      <p class="job-result-edge"><span aria-hidden="true">↓</span> Job 1 завершился успешно, handoff готов, production-режим</p>
      <div class="job-result-consumers">
        <div class="flow-node"><strong>Job 2 · проверка</strong><small>Читает outputs и скачивает оба набора из Actions.</small></div>
        <div class="flow-node"><strong>Job 3 · публикация</strong><small>После успеха Job 2 и при запуске из <code>main</code> получает outputs и скачивает оба набора из Actions.</small></div>
      </div>
    </div>
    <div class="job-diagnostics">
      <p class="job-result-edge"><span aria-hidden="true">↓</span> Если проверки оставили логи</p>
      <div class="flow-node artifact-optional"><strong>Диагностический артефакт</strong><small><code>independent-validation-logs</code></small></div>
      <p class="job-result-edge"><span aria-hidden="true">↓</span> Summary → Artifacts</p>
      <div class="flow-node"><strong>Читатель запуска</strong><small>Скачивает логи, пока они доступны.</small></div>
    </div>
  </div>
  <figcaption>Успех Job 2 открывает путь к Job 3. Оба job обращаются к исходным артефактам Job 1. Диагностическая ветка доступна и после ошибки, если файлы успели появиться и загрузиться.</figcaption>
</figure>

## 2.8. Job 2 — Validate release handoff {#job-validate-handoff}

{% capture job2 %}{% raw %}  # Перед job с правами на запись повторно сверяем handoff с commit,
  # для которого запущен workflow.
  validate-release-handoff:
    name: Validate release handoff
    needs: check
    if: needs.check.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - name: Check out the workflow commit
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          ref: ${{ github.sha }}
          persist-credentials: false

      - name: Download release handoff
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff

      - name: Download crates distribution bundle
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution

      - name: Validate release handoff boundary
        env:
          EXPECTED_METADATA_SHA256: ${{ needs.check.outputs.metadata_sha256 }}
        shell: bash
        run: |
          set -euo pipefail
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
            --validate-handoff "$RUNNER_TEMP/release-handoff" \
            --expected-base-commit "$GITHUB_SHA"
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
            --bundle "$RUNNER_TEMP/crates-distribution" \
            --handoff "$RUNNER_TEMP/release-handoff" --base-commit "$GITHUB_SHA" \
            --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
            --metadata-sha256 "$EXPECTED_METADATA_SHA256"
          echo "Release handoff and distribution boundaries: OK"{% endraw %}{% endcapture %}

<div id="job2" markdown="1">

{% include source-preview.html source=job2 label="Job 2 целиком · строки 105–147" path=workflow_path revision=reviewed_revision start=105 comment="#" %}

</div>

### 2.8.1. Зачем нам отдельное задание проверки? {#handoff-boundary}

Первый job обращается к внешним источникам, генерирует или повторно использует
архив и проверяет временный кандидат. Bash и Python управляют подготовкой,
Docker нужен для проверок Portage. Во второй job передаются два набора файлов
и несколько outputs. На свежем runner он проверяет структуру, целостность
и согласованность этих результатов перед публикацией.

<figure class="figure lesson-figure release-architecture" aria-labelledby="handoff-architecture-title">
  <h4 id="handoff-architecture-title">От подготовки к публикации</h4>
  <ol class="lesson-flow three-stage-flow" role="list">
    <li class="flow-node"><strong>Job 1 · Prepare</strong><code>contents: read</code><small>Внешние источники → Python, Bash и Docker → проверенный кандидат.</small></li>
    <li class="flow-node release-boundary"><strong>Job 2 · Validate</strong><code>contents: read</code><small>Свежий runner проверяет структуру, целостность и согласованность.</small></li>
    <li class="flow-node"><strong>Job 3 · Publish</strong><code>contents: write</code><br><code>pull-requests: write</code><small>Публикует при выполнении всех условий.</small></li>
  </ol>
  <p class="release-edge"><strong>Допуск</strong> Job 1 → Job 2 → Job 3. Job 3 также зависит напрямую от Job 1.</p>
  <p class="release-edge release-data"><strong>Данные</strong> Job 1 → два набора файлов в Actions Artifacts → каждый из Job 2 и Job 3 скачивает их сам. Outputs Job 1 передаются через <code>needs</code>.</p>
  <figcaption>При сбое проверки цепочка допуска обрывается на Job 2. Его результат для Job 3 — статус.</figcaption>
</figure>

Job 2 запускает доверенный код валидаторов из той же ревизии workflow.
Разделение ограничивает работу с правами на запись и добавляет обязательную
проверку границы передачи. Гарантии ограничены проверяемыми свойствами
файлов. Сами валидаторы не устанавливают независимо подлинность всех
результатов подготовки, не проверяют безопасность исходного кода и не
повторяют каждую проверку upstream или Portage.

### 2.8.2. Needs — как GitHub определяет порядок выполнения. {#handoff-needs}

{% capture job2_needs %}{% raw %}    needs: check{% endraw %}{% endcapture %}

<div id="job2-needs" markdown="1">

{% include source-preview.html source=job2_needs label="Зависимость Job 2 · строка 109" path=workflow_path revision=reviewed_revision start=109 comment="#" %}

</div>

Шаги внутри каждого из этих jobs идут по порядку. Для jobs порядок в YAML
сам по себе ничего не планирует. `needs: check` делает завершение Job 1
предпосылкой для Job 2 и открывает доступ к результату и outputs Job 1.
[Синтаксис `needs` в GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).

<figure class="figure lesson-figure" data-handoff-timeline aria-labelledby="needs-timeline-title">
  <h4 id="needs-timeline-title">Дорожки выполнения</h4>
  <div class="lab-controls" data-lab-controls hidden><label>Зависимость <select><option value="on">Включена</option><option value="off">Отключена</option></select></label></div>
  <div class="needs-timeline" data-dependency="on">
    <strong>Job 1</strong><div class="needs-track"><span>Выполняется</span></div>
    <strong>Job 2</strong><div class="needs-track"><span data-wait>Ждёт Job 1</span><span>Выполняется</span></div>
  </div>
  <p data-lab-result role="status">Job 2 получает допуск после Job 1, если выполнены остальные условия.</p>
  <figcaption>Дорожки показывают допустимый порядок. Время старта зависит от планировщика и наличия runner.</figcaption>
</figure>

При отключённой зависимости два условных независимых задания могут идти
параллельно. Чтобы так изменить настоящий workflow, пришлось бы также
переписать выражения с `needs.check`.

### 2.8.3. Условия запуска второго job. {#handoff-admission}

{% capture job2_if %}{% raw %}    if: needs.check.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation){% endraw %}{% endcapture %}

<div id="job2-if" markdown="1">

{% include source-preview.html source=job2_if label="Условие запуска · строка 110" path=workflow_path revision=reviewed_revision start=110 comment="#" open=true %}

</div>

Внутри Job 1 `steps.prepare-and-validate.outputs` относится к отдельному шагу.
В [объявлении outputs](#job-outputs) job публикует выбранные значения. Так
`needs.check.outputs.handoff_ready` становится доступен Job 2, а
`needs.check.result` содержит итоговый статус всего Job 1, включая загрузку
артефактов. Как и в [выражении загрузки](#artifact-upload-gates), здесь
сравнивают строковый output с `'true'` и исключают ручной режим независимой
проверки. В `if` без функции статуса GitHub также требует успеха зависимости.
При первом ложном условии следующие проверки допуска уже не нужны.
[Выражения и функции статуса GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions).

<figure class="figure lesson-figure" data-handoff-admission aria-labelledby="handoff-admission-title">
  <h4 id="handoff-admission-title">Допуск Job 2</h4>
  <div class="lab-controls release-controls" data-lab-controls hidden>
    <label>Результат Job 1 <select data-check-result><option>success</option><option>failure</option><option>cancelled</option><option>skipped</option></select></label>
    <label><input type="checkbox" data-ready checked> <code>handoff_ready</code> равен <code>"true"</code></label>
    <label><input type="checkbox" data-manual> Ручной запуск в режиме проверки</label>
  </div>
  <ol class="lesson-flow gate-flow release-gates three-stage-flow" role="list">
    <li class="flow-node" data-gate-state="PASS"><strong>Job 1 завершился успешно</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="PASS"><strong><code>handoff_ready</code> равен <code>"true"</code></strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="PASS"><strong>Режим проверки выключен</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
  </ol>
  <p data-lab-result role="status">RUN · Job 2 допущен к запуску.</p>
  <figcaption>Начальное состояние соответствует новому релизу в production. Параметры модели можно менять независимо, хотя некоторые сочетания в реальном запуске не возникают.</figcaption>
</figure>

В строке 110 нет проверки ветки. Ручной production-запуск из другой ветки
может дойти до Job 2, если выполнит перечисленные условия. Проверка
`refs/heads/main` находится в [условии Job 3](#handoff-final). Она относится к
этому объявлению job. Права, которые может запросить изменённый workflow в
другой ветке, определяются настройками GitHub и разрешениями запуска.

### 2.8.4. Почему снова выполняется checkout? {#handoff-checkout}

{% capture job2_checkout %}{% raw %}      - name: Check out the workflow commit
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          ref: ${{ github.sha }}
          persist-credentials: false{% endraw %}{% endcapture %}

<div id="job2-checkout" markdown="1">

{% include source-preview.html source=job2_checkout label="Checkout на втором runner · строки 115–119" path=workflow_path revision=reviewed_revision start=115 comment="#" open=true %}

</div>

Оба задания используют GitHub-hosted `ubuntu-24.04`. Каждый job получает
собственный runner и рабочий каталог. **Checkout** даёт Job 2 скрипты и
исходный `app-editors/zed/Manifest`. **Артефакты** содержат файлы кандидата
и bundle. **Outputs** Job 1 нужны для допуска и сверки.

{% raw %}`ref: ${{ github.sha }}`{% endraw %} явно выбирает коммит запуска. Как и в
[разборе checkout Job 1](#step-checkout-explained), SHA служит фиксированной
точкой отсчёта. `persist-credentials: false` [отключает сохранение учётных
данных для последующих команд Git](#checkout-credentials).

<figure class="figure lesson-figure" data-handoff-revision aria-labelledby="handoff-revision-title">
  <h4 id="handoff-revision-title">Какой коммит получит второй runner?</h4>
  <div class="lab-controls release-controls" data-lab-controls hidden>
    <label><input type="checkbox" data-main-advance> <code>main</code> продвигается во время Job 1</label>
    <label>Явный <code>ref</code> Job 2 <select data-checkout-ref><option value="sha">github.sha</option><option value="main">main · гипотеза</option></select></label>
  </div>
  <div class="commit-graph" data-job2-at="B">
    <div class="commit-node"><strong>A</strong><small>История</small></div>
    <div class="commit-node"><strong>B</strong><small>Коммит запуска</small><span><code data-main-b>main</code></span></div>
    <div class="commit-node" data-commit-c hidden><strong>C</strong><small>Новый коммит</small><span><code>main</code></span></div>
    <div class="commit-runner" data-job1-commit>Runner Job 1 <strong>→ B</strong></div>
    <div class="commit-runner" data-job2-commit>Runner Job 2 <strong data-job2-target>→ B</strong></div>
  </div>
  <p data-lab-result role="status">Оба runner используют B.</p>
  <figcaption>A, B и C — условные коммиты. В модели Job 1 начал работу на B.</figcaption>
</figure>

Если `main` продвинется, явно заданный `ref: main` может выбрать C, где уже
другой исходный Manifest или другой код валидаторов. Модель сравнивает два
**явных** значения `ref`. Поведение checkout без `ref` зависит от контекста
события, как в первом job.

### 2.8.5. Получаем artifacts. {#handoff-downloads}

{% capture job2_download_all %}{% raw %}      - name: Download release handoff
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff

      - name: Download crates distribution bundle
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution{% endraw %}{% endcapture %}

<div id="job2-download-all" markdown="1">

{% include source-preview.html source=job2_download_all label="Оба скачивания · строки 121–131" path=workflow_path revision=reviewed_revision start=121 comment="#" %}

</div>

Официальный action `actions/download-artifact` закреплён за коммитом.
Параметр `name` выбирает набор из **текущего запуска** Actions. `path`
задаёт каталог назначения. {% raw %}`${{ runner.temp }}`{% endraw %} в выражении Actions и
`$RUNNER_TEMP` в Bash указывают на временный каталог конкретного runner.
[Документация download-artifact](https://github.com/actions/download-artifact).

<div class="selector figure artifact-explorer" data-selector data-label="Скачиваемый артефакт" markdown="1">

Ожидаемый состав на условном примере Zed 1.28.1.

<div class="selection-panel" data-panel data-label="release-handoff" id="transport-release-handoff" markdown="1">

#### `release-handoff`

<ol class="lesson-flow transport-flow" role="list">
  <li class="flow-node"><strong>Runner Job 1</strong><code>$RUNNER_TEMP/<wbr>release-handoff/</code></li>
  <li class="transport-action"><code>upload-artifact</code></li>
  <li class="flow-node release-boundary"><strong>Actions Artifacts</strong><code>release-handoff</code></li>
  <li class="transport-action"><code>download-artifact</code></li>
  <li class="flow-node"><strong>Runner Job 2</strong><code>$RUNNER_TEMP/<wbr>release-handoff/</code></li>
</ol>

<div class="artifact-tree workspace handoff-tree"><strong>release-handoff/</strong>
  <ul role="list">
    <li><code>release.json</code></li>
    <li><code>app-editors/</code><ul role="list">
      <li><code>zed/</code><ul role="list">
        <li><code>Manifest</code></li>
        <li><code>zed-1.28.1.ebuild</code></li>
        <li><code>files/</code><ul role="list">
          <li><code>zed-1.28.1-wayland-only.patch</code></li>
        </ul></li>
      </ul></li>
    </ul></li>
  </ul>
</div>

{% capture download_release_handoff %}{% raw %}      - name: Download release handoff
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff{% endraw %}{% endcapture %}

<div id="download-release-handoff" markdown="1">

{% include source-preview.html source=download_release_handoff label="Скачивание release-handoff · строки 121–125" path=workflow_path revision=reviewed_revision start=121 comment="#" open=true %}

</div>

</div>

<div class="selection-panel" data-panel data-label="crates-distribution" id="transport-crates-distribution" markdown="1">

#### `crates-distribution`

<ol class="lesson-flow transport-flow" role="list">
  <li class="flow-node"><strong>Runner Job 1</strong><code>$RUNNER_TEMP/<wbr>crates-distribution/</code></li>
  <li class="transport-action"><code>upload-artifact</code></li>
  <li class="flow-node release-boundary"><strong>Actions Artifacts</strong><code>crates-distribution</code></li>
  <li class="transport-action"><code>download-artifact</code></li>
  <li class="flow-node"><strong>Runner Job 2</strong><code>$RUNNER_TEMP/<wbr>crates-distribution/</code></li>
</ol>

<div class="artifact-tree workspace handoff-tree"><strong>crates-distribution/</strong>
  <ul role="list">
    <li><code>zed-1.28.1-overlay-crates.json</code></li>
    <li><code>zed-1.28.1-overlay-crates.tar.xz</code></li>
  </ul>
</div>

{% capture download_crates_distribution %}{% raw %}      - name: Download crates distribution bundle
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution{% endraw %}{% endcapture %}

<div id="download-crates-distribution" markdown="1">

{% include source-preview.html source=download_crates_distribution label="Скачивание crates-distribution · строки 127–131" path=workflow_path revision=reviewed_revision start=127 comment="#" open=true %}

</div>

</div>

</div>

Ошибка любого скачивания останавливает выполнение до валидации. При успешном
скачивании состав и содержимое файлов проверяют следующие команды. В Job 2
появляются только скачанные наборы. Полный временный workspace Job 1 остаётся
на первом runner.

### 2.8.6. Запускаем проверку границы передачи. {#handoff-bash}

{% capture job2_bash %}{% raw %}      - name: Validate release handoff boundary
        env:
          EXPECTED_METADATA_SHA256: ${{ needs.check.outputs.metadata_sha256 }}
        shell: bash
        run: |
          set -euo pipefail
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
            --validate-handoff "$RUNNER_TEMP/release-handoff" \
            --expected-base-commit "$GITHUB_SHA"
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
            --bundle "$RUNNER_TEMP/crates-distribution" \
            --handoff "$RUNNER_TEMP/release-handoff" --base-commit "$GITHUB_SHA" \
            --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
            --metadata-sha256 "$EXPECTED_METADATA_SHA256"
          echo "Release handoff and distribution boundaries: OK"{% endraw %}{% endcapture %}

<div id="job2-bash" markdown="1">

{% include source-preview.html source=job2_bash label="Шаг валидации · строки 133–147" path=workflow_path revision=reviewed_revision start=133 comment="#" open=true %}

</div>

`env` передаёт `needs.check.outputs.metadata_sha256` шагу под именем
`EXPECTED_METADATA_SHA256`. `run: |` сохраняет переводы строк блока YAML,
а `shell: bash` задаёт оболочку для его выполнения. Bash запускает два
валидатора по очереди, затем печатает итоговую строку.

- `-e` (errexit) может остановить скрипт после необработанной ошибки команды.
  Среди исключений — команда, результат которой проверяет `if`.
- `-u` (nounset) считает обращение к незаданной переменной ошибкой, за
  исключением специальных случаев, например подстановки с явным значением по умолчанию.
- `-o pipefail` возвращает из конвейера статус самой правой команды с
  ненулевым статусом. Если все успешны, статус равен нулю.

<figure class="figure lesson-figure" data-handoff-bash aria-labelledby="handoff-bash-title">
  <h4 id="handoff-bash-title">Что меняется при включении опции?</h4>
  <div class="lab-controls release-controls" data-lab-controls hidden>
    <label>Опция <select data-bash-option><option value="e">-e · errexit</option><option value="u">-u · nounset</option><option value="pipefail">-o pipefail</option></select></label>
    <label><input type="checkbox" data-bash-enabled checked> Опция включена</label>
  </div>
  <pre><code data-bash-code>false
echo "Продолжаем"</code></pre>
  <p data-lab-result role="status">Код 1 · Bash прерывает скрипт после false, echo пропущен.</p>
  <figcaption>Модель показывает заранее заданные команды. В каждом примере остальные опции отключены.</figcaption>
</figure>

Без `-e` в этом примере выполняется `echo`. Без `-u` незаданная переменная
разворачивается в пустую строку. Без `pipefail` статус `false | cat` определяет
последняя команда, `cat`.
GitHub Actions при явном `shell: bash` уже запускает Bash с `-e` и
`pipefail`. Строка `set -euo pipefail` добавляет `nounset` и фиксирует
ожидаемое поведение в самом скрипте. Если первая команда Python возвращает
ненулевой код, Bash пропускает вторую команду и итоговый `echo`.
[Параметры оболочки в GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell) · [Опции `set` в Bash](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html).

### 2.8.7. Первый валидатор — структура release handoff. {#handoff-structure}

{% capture job2_validate_handoff %}{% raw %}          PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
            --validate-handoff "$RUNNER_TEMP/release-handoff" \
            --expected-base-commit "$GITHUB_SHA"{% endraw %}{% endcapture %}

<div id="job2-validate-handoff" markdown="1">

{% include source-preview.html source=job2_validate_handoff label="Вызов валидатора handoff · строки 139–141" path=workflow_path revision=reviewed_revision start=139 comment="#" open=true %}

</div>

`--prepare` разрешает подготовку кандидата. `--validate-handoff` читает
полученный каталог и проверяет его без подготовки, применения файлов или
публикации. `--expected-base-commit "$GITHUB_SHA"` привязывает проверку к
коммиту запуска.

{% capture handoff_metadata %}{% raw %}def _artifact_paths(candidate_version: str) -> tuple[Path, Path, Path]:
    _validate_candidate_version(candidate_version)
    return (
        MANIFEST_PATH,
        Path(f"app-editors/zed/zed-{candidate_version}.ebuild"),
        Path(f"app-editors/zed/files/zed-{candidate_version}-wayland-only.patch"),
    )


def _release_metadata(candidate_version: str, base_commit: str) -> dict[str, object]:
    manifest_path, candidate_ebuild_path, candidate_patch_path = _artifact_paths(
        candidate_version
    )
    _validate_base_commit(base_commit)
    return {
        "schema_version": HANDOFF_SCHEMA_VERSION,
        "base_commit": base_commit,
        "release_tag": f"v{candidate_version}",
        "candidate_version": candidate_version,
        "manifest_path": manifest_path.as_posix(),
        "candidate_ebuild_path": candidate_ebuild_path.as_posix(),
        "candidate_patch_path": candidate_patch_path.as_posix(),
    }{% endraw %}{% endcapture %}

<div id="handoff-metadata" markdown="1">

{% include source-preview.html source=handoff_metadata label="Канонические пути и метаданные · строки 98–120" path="scripts/release_handoff.py" revision=job2_script_revision start=98 comment="#" %}

</div>

<figure class="figure lesson-figure" data-handoff-json aria-labelledby="handoff-json-title">
  <h4 id="handoff-json-title">Поля release.json</h4>
  <div class="lab-controls" data-lab-controls hidden><label>Поле <select><option>schema_version</option><option>base_commit</option><option>release_tag</option><option>candidate_version</option><option>manifest_path</option><option>candidate_ebuild_path</option><option>candidate_patch_path</option></select></label></div>
  <pre class="release-json"><code>{
  <span data-json-field="schema_version" data-purpose="Версия контракта передачи. Валидатор ожидает целое число 1.">"schema_version": 1,</span>
  <span data-json-field="base_commit" data-purpose="Коммит overlay, от которого подготовлен кандидат. Job 2 сверяет его с GITHUB_SHA.">"base_commit": "0123456789abcdef0123456789abcdef01234567",</span>
  <span data-json-field="release_tag" data-purpose="Тег upstream получается добавлением v к версии кандидата.">"release_tag": "v1.28.1",</span>
  <span data-json-field="candidate_version" data-purpose="Версия кандидата определяет имена ebuild, патча и файлов distribution.">"candidate_version": "1.28.1",</span>
  <span data-json-field="manifest_path" data-purpose="Фиксированный путь к Manifest кандидата внутри handoff.">"manifest_path": "app-editors/zed/Manifest",</span>
  <span data-json-field="candidate_ebuild_path" data-purpose="Канонический путь к ebuild для этой версии.">"candidate_ebuild_path": "app-editors/zed/zed-1.28.1.ebuild",</span>
  <span data-json-field="candidate_patch_path" data-purpose="Канонический путь к обязательному Wayland-патчу для этой версии.">"candidate_patch_path": "app-editors/zed/files/zed-1.28.1-wayland-only.patch"</span>
}</code></pre>
  <p data-lab-result role="status">Версия контракта передачи. Валидатор ожидает целое число 1.</p>
  <figcaption>Учебный JSON для Zed 1.28.1. SHA overlay вымышленный.</figcaption>
  <noscript><ul role="list"><li><code>schema_version</code> — Версия контракта передачи. Валидатор ожидает целое число 1.</li><li><code>base_commit</code> — Коммит overlay, от которого подготовлен кандидат. Job 2 сверяет его с GITHUB_SHA.</li><li><code>release_tag</code> — Тег upstream получается добавлением v к версии кандидата.</li><li><code>candidate_version</code> — Версия кандидата определяет имена ebuild, патча и файлов distribution.</li><li><code>manifest_path</code> — Фиксированный путь к Manifest кандидата внутри handoff.</li><li><code>candidate_ebuild_path</code> — Канонический путь к ebuild для этой версии.</li><li><code>candidate_patch_path</code> — Канонический путь к обязательному Wayland-патчу для этой версии.</li></ul></noscript>
</figure>

`base_commit` относится к репозиторию overlay. `upstream_commit` в метаданных
distribution относится к исходному репозиторию Zed. Проверка сначала сверяет
набор ключей, версию схемы и согласованность тега, версии и путей, затем
сравнивает коммит и обходит дерево.

{% capture handoff_validation %}{% raw %}def validate_release_handoff(
    destination: Path, *, expected_base_commit: str | None = None
) -> dict[str, object]:
    """Fail closed unless a handoff contains exactly the expected artifact."""
    if expected_base_commit is not None:
        _validate_base_commit(expected_base_commit)

    release_json = Path("release.json")
    try:
        root_mode = destination.lstat().st_mode
    except FileNotFoundError as error:
        raise HandoffError(f"Handoff artifact is missing: {destination}") from error
    if not stat.S_ISDIR(root_mode):
        raise HandoffError(f"Handoff artifact must be a directory: {destination}")
    _require_regular_file(destination / release_json, "release.json")
    metadata = _read_release_metadata(destination / release_json)
    expected_keys = {
        "schema_version",
        "base_commit",
        "release_tag",
        "candidate_version",
        "manifest_path",
        "candidate_ebuild_path",
        "candidate_patch_path",
    }
    if set(metadata) != expected_keys:
        raise HandoffError("release.json fields do not match the handoff schema")
    if (
        type(metadata["schema_version"]) is not int
        or metadata["schema_version"] != HANDOFF_SCHEMA_VERSION
    ):
        raise HandoffError("release.json has an invalid schema_version")

    candidate_version = metadata["candidate_version"]
    base_commit = metadata["base_commit"]
    if not isinstance(candidate_version, str):
        raise HandoffError("release.json has an invalid candidate_version")
    if not isinstance(base_commit, str):
        raise HandoffError("release.json has an invalid base_commit")
    _validate_candidate_version(candidate_version)
    _validate_base_commit(base_commit)
    expected_metadata = _release_metadata(candidate_version, base_commit)
    if metadata != expected_metadata:
        raise HandoffError("release.json version, tag, or paths are inconsistent")
    if expected_base_commit is not None and base_commit != expected_base_commit:
        raise HandoffError("release.json base_commit does not match the expected commit")

    expected_files = {Path("release.json"), *_artifact_paths(candidate_version)}
    _validate_artifact_layout(destination, expected_files)
    return expected_metadata{% endraw %}{% endcapture %}

<div id="handoff-validation" markdown="1">

{% include source-preview.html source=handoff_validation label="Проверка release.json и привязка к коммиту · строки 219–268" path="scripts/release_handoff.py" revision=job2_script_revision start=219 comment="#" %}

</div>

Функция `_validate_artifact_layout` разрешает ровно три вложенных каталога
и четыре обычных файла. Она отвергает неожиданные каталоги и файлы, символические
ссылки и специальные файлы. Allowlist перечисляет всё разрешённое, а
denylist перечислял бы только известные запреты. При незнакомом входе
валидатор останавливается с ошибкой (fail closed), поэтому он не пытается
самостоятельно чинить структуру или игнорировать лишние файлы.

{% capture handoff_layout %}{% raw %}def _validate_artifact_layout(destination: Path, expected_files: set[Path]) -> None:
    try:
        root_mode = destination.lstat().st_mode
    except FileNotFoundError as error:
        raise HandoffError(f"Handoff artifact is missing: {destination}") from error
    if not stat.S_ISDIR(root_mode):
        raise HandoffError(f"Handoff artifact must be a directory: {destination}")

    expected_directories = {
        Path("app-editors"),
        Path("app-editors/zed"),
        Path("app-editors/zed/files"),
    }
    found_files: set[Path] = set()
    found_directories: set[Path] = set()

    # Handoff приходит как отдельный artifact из CI: запрещаем symlink и special files,
    # чтобы проверка не прочитала данные за пределами каталога artifact.
    def walk(directory: Path, relative_directory: Path) -> None:
        with os.scandir(directory) as entries:
            for entry in entries:
                relative_path = relative_directory / entry.name
                mode = entry.stat(follow_symlinks=False).st_mode
                if stat.S_ISLNK(mode):
                    raise HandoffError(f"Handoff artifact contains symlink: {relative_path}")
                if stat.S_ISDIR(mode):
                    if relative_path not in expected_directories:
                        raise HandoffError(
                            f"Handoff artifact contains unexpected directory: {relative_path}"
                        )
                    found_directories.add(relative_path)
                    walk(Path(entry.path), relative_path)
                elif stat.S_ISREG(mode):
                    if relative_path not in expected_files:
                        raise HandoffError(
                            f"Handoff artifact contains unexpected file: {relative_path}"
                        )
                    found_files.add(relative_path)
                else:
                    raise HandoffError(
                        f"Handoff artifact contains special file: {relative_path}"
                    )

    walk(destination, Path())
    if found_directories != expected_directories:
        raise HandoffError("Handoff artifact is missing an expected directory")
    if found_files != expected_files:
        raise HandoffError("Handoff artifact is missing an expected file"){% endraw %}{% endcapture %}

<div id="handoff-layout" markdown="1">

{% include source-preview.html source=handoff_layout label="Обход дерева и allowlist · строки 159–206" path="scripts/release_handoff.py" revision=job2_script_revision start=159 comment="#" %}

</div>

<figure class="figure lesson-figure" data-handoff-layout aria-labelledby="handoff-layout-title">
  <h4 id="handoff-layout-title">Что пропускает allowlist?</h4>
  <div class="lab-controls" data-lab-controls hidden>
    <label>Сценарий <select>
      <option value="valid">Корректный handoff</option>
      <option value="extra">Лишний файл</option>
      <option value="symlink">Manifest заменён ссылкой</option>
      <option value="missing">Отсутствует патч</option>
      <option value="commit">Неверный base_commit</option>
    </select></label>
  </div>
  <div class="artifact-tree workspace handoff-tree"><strong>release-handoff/</strong>
  <ul role="list">
    <li><code>release.json</code></li>
    <li><code>app-editors/</code><ul role="list">
      <li><code>zed/</code><ul role="list">
        <li><code>Manifest</code> <strong data-handoff-symlink class="release-change" hidden>→ outside-Manifest · symlink</strong></li>
        <li><code>zed-1.28.1.ebuild</code></li>
        <li><code>files/</code><ul role="list">
          <li data-handoff-patch><code>zed-1.28.1-wayland-only.patch</code></li>
        </ul></li>
      </ul></li>
    </ul></li>
    <li data-handoff-extra class="release-change" hidden><code>unexpected.txt</code> · лишний файл</li>
  </ul>
</div>
  <p class="handoff-metadata"><code>release.json</code> → <code>"base_commit": "<span data-handoff-base data-expected="0123456789abcdef0123456789abcdef01234567" data-mismatch="fedcba9876543210fedcba9876543210fedcba98">0123456789abcdef0123456789abcdef01234567</span>"</code></p>
  <p class="release-result" data-lab-result role="status">PASS · код 0. Структура и базовый коммит совпадают.</p>
  <figcaption>Учебный пример с вымышленным SHA. В каждой попытке меняется одно свойство handoff.</figcaption>
</figure>

При успешной проверке CLI возвращает `0` и ничего не пишет в журнал.
Метка PASS в модели показывает именно этот исход. Неверный коммит отклоняется
ещё до обхода дерева. При структурном успехе содержимое разрешённых ebuild и
патча остаётся за пределами гарантий этой команды.

{% capture handoff_cli %}{% raw %}    if args.validate_handoff is not None:
        try:
            validate_release_handoff(
                args.validate_handoff, expected_base_commit=args.expected_base_commit
            )
        except HandoffError as error:
            print(f"Release handoff error: {error}", file=sys.stderr)
            return 1
        return 0{% endraw %}{% endcapture %}

<div id="handoff-cli" markdown="1">

{% include source-preview.html source=handoff_cli label="Вывод ошибки и код возврата · строки 393–401" path="scripts/release_handoff.py" revision=job2_script_revision start=393 comment="#" %}

</div>

### 2.8.8. Второй валидатор — crates distribution. {#handoff-distribution}

{% capture job2_validate_bundle %}{% raw %}          PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
            --bundle "$RUNNER_TEMP/crates-distribution" \
            --handoff "$RUNNER_TEMP/release-handoff" --base-commit "$GITHUB_SHA" \
            --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
            --metadata-sha256 "$EXPECTED_METADATA_SHA256"{% endraw %}{% endcapture %}

<div id="job2-validate-bundle" markdown="1">

{% include source-preview.html source=job2_validate_bundle label="Вызов валидатора bundle · строки 142–146" path=workflow_path revision=reviewed_revision start=142 comment="#" open=true %}

</div>

Подкоманда `bundle` выбирает проверку собранного набора. Четыре входа дают ей
файлы кандидата, архив, исходную точку сравнения и ожидаемый хеш метаданных.

<figure class="figure lesson-figure release-fanin" aria-labelledby="bundle-inputs-title">
  <h4 id="bundle-inputs-title">Четыре входа <code>crates_distribution.py bundle</code></h4>
  <div class="bundle-fanin">
  <ul class="bundle-inputs" role="list">
    <li class="flow-node"><code>--handoff</code><small>release.json, кандидат, патч и Manifest кандидата</small></li>
    <li class="flow-node"><code>--bundle</code><small>Архив crates и JSON с его метаданными</small></li>
    <li class="flow-node"><code>--base-commit</code><br><code>--base-manifest</code><small>SHA запуска и оригинальный Manifest из checkout</small></li>
    <li class="flow-node"><code>--metadata-sha256</code><small>Ожидаемый SHA256 JSON из outputs Job 1</small></li>
  </ul>
  <div class="flow-node release-boundary"><strong>Валидатор bundle</strong><small>Сверяет входы между собой.</small></div>
  </div>
  <figcaption>Код выхода <code>0</code> при успехе, <code>1</code> при обработанной ошибке.</figcaption>
</figure>

{% capture bundle_order %}{% raw %}def validate_bundle(bundle: Path, handoff: Path, base_commit: str, base_manifest: Path,
                    metadata_sha256: str) -> dict:
    meta = release_handoff.validate_release_handoff(handoff, expected_base_commit=base_commit)
    version = meta['candidate_version']
    archive_name, metadata_name = names(version)
    if not stat.S_ISDIR(bundle.lstat().st_mode) or {p.name for p in bundle.iterdir()} != {archive_name, metadata_name}:
        raise ValueError('Distribution bundle has unexpected files')
    if not SHA256.fullmatch(metadata_sha256):
        raise ValueError('Invalid expected metadata digest')
    data = read_metadata(bundle / metadata_name, version)
    if sha256(bundle / metadata_name) != metadata_sha256:
        raise ValueError('Metadata digest mismatch')
    validate_archive(data, bundle / archive_name)
    candidate = (handoff / meta['candidate_ebuild_path']).read_text(encoding='utf-8')
    validate_uri(candidate, allow_legacy=False)
    if 'gentoo-crate-dist/zed' in candidate:
        raise ValueError('Candidate retains legacy crates source')
    if sync.parse_entries(candidate) != data['git_crates']:
        raise ValueError('Candidate GIT_CRATES disagrees with metadata')
    inspector.verify_manifest(bundle / archive_name, handoff / meta['manifest_path'])
    regular(base_manifest)
    preserve_manifest(base_manifest, handoff / meta['manifest_path'])
    return data{% endraw %}{% endcapture %}

<div id="bundle-order" markdown="1">

{% include source-preview.html source=bundle_order label="Порядок проверок validate_bundle() · строки 182–204" path="scripts/crates_distribution.py" revision=job2_script_revision start=182 comment="#" open=true %}

</div>

<figure class="figure lesson-figure" data-handoff-bundle aria-labelledby="handoff-bundle-title">
  <h4 id="handoff-bundle-title">Где останавливается проверка bundle?</h4>
  <div class="lab-controls" data-lab-controls hidden>
    <label>Сценарий <select><option value="-1">Все входы согласованы</option><option value="0">Чужой коммит в release.json</option><option value="1">Лишний файл в bundle</option><option value="2">Неверный формат output</option><option value="3">Из JSON удалено обязательное поле</option><option value="4">JSON отличается от ожидаемого</option><option value="5">Байты архива изменились</option><option value="6">Возвращён прежний URL crates</option><option value="7">Список Git crates отличается</option><option value="8">В Manifest указан другой размер</option><option value="9">Удалена старая DIST-запись</option></select></label>
  </div>
  <div class="bundle-trace">
    <ol class="bundle-checks" role="list">
    <li id="bundle-check-1" class="flow-node" data-gate-state="PASS" data-error="release.json base_commit does not match the expected commit" data-reason="Handoff должен относиться к коммиту запуска." data-bundle-lines="184"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Проверить handoff и коммит</strong><small>release.json → GITHUB_SHA</small></div></li>
    <li id="bundle-check-2" class="flow-node" data-gate-state="PASS" data-error="Distribution bundle has unexpected files" data-reason="Набор должен содержать ровно архив и JSON этой версии." data-bundle-lines="185–188"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Проверить состав bundle</strong><small>каталог → два ожидаемых имени</small></div></li>
    <li id="bundle-check-3" class="flow-node" data-gate-state="PASS" data-error="Invalid expected metadata digest" data-reason="Без корректного ожидаемого SHA256 сверка потеряла бы смысл." data-bundle-lines="189–190"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Проверить формат ожидаемого SHA256</strong><small>Job 1 output → 64 шестнадцатеричных символа</small></div></li>
    <li id="bundle-check-4" class="flow-node" data-gate-state="PASS" data-error="Metadata fields do not match schema" data-reason="Дальше нужны метаданные установленного формата." data-bundle-lines="191"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Прочитать JSON и проверить схему</strong><small>JSON → схема метаданных</small></div></li>
    <li id="bundle-check-5" class="flow-node" data-gate-state="PASS" data-error="Metadata digest mismatch" data-reason="Файл прошёл проверку схемы, но отличается от результата, на который указывает output." data-bundle-lines="192–193"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Сравнить SHA256 метаданных</strong><small>SHA256 JSON → Job 1 output</small></div></li>
    <li id="bundle-check-6" class="flow-node" data-gate-state="PASS" data-error="Archive does not match metadata" data-reason="Архив должен совпасть с описанием в полученном JSON." data-bundle-lines="194"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Проверить архив</strong><small>архив → имя, размер и SHA256 из JSON</small></div></li>
    <li id="bundle-check-7" class="flow-node" data-gate-state="PASS" data-error="Unexpected candidate crates SRC_URI" data-reason="Подмена допустимого URL прежним источником меняет то, что скачает Portage." data-bundle-lines="195–198"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Проверить SRC_URI</strong><small>ebuild → разрешённый источник crates</small></div></li>
    <li id="bundle-check-8" class="flow-node" data-gate-state="PASS" data-error="Candidate GIT_CRATES disagrees with metadata" data-reason="Списки в ebuild и JSON должны совпасть." data-bundle-lines="199–200"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Сверить GIT_CRATES</strong><small>ebuild → git_crates в JSON</small></div></li>
    <li id="bundle-check-9" class="flow-node" data-gate-state="PASS" data-error="Manifest size or digest fields are invalid" data-reason="У Portage должна быть верная запись для этого архива." data-bundle-lines="201"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Сверить архив с Manifest кандидата</strong><small>архив → размер, BLAKE2B и SHA512 в DIST</small></div></li>
    <li id="bundle-check-10" class="flow-node" data-gate-state="PASS" data-error="Existing Manifest distfile changed: zed-1.27.0.tar.gz" data-reason="Удаление строки нарушает требования к уже имеющимся distfiles." data-bundle-lines="202–203"><span class="lesson-status" data-status="PASS">PASS</span><div><strong>Сохранить исходные DIST-записи</strong><small>исходный Manifest → Manifest кандидата</small></div></li>
    </ol>
    <div class="release-result" data-lab-result role="status">
      <strong data-bundle-status>PASS · код 0</strong>
      <code data-bundle-message>Distribution bundle: OK</code>
      <p data-bundle-reason>Все десять проверок пройдены.</p>
      <a data-bundle-jump hidden>Перейти к проверке</a>
    </div>
  </div>
  <figcaption>На первой ошибке цепочка обрывается. Соответствующие строки подсвечиваются в <a href="#bundle-order">исходнике</a>.</figcaption>
</figure>

Схема метаданных проверяет набор ключей и типы, идентичность версии, поля
архива, описание генератора, записи Git crates и лицензий. Только после
чтения и проверки схемы вычисленный хеш JSON сравнивается с output Job 1.
Архив сверяется по имени, размеру и SHA256. Проверка `SRC_URI` требует
ожидаемые записи источника Zed и архива оверлея и отклоняет прежний источник
crates. Затем проверяются список `GIT_CRATES`, запись архива в Manifest и
сохранность исходных DIST-записей.

{% capture bundle_schema %}{% raw %}def validate_metadata(data: object, version: str) -> dict:
    archive_name, _ = names(version)
    keys = {'schema_version', 'zed_version', 'upstream_tag', 'upstream_commit',
            'source_sha256', 'cargo_lock_sha256', 'generator', 'archive', 'git_crates', 'licenses'}
    if not isinstance(data, dict) or set(data) != keys:
        raise ValueError('Metadata fields do not match schema')
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ValueError('Unsupported metadata schema version')
    if data['zed_version'] != version or data['upstream_tag'] != f'v{version}':
        raise ValueError('Metadata release identity mismatch')
    for key, pattern in (('upstream_commit', SHA1), ('source_sha256', SHA256), ('cargo_lock_sha256', SHA256)):
        if not isinstance(data[key], str) or not pattern.fullmatch(data[key]):
            raise ValueError(f'Invalid {key}')
    if data['generator'] != {'name': 'pycargoebuild', 'version': '0.16.0'}:
        raise ValueError('Unsupported generator')
    archive = data['archive']
    if (not isinstance(archive, dict) or set(archive) != {'filename', 'size', 'sha256'} or
        archive['filename'] != archive_name or type(archive['size']) is not int or archive['size'] <= 0 or
        not isinstance(archive['sha256'], str) or not SHA256.fullmatch(archive['sha256'])):
        raise ValueError('Invalid archive metadata'){% endraw %}{% endcapture %}

<div id="bundle-schema" markdown="1">

{% include source-preview.html source=bundle_schema label="Схема и идентичность метаданных · строки 51–70" path="scripts/crates_distribution.py" revision=job2_script_revision start=51 comment="#" %}

</div>
{% capture bundle_archive %}{% raw %}def validate_archive(data: dict, archive: Path) -> None:
    regular(archive)
    if archive.name != data['archive']['filename'] or archive.stat().st_size != data['archive']['size'] or sha256(archive) != data['archive']['sha256']:
        raise ValueError('Archive does not match metadata'){% endraw %}{% endcapture %}

<div id="bundle-archive" markdown="1">

{% include source-preview.html source=bundle_archive label="Сверка архива с метаданными · строки 121–124" path="scripts/crates_distribution.py" revision=job2_script_revision start=121 comment="#" %}

</div>
{% capture bundle_uri %}{% raw %}def validate_uri(text: str, *, allow_legacy: bool) -> None:
    assignments = re.findall(r'^\s*SRC_URI\s*\+?=', text, re.MULTILINE)
    blocks = re.findall(r'^SRC_URI="([^\"]*)"', text, re.MULTILINE)
    if len(assignments) != 1 or len(blocks) != 1:
        raise ValueError('Expected exactly one simple SRC_URI assignment')
    lines = [line.strip() for line in blocks[0].splitlines()]
    if lines.count(SOURCE_URI) != 1:
        raise ValueError('Upstream source SRC_URI mismatch')
    legacy, migrated = text.count(LEGACY_URI), text.count(OVERLAY_URI)
    allowed = ((1, 0), (0, 1)) if allow_legacy else ((0, 1),)
    if (legacy, migrated) not in allowed:
        raise ValueError('Unexpected candidate crates SRC_URI')
    expected = LEGACY_URI if legacy else OVERLAY_URI
    if lines.count(expected) != 1:
        raise ValueError('Candidate crates URL is not an SRC_URI entry'){% endraw %}{% endcapture %}

<div id="bundle-uri" markdown="1">

{% include source-preview.html source=bundle_uri label="Проверка SRC_URI · строки 138–152" path="scripts/crates_distribution.py" revision=job2_script_revision start=138 comment="#" %}

</div>
{% capture bundle_manifest %}{% raw %}def verify_manifest(archive: Path, manifest: Path) -> None:
    records = [line.split() for line in manifest.read_text().splitlines()
               if line.startswith(f'DIST {archive.name} ')]
    if len(records) != 1:
        raise ValueError('Manifest must contain exactly one generated archive record')
    record = records[0]
    if len(record) != 7 or int(record[2]) != archive.stat().st_size:
        raise ValueError('Manifest size or digest fields are invalid')
    checks = dict(zip(record[3::2], record[4::2]))
    if set(checks) != {'BLAKE2B', 'SHA512'}:
        raise ValueError('Manifest must contain BLAKE2B and SHA512 digests')
    for name, expected in checks.items():
        if digest(archive, name.lower()) != expected.lower():
            raise ValueError(f'Manifest {name} mismatch')
    print('Generated archive Manifest digests: OK'){% endraw %}{% endcapture %}

<div id="bundle-manifest" markdown="1">

{% include source-preview.html source=bundle_manifest label="Значения из Manifest кандидата · строки 53–67" path="scripts/inspect_zed_archive.py" revision=job2_script_revision start=53 comment="#" %}

</div>
{% capture bundle_cli %}{% raw %}        elif args.action == 'bundle':
            validate_bundle(Path(args.bundle), Path(args.handoff), args.base_commit,
                            Path(args.base_manifest), args.metadata_sha256)
        else:
            preserve_manifest(args.before, args.after)
    except (OSError, ValueError, KeyError, json.JSONDecodeError, snapshot.CargoSnapshotError, release_handoff.HandoffError) as error:
        print(f'Distribution validation failed: {error}', file=sys.stderr)
        return 1
    print(f'Distribution {args.action}: OK')
    return 0{% endraw %}{% endcapture %}

<div id="bundle-cli" markdown="1">

{% include source-preview.html source=bundle_cli label="Вывод CLI и коды возврата · строки 235–244" path="scripts/crates_distribution.py" revision=job2_script_revision start=235 comment="#" %}

</div>

Job 2 проверяет конкретные связи между полученными файлами. Скачивание
исходников, проверка upstream Git-дерева и полного снимка `Cargo.lock` против
исходников, а также проверка разрешения зависимостей Portage относятся к Job 1.
Компиляции Zed здесь нет. Проверка формата `upstream_commit` и хешей в JSON
сама по себе не подтверждает подлинность исходников.

### 2.8.9. Зачем столько разных контрольных сумм? {#handoff-integrity}

<figure class="figure lesson-figure integrity-map" aria-labelledby="integrity-map-title">
  <h4 id="integrity-map-title">Два пути сверки одного архива</h4>
  <div class="integrity-branches">
    <div>
      <div class="flow-node"><strong>Job 1 output</strong><small>Ожидаемый SHA256 метаданных</small></div>
      <p class="release-edge"><span aria-hidden="true">↓</span> SHA256 файла</p>
      <div class="flow-node"><strong>JSON метаданных</strong><small>Имя, размер и SHA256 архива</small></div>
      <p class="release-edge"><span aria-hidden="true">↓</span> Имя, размер, SHA256</p>
    </div>
    <div>
      <div class="flow-node"><strong>Оригинальный Manifest</strong><small>Из checkout на коммите запуска</small></div>
      <p class="release-edge"><span aria-hidden="true">↓</span> Сохранение DIST-строк</p>
      <div class="flow-node"><strong>Manifest кандидата</strong><small>Запись DIST для нового архива</small></div>
      <p class="release-edge"><span aria-hidden="true">↓</span> Размер, BLAKE2B, SHA512</p>
    </div>
  </div>
  <div class="flow-node release-boundary"><strong>Один архив crates</strong></div>
</figure>

Ожидаемый SHA256 идёт отдельно от скачанного JSON. Если заменить архив
вместе с его JSON, но оставить output прежним, сверка обнаружит изменившийся
хеш JSON. Сверка с JSON проверяет комплект distribution, а сверка с Manifest
подтверждает, что файл совпадает с описанием, по которому его получит Portage.

Хеши позволяют проверить совпадение данных с ожидаемыми значениями.
Подлинность требует доверия к происхождению данных. Например, её можно
подтвердить цифровой подписью, если известен доверенный публичный ключ. Здесь и ожидаемый SHA256, и комплект
файлов готовит Job 1. Если скомпрометирован сам Job 1, одного такого output
недостаточно для независимого подтверждения подлинности.

{% capture manifest_preserve %}{% raw %}def manifest_records(path: Path) -> dict[str, str]:
    records: dict[str, str] = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[0] != 'DIST' or parts[1] in records:
            raise ValueError('Malformed or duplicate Manifest entry')
        records[parts[1]] = line
    return records


def preserve_manifest(before: Path, after: Path) -> None:
    old, new = manifest_records(before), manifest_records(after)
    for name, line in old.items():
        if new.get(name) != line:
            raise ValueError(f'Existing Manifest distfile changed: {name}'){% endraw %}{% endcapture %}

<div id="manifest-preserve" markdown="1">

{% include source-preview.html source=manifest_preserve label="Сохранение DIST-записей · строки 165–179" path="scripts/crates_distribution.py" revision=job2_script_revision start=165 comment="#" open=true %}

</div>

Оригинальный Manifest берётся из закреплённого checkout, чтобы кандидат не
определял собственный эталон. `preserve_manifest()` находит запись по имени
distfile и сравнивает **всю строку**. Старые записи нужны версиям ebuild,
которые остаются в overlay.

<figure class="figure lesson-figure" data-handoff-manifest aria-labelledby="handoff-manifest-title">
  <h4 id="handoff-manifest-title">Какие DIST-записи можно менять?</h4>
  <div class="lab-controls" data-lab-controls hidden>
    <label>Изменение кандидата <select><option value="add">Добавить запись</option><option value="edit">Изменить существующую запись</option><option value="remove">Удалить существующую запись</option></select></label>
  </div>
  <div class="manifest-pair">
    <div><strong>Исходный Manifest</strong><pre><code><span data-manifest-original>DIST zed-1.27.0.tar.gz 120 BLAKE2B &lt;A&gt; SHA512 &lt;B&gt;</span>
DIST zed-1.27.1.tar.gz 125 BLAKE2B &lt;C&gt; SHA512 &lt;D&gt;</code></pre></div>
    <div><strong>Manifest кандидата</strong><pre><code><span data-manifest-copy>DIST zed-1.27.0.tar.gz <b data-manifest-size>120</b> BLAKE2B &lt;A&gt; SHA512 &lt;B&gt;</span><span data-manifest-absent class="release-change" hidden>− Запись zed-1.27.0.tar.gz удалена</span>
DIST zed-1.27.1.tar.gz 125 BLAKE2B &lt;C&gt; SHA512 &lt;D&gt;
<span data-manifest-added class="release-add">DIST zed-1.28.1.tar.gz 130 BLAKE2B &lt;E&gt; SHA512 &lt;F&gt;</span></code></pre></div>
  </div>
  <p data-lab-result role="status">PASS · исходные строки сохранены. Появилась новая запись.</p>
  <figcaption>Имена, размеры и обозначения хешей &lt;A&gt;–&lt;F&gt; служат только иллюстрацией.</figcaption>
</figure>

Добавлять записи можно. Удаление любой исходной строки и изменение хотя бы
одного её символа приводят к отказу. Сохранение старых записей само по себе
ничего не говорит о правильности всех новых.

### 2.8.10. Результат второго job. {#handoff-final}

{% capture job2_echo %}{% raw %}          echo "Release handoff and distribution boundaries: OK"{% endraw %}{% endcapture %}

<div id="job2-echo" markdown="1">

{% include source-preview.html source=job2_echo label="Сообщение в журнале · строка 147" path=workflow_path revision=reviewed_revision start=147 comment="#" open=true %}

</div>

`echo` пишет обычную строку в журнал. Её появление означает, что Bash дошёл
до этой команды. GitHub Actions определяет успех по результату шага и
остальных операций job. Если один из валидаторов вернёт ошибку, до строки
успеха выполнение не дойдёт.

<figure class="figure lesson-figure" data-handoff-final aria-labelledby="handoff-final-title">
  <h4 id="handoff-final-title">От кода выхода до условия публикации</h4>
  <div class="lab-controls release-controls" data-lab-controls hidden>
    <label><input type="checkbox" data-first-ok checked> Первый валидатор успешен</label>
    <label><input type="checkbox" data-second-ok checked> Второй валидатор успешен</label>
  </div>
  <ol class="lesson-flow gate-flow release-gates release-final-flow" role="list">
    <li class="flow-node" data-gate-state="PASS"><strong>Проверка handoff</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="PASS"><strong>Проверка distribution</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
    <li class="flow-node" data-gate-state="ВЫПОЛНЕН"><strong>Итоговый <code>echo</code></strong><span class="lesson-status" data-status="ВЫПОЛНЕН">ВЫПОЛНЕН</span></li>
    <li class="flow-node" data-gate-state="SUCCESS"><strong>Статус Job 2</strong><span class="lesson-status" data-status="SUCCESS">SUCCESS</span></li>
    <li class="flow-node" data-gate-state="PASS"><strong>Условие Job 3</strong><span class="lesson-status" data-status="PASS">PASS</span></li>
  </ol>
  <p data-lab-result role="status">Job 2: success. Условие успеха в Job 3 выполнено.</p>
  <figcaption>Модель предполагает успешные checkout, скачивания и остальные операции runner.</figcaption>
</figure>

{% capture job3_result %}{% raw %}    needs: [check, validate-release-handoff]
    if: >-
      needs.check.outputs.handoff_ready == 'true' &&
      !(github.event_name == 'workflow_dispatch' && inputs.independent_validation) &&
      needs['validate-release-handoff'].result == 'success' &&
      github.ref == 'refs/heads/main'{% endraw %}{% endcapture %}

<div id="job3-result" markdown="1">

{% include source-preview.html source=job3_result label="Условия Job 3 · строки 153–158" path=workflow_path revision=reviewed_revision start=153 comment="#" %}

</div>

`needs['validate-release-handoff'].result` даёт Job 3 статус Job 2. Успех
выполняет одно из условий допуска. По-прежнему нужны успешный Job 1, готовый
handoff, production-режим и ветка `main`. Job 2 завершает проверку статусом.
За файлами Job 3 сам обращается к артефактам Job 1.

Строки 149–150 подводят к публикации. В этом workflow до job с правами на
запись доходят запуски из `main` с успешно проверенным handoff.

{% capture job3_start %}{% raw %}  # PR создаётся только после успешной проверки handoff и при запуске из main;
  # остальные события не доходят до job с правами на запись.{% endraw %}{% endcapture %}

<div id="job3-start" markdown="1">

{% include source-preview.html source=job3_start label="Переход к Job 3 · строки 149–150" path=workflow_path revision=reviewed_revision start=149 comment="#" %}

</div>
