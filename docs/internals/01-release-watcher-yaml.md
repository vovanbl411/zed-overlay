---
layout: handbook
title: Release watcher — разбираем YAML
description: "Как первые 22 строки workflow задают расписание, права токена и правила для одновременных запусков."
chapter: 1
eyebrow: Глава 01 / Продолжение
permalink: /internals/01-release-watcher/yaml/
sections:
  - { id: yaml, label: "2.1. Основы YAML" }
  - { id: triggers, label: "2.2. Название и события" }
  - { id: permissions, label: "2.3. Разрешения" }
  - { id: concurrency, label: "2.4. Параллельные запуски" }
  - { id: summary, label: "2.5. Краткий справочник" }
---

{% assign workflow = 'https://github.com/vovanbl411/zed-overlay/blob/38531d4e4cfe0506f0f5f6b551c60897b6bea83c/.github/workflows/zed-release-watcher.yml' %}

## 2.1. Первые строки: учимся читать YAML {#yaml}

YAML — текстовый формат для описания структурированных данных. В этом файле
мы описываем настройки workflow. GitHub Actions читает структуру и по своим
правилам определяет, когда запустить workflow и в каком порядке выполнять
задания (jobs). Команды Bash или Python исполняются внутри отдельных шагов.
Строки YAML с настройками сами по себе команд не запускают.

Выберите конструкцию. Все примеры взяты из [строк 2–8 файла workflow]({{ workflow }}#L2-L8).

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
[Открыть строки 1–15 в репозитории]({{ workflow }}#L1-L15).

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
[Условия передачи файлов]({{ workflow }}#L73-L89) ·
[Условия публикации]({{ workflow }}#L149-L158).

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

[Настройки на уровне workflow, строки 17–18]({{ workflow }}#L17-L18).

{% capture permissions_source %}
permissions:
  contents: read{% endcapture %}

<div class="selector" data-selector markdown="1">
{% include source-lines.html source=permissions_source start=16 label="Настройки прав на уровне workflow" interactive=true %}
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
</div>

В [общей архитектуре]({{ '/internals/01-release-watcher/' | relative_url }}#jobs)
первые два задания готовят кандидат и повторно проверяют переданные файлы.
Оба явно запрашивают `contents: read`. Только третьему заданию нужны
`contents: write` для публикации архива и отправки ветки, а также
`pull-requests: write` для создания черновика PR. Если убрать одно из этих
прав, соответствующая операция записи потеряет нужное разрешение.
Так работает принцип **минимальных привилегий**: каждому заданию дают
столько прав, сколько нужно для его работы.

### Что разрешено токену {#token-capabilities}

{% capture check_permissions %}    permissions:
      contents: read{% endcapture %}
{% capture publish_permissions %}    permissions:
      contents: write
      pull-requests: write{% endcapture %}

<div class="selector" data-selector data-label="Права заданий" markdown="1">
<div class="selection-panel" data-panel data-label="Job 1 / Job 2 · чтение" id="read-permissions" markdown="1">
### Job 1 / Job 2 · чтение

{% include source-lines.html source=check_permissions start=29 label="Права Job 1, строки 29–30" %}

У Job 2 такой же блок. [Строки 29–30]({{ workflow }}#L29-L30) и [112–113]({{ workflow }}#L112-L113).
</div>
<div class="selection-panel" data-panel data-label="Job 3 · публикация" id="publish-permissions" markdown="1">
### Job 3 · публикация

{% include source-lines.html source=publish_permissions start=160 label="Права Job 3, строки 160–162" %}

[Строки 160–162 в репозитории]({{ workflow }}#L160-L162).
</div>
</div>

| Операция | Job 1 / Job 2 | Job 3 |
| --- | --- | --- |
| Читать содержимое репозитория | **✓ Разрешено**{:.permission-allowed} | **✓ Разрешено**{:.permission-allowed} |
| Читать сведения о коммитах | **✓ Разрешено**{:.permission-allowed} | **✓ Разрешено**{:.permission-allowed} |
| Создавать ветки | **— Право не выдано**{:.permission-absent} | **✓ Разрешено**{:.permission-allowed} |
| Публиковать GitHub Releases | **— Право не выдано**{:.permission-absent} | **✓ Разрешено**{:.permission-allowed} |
| Создавать pull requests | **— Право не выдано**{:.permission-absent} | **✓ Разрешено**{:.permission-allowed} |
| Менять административные настройки репозитория | **— Право не выдано**{:.permission-absent} | **— Право не выдано**{:.permission-absent} |
{: .permissions-table}

В таблице показано, какие возможности дают права токена. Успех операции
зависит также от правил репозитория (rulesets), защиты веток и настроек
GitHub Actions. Например, для создания PR в настройках репозитория должно
быть разрешено создание pull requests из GitHub Actions.
[Справочник `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) ·
[Настройки создания PR](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).

## 2.4. Управление параллельными запусками {#concurrency}

Ручной запуск может поступить, пока watcher ещё занят проверкой по
расписанию. Блок `concurrency` определяет, как GitHub Actions обработает
эти запуски. [Строки 20–22 в репозитории]({{ workflow }}#L20-L22).

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
[Проверка черновика и загрузка файлов в скрипте публикации](https://github.com/vovanbl411/zed-overlay/blob/38531d4e4cfe0506f0f5f6b551c60897b6bea83c/scripts/crates_github.py#L226-L274).

## 2.5. Что мы уже изучили {#summary}

| Термин | Что он значит для watcher |
| --- | --- |
| YAML | Формат файла с настройками workflow. |
| Событие (event) | Повод для запуска, например время по расписанию или ручной запрос. |
| Cron | Запись расписания из пяти полей. |
| Параметр (input) | Значение, которое можно передать при ручном запуске. |
| `GITHUB_TOKEN` | Временный токен задания для обращения к GitHub. |
| `permissions` | Права, которые получает токен. |
| Минимальные привилегии | Каждое задание получает только права, нужные для его работы. |
| `concurrency` | Правила для запусков, которые претендуют на одну группу одновременно. |

Первые 22 строки задают общие условия работы workflow. С [24-й строки]({{ workflow }}#L24-L26)
начинается блок `jobs`. Первое задание, **Check stable Zed release**, ищет
обновление и готовит кандидат.

**В планах**

- Строки 24–103 · Job 1 — Check
- Строки 105–147 · Job 2 — Validate
- Строки 149–240 · Job 3 — Publish
