---
layout: handbook
title: Release watcher — разбор YAML
description: "Как первые 38 строк workflow задают условия запуска и настройки задания Check stable Zed release."
chapter: 1
eyebrow: Глава 01 / Продолжение
permalink: /internals/01-release-watcher/yaml/
sections:
  - { id: yaml, label: "2.1. Основы YAML" }
  - { id: triggers, label: "2.2. Название и события" }
  - { id: permissions, label: "2.3. Разрешения" }
  - { id: concurrency, label: "2.4. Параллельные запуски" }
  - { id: job-check, label: "2.5. Job 1 — начало выполнения workflow" }
---

{% assign reviewed_revision = '38531d4e4cfe0506f0f5f6b551c60897b6bea83c' %}
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

Дальше, в строках 39–60, начинаются шаги `check`. Там watcher записывает
время старта, получает копию репозитория, проверяет политику оверлея,
запускает unit tests и начинает подготовку кандидата.
