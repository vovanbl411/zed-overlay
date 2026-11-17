---
layout: handbook
title: Как устроен Zed release watcher
description: "От нового тега Zed до черновика обновления в Gentoo. Разберём поток данных, границы проверки и решения, которые остаются за сопровождающим."
chapter: 1
permalink: /internals/01-release-watcher/
---

## 1.1. Какую задачу мы решаем? {#problem}

Когда разработчики Zed выпустили версию 1.28.1, в оверлее была версия 1.27.0.
**Оверлей** — дополнительный репозиторий пакетов Gentoo, дистрибутива Linux.
Чтобы обновить пакет, нужен архив исходников нужной версии и зафиксированный
набор зависимостей. Watcher готовит отдельный архив с библиотеками Rust из
реестра пакетов. Такие библиотеки называются crates.
Затем нужно обновить **ebuild**, рецепт для системы сборки Portage,
и **Manifest**, список скачиваемых файлов с размерами и контрольными суммами.
Патч для нужной версии должен применяться к этим исходникам и сохранять
сборку для Wayland.

Release watcher — помощник сопровождающего. Он ищет стабильный релиз
по ежедневному расписанию на 06:17 UTC и по ручному запуску. Если есть обновление, он готовит
кандидат и может открыть Draft PR — черновик предложения о внесении изменений.

<div class="comparison" markdown="1">
<div class="panel" markdown="1">

### Автоматизация

- Находит релиз.
- Готовит зависимости.
- Создаёт кандидат ebuild.
- Проверяет Manifest.
- Проверяет применимость патча.
- Публикует архив зависимостей.
- Создаёт черновик PR.

</div>
<div class="panel" markdown="1">

### Сопровождающий

- Изучает изменения в исходном проекте.
- Проверяет ebuild.
- Сверяет лицензии.
- Выполняет полную сборку.
- Проверяет, с какими библиотеками связан бинарный файл (`scanelf`, `lddtree`).
- Проверяет запуск в Wayland.
- Принимает решение и вручную выполняет merge.

</div>
</div>

> Успешный workflow подтверждает подготовку кандидата. Полная компиляция
> и проверка запуска Zed в него не входят.

## 1.2. Из каких компонентов состоит система? {#glossary}

Выберите термин, чтобы увидеть его роль и пример.

<div class="selector" data-selector data-label="Термины" markdown="1">
<div class="selection-panel" data-panel data-label="Upstream" id="term-upstream" markdown="1">
### Upstream

Исходный проект, который выпускает Zed. Оверлей берёт его исходники и
адаптирует процесс сборки для Gentoo. Например, watcher увидел тег
[`v1.28.1` в `zed-industries/zed`](https://github.com/zed-industries/zed/tree/v1.28.1).
</div>
<div class="selection-panel" data-panel data-label="Overlay" id="term-overlay" markdown="1">
### Overlay

Дополнительный репозиторий пакетов Gentoo. Portage может использовать его
вместе с основным репозиторием. Здесь это
[`vovanbl411/zed-overlay`](https://github.com/vovanbl411/zed-overlay),
где лежит адаптированный для Wayland пакет `app-editors/zed`.
</div>
<div class="selection-panel" data-panel data-label="Ebuild" id="term-ebuild" markdown="1">
### Ebuild

Рецепт для Portage. В нём указано, откуда скачать исходники, какие
зависимости нужны и как подготовить, собрать и установить пакет.
Пример из обновления —
[`zed-1.28.1.ebuild`](https://github.com/vovanbl411/zed-overlay/blob/35d16afc234c873b2a075e2fb9bdebc22a188f15/app-editors/zed/zed-1.28.1.ebuild).
</div>
<div class="selection-panel" data-panel data-label="Portage" id="term-portage" markdown="1">
### Portage

Система управления пакетами Gentoo. `emerge` разрешает зависимости и
устанавливает пакеты, а команда `ebuild` позволяет отдельно вызвать нужную
операцию с рецептом. Watcher запускает `ebuild … manifest` для обновления
Manifest и `emerge -pv --oneshot` для просмотра плана установки без сборки.
</div>
<div class="selection-panel" data-panel data-label="Cargo" id="term-cargo" markdown="1">
### Cargo

Инструмент Rust для работы с зависимостями и сборкой. В
[`Cargo.toml`](https://github.com/zed-industries/zed/blob/v1.28.1/Cargo.toml)
проект объявляет зависимости, а
[`Cargo.lock`](https://github.com/zed-industries/zed/blob/v1.28.1/Cargo.lock)
фиксирует выбранные версии и Git-ревизии. Watcher сверяет `GIT_CRATES` в
ebuild со списком Git-зависимостей из этой версии Zed.
</div>
<div class="selection-panel" data-panel data-label="Manifest" id="term-manifest" markdown="1">
### Manifest

В [`app-editors/zed/Manifest`](https://github.com/vovanbl411/zed-overlay/blob/35d16afc234c873b2a075e2fb9bdebc22a188f15/app-editors/zed/Manifest)
запись `DIST` хранит имя скачиваемого файла (distfile), размер и
криптографические контрольные суммы BLAKE2B и SHA512. Portage сверяет с ними
скачанные файлы. Для 1.28.1 в Manifest добавили запись об архиве crates.
</div>
<div class="selection-panel" data-panel data-label="GitHub Actions" id="term-actions" markdown="1">
### GitHub Actions

Сервис GitHub, который запускает автоматические задачи по расписанию,
событию или вручную. Порядок задач watcher задан в
[`zed-release-watcher.yml`](https://github.com/vovanbl411/zed-overlay/blob/7b2ab50d128921c386604b0754d2aa2a39b978bb/.github/workflows/zed-release-watcher.yml).
</div>
<div class="selection-panel" data-panel data-label="Pull request" id="term-pr" markdown="1">
### Pull request

Предложение перенести изменения из одной ветки в другую. В PR видно, какие
файлы изменились, и можно обсудить их перед слиянием.
[PR #46](https://github.com/vovanbl411/zed-overlay/pull/46) предложил обновить
пакет до 1.28.1. Watcher открыл его в статусе Draft, то есть как черновик.
</div>
</div>

## 1.3. Что такое workflow, job, step и runner? {#workflow}

**Workflow** — весь процесс автоматизации. Его описывает файл
[`.github/workflows/zed-release-watcher.yml`](https://github.com/vovanbl411/zed-overlay/blob/7b2ab50d128921c386604b0754d2aa2a39b978bb/.github/workflows/zed-release-watcher.yml).
**YAML** — текстовый формат, в котором отступы и списки помогают выразить
структуру. Внутри workflow есть **jobs**, группы связанных операций.
Отдельная операция внутри job — **step**.

<figure class="figure">
  <div class="nest">
    <strong>Workflow <code>Zed release watcher</code></strong>
    <ul>
      <li><strong>Job <code>check</code></strong>
        <ul>
          <li>Step · Check out the overlay</li>
          <li>Step · Check overlay policy</li>
          <li>Step · Run unit tests</li>
        </ul>
      </li>
      <li>Job <code>validate-release-handoff</code></li>
      <li>Job <code>publish-draft-release-pr</code></li>
    </ul>
  </div>
  <figcaption>Вложенность workflow. Внутри <code>check</code> показаны три шага из YAML.</figcaption>
</figure>

**Runner** — машина, которая исполняет job. В этом workflow каждый job
запрашивает GitHub-hosted runner `ubuntu-24.04` и получает отдельное окружение.
Файл, созданный на диске в `check`, не появится сам на runner следующего job.
Чтобы передать его, нужно явно загрузить и скачать артефакт.

## 1.4. Три главных этапа {#jobs}

Выберите job, чтобы посмотреть, что он получает и при каких условиях
передаёт управление дальше.

<div class="selector job-flow" data-selector data-label="Задания workflow" markdown="1">
<div class="selection-panel" data-panel data-label="check" id="job-check" markdown="1">
### Check stable Zed release

**Назначение.** Подготовить и проверить кандидат во временной копии репозитория.

**Права.** `contents: read`.

**Вход.** Коммит запуска, стабильный upstream-релиз и, если он уже доступен,
опубликованный crates release.

**Действия.** Найти релиз, сверить исходники с коммитом тега, сгенерировать или
повторно использовать архив crates, синхронизировать `GIT_CRATES`. Подготовить
ebuild и патч, обновить Manifest, проверить разрешение зависимостей через
Portage и применимость патча.

**Выход.** Для нового релиза в production-режиме — handoff с файлами
кандидата, комплект дистрибуции crates и выходные значения job.

**Когда пропускается.** Job стартует при запуске workflow. Если пакет актуален,
шаги подготовки кандидата и архива пропускаются. В validation-only режиме
кандидат для нового релиза проверяется без создания handoff.
</div>
<div class="selection-panel" data-panel data-label="validate-release-handoff" id="job-validate" markdown="1">
### Validate release handoff

**Назначение.** Независимо проверить переданные файлы перед публикацией.

**Права.** `contents: read`.

**Вход.** Коммит запуска, оба артефакта из `check` и ожидаемый
`metadata_sha256`.

**Действия.** Скачать артефакты отдельно от job публикации. Сверить состав
handoff и его базовый коммит с коммитом запуска. Проверить согласованность
метаданных, архива и Manifest, включая сохранность прежних записей distfiles.

**Выход.** Результат job: успешная проверка или ошибка.

**Когда пропускается.** Если `check` завершился ошибкой, `handoff_ready` не равен
`true` или включён validation-only режим.
</div>
<div class="selection-panel" data-panel data-label="publish-draft-release-pr" id="job-publish" markdown="1">
### Publish Draft release PR

**Назначение.** Опубликовать проверенный архив и предложить обновление оверлея.

**Права.** `contents: write` и `pull-requests: write`.

**Вход.** Успех двух предыдущих jobs, свежая копия `main`, исходные артефакты
из `check` и его метаданные.

**Действия.** Сверить базовый коммит со свежим `main`, применить handoff и
повторить проверку политики. Опубликовать crates release или проверить
уже существующий, затем проверить публичное скачивание без авторизации.
Проверить изменения Git и создать Draft PR либо распознать уже открытый PR.

**Выход.** Проверенный публичный crates release и ссылка на новый или
существующий PR при успешном завершении.

**Когда пропускается.** Если любой из предыдущих jobs не завершился успешно,
handoff не готов, включён validation-only режим или запуск сделан вне `main`.
</div>
</div>

Первые два jobs могут обнаружить ошибку до выдачи прав на запись.
`contents: read` ограничивает возможность токена GitHub менять репозиторий.
Сами шаги всё ещё выполняют код, работают с локальными файлами и обращаются к сети.

## 1.5. Как данные передаются между jobs? {#artifacts}

**Артефакт GitHub Actions** — файлы, которые job загружает в хранилище
конкретного запуска. В этом workflow `check` загружает два комплекта для
публикации, а каждый downstream job при запуске скачивает оба комплекта.

<figure class="figure">
  <div class="artifact-map">
    <div class="flow-node"><code>check</code><small>Загружает файлы</small></div>
    <div class="flow-arrow" aria-hidden="true">↓</div>
    <div class="flow-node artifact"><code>release-handoff</code> + <code>crates-distribution</code></div>
    <div class="artifact-branches">
      <div><div class="flow-arrow" aria-hidden="true">↓</div><div class="flow-node"><code>validate-release-handoff</code><small>Скачивает оба артефакта</small></div></div>
      <div><div class="flow-arrow" aria-hidden="true">↓</div><div class="flow-node"><code>publish-draft-release-pr</code><small>Скачивает оба артефакта</small></div></div>
    </div>
    <div class="gate-label"><code>validate-release-handoff</code> <span aria-hidden="true">⇢</span> разрешает публикацию при <code>success</code></div>
  </div>
  <figcaption>Сплошные стрелки показывают передачу файлов. Пунктиром обозначено условие запуска. Проверяющий job передаёт свой статус, а архив job публикации скачивает из исходного артефакта.</figcaption>
</figure>

| Артефакт | Состав | Хранение |
| --- | --- | --- |
| `release-handoff` | Manifest, кандидат ebuild, Wayland-патч для этой версии и `release.json` с данными о кандидате | 14 дней |
| `crates-distribution` | `zed-{version}-overlay-crates.tar.xz` и `zed-{version}-overlay-crates.json` | 14 дней |
| `independent-validation-logs` | Диагностические логи, если они появились | 7 дней |

Небольшие значения передаются как **job outputs**, то есть именованные
строки. `handoff_ready` сообщает о готовности комплекта,
`archive_mode` указывает путь `generation` или `reuse`,
а `metadata_sha256` передаёт контрольную сумму JSON отдельно от самого файла.

Артефакты Actions нужны на время проверки запуска. **GitHub Release assets**
прикреплены к релизу, например [`crates-v1.28.1`](https://github.com/vovanbl411/zed-overlay/releases/tag/crates-v1.28.1).
На опубликованный архив ссылается ebuild, чтобы Portage мог скачать его и после
истечения срока хранения артефактов.

## 1.6. Лаборатория release watcher {#lab}

Это учебная модель. Она пересчитывает результат в браузере и не обращается
к GitHub. Сценарий ошибки применяется, только если запуск доходит до
соответствующего job. В сценариях со сбоями архив к началу запуска ещё не опубликован.

<form class="lab panel" data-simulator hidden>
  <label>Сценарий
    <select name="scenario">
      <option value="new">Новый релиз, crates archive отсутствует</option>
      <option value="reuse">Crates archive уже опубликован</option>
      <option value="existing">Crates archive и automation PR уже существуют</option>
      <option value="current">Пакет уже актуален</option>
      <option value="candidate-error">Ошибка подготовки candidate</option>
      <option value="handoff-error">Ошибка проверки handoff</option>
      <option value="pr-error">Сбой PR после публикации архива</option>
    </select>
  </label>
  <div class="lab-controls">
    <label><input type="checkbox" name="validation"> Validation-only mode</label>
    <label>Ветка запуска
      <select name="branch">
        <option value="main">main</option>
        <option value="other">Другая ветка</option>
      </select>
    </label>
  </div>
  <div aria-live="polite" aria-atomic="true">
    <ol class="job-results">
      <li><code>check</code><strong data-status></strong><p data-reason></p></li>
      <li><code>validate-release-handoff</code><strong data-status></strong><p data-reason></p></li>
      <li><code>publish-draft-release-pr</code><strong data-status></strong><p data-reason></p></li>
    </ol>
    <p class="lab-outcome" data-outcome></p>
  </div>
</form>
<noscript><p>Для симулятора нужен JavaScript. Условия запуска каждого job описаны в разделе <a href="#jobs">«Три главных этапа»</a>.</p></noscript>

Если перед созданием ветки произошёл сбой, уже опубликованный валидный
архив можно повторно использовать при следующем успешном запуске. Если
удалённая automation branch уже существует, а открытого PR нет, workflow
завершается с ошибкой и сохраняет ветку. Это отдельный случай, требующий
решения сопровождающего.

## 1.7. Реальный пример работы {#history}

При переходе с 1.27.0 на 1.28.1 внешний crates archive Gentoo сначала был
недоступен. В upstream изменились семь Git-ревизий зависимостей LiveKit.
Независимая генерация воспроизвела ожидаемый архив для нового набора зависимостей.

<ol class="timeline">
  <li><strong>Stage 1 · проверка генерации</strong>
    <p>Подготовка и проверка прошли в <a href="https://github.com/vovanbl411/zed-overlay/actions/runs/44129394269">запуске 44129394269</a>. Архив на этом этапе проверялся без публикации.</p>
  </li>
  <li class="event-fail"><strong>Stage 2 · архив опубликован, workflow завершился ошибкой</strong>
    <p>Первый production <a href="https://github.com/vovanbl411/zed-overlay/actions/runs/44142769356">запуск 44142769356</a> опубликовал <a href="https://github.com/vovanbl411/zed-overlay/releases/tag/crates-v1.28.1"><code>crates-v1.28.1</code></a>. Затем <code>git diff --cached --check</code> нашёл пробелы на концах строк в унаследованном ebuild. Job остановился до создания automation branch.</p>
  </li>
  <li><strong>Исправление и повторное использование</strong>
    <p>Владелец удалил лишние пробелы. <a href="https://github.com/vovanbl411/zed-overlay/actions/runs/44148805330">Запуск 44148805330</a> прошёл 119 unit tests, повторно использовал опубликованный архив и открыл <a href="https://github.com/vovanbl411/zed-overlay/pull/46">Draft PR #46</a>.</p>
  </li>
</ol>

<figure class="figure duration">
  <figcaption>Продолжительность трёх запусков. Общая шкала от 0 до 22 минут.</figcaption>
  <div><span>Stage 1</span><strong>17 мин 48 с</strong><meter min="0" max="1320" value="1068" aria-label="Stage 1, 17 минут 48 секунд"></meter></div>
  <div class="run-fail"><span>Production · generation</span><strong>21 мин 49 с</strong><meter min="0" max="1320" value="1309" aria-label="Production generation, 21 минута 49 секунд"></meter></div>
  <div><span>Production · reuse</span><strong>3 мин 32 с</strong><meter min="0" max="1320" value="212" aria-label="Production reuse, 3 минуты 32 секунды"></meter></div>
</figure>

В проверенном архиве было 1439 crates из реестра и 86 Git-зависимостей.
Размер архива — 130 033 452 байта. Его контрольная сумма SHA256 приведена ниже.

```text
44c617444e1778db623e403f6782ee9dab3b2ede03b352c5c32ec7723fcf1ea3
```

Эти замеры относятся к конкретным запускам для 1.28.1. Полная сборка
и проверка запуска Zed остаются этапами ручной приёмки.

## 1.8. Проверяем, что мы поняли {#quiz}

<form class="quiz" data-quiz hidden>
  <fieldset class="panel">
    <legend>1. Watcher создал Draft PR. Доказывает ли это, что Zed соберётся?</legend>
    <label><input type="radio" name="build" data-feedback="Разрешение зависимостей проверяет план установки. Ошибка компиляции всё ещё возможна."> Да, Portage уже разрешил зависимости.</label>
    <label><input type="radio" name="build" data-correct data-feedback="Watcher проверяет подготовку кандидата. Полная компиляция и проверка запуска входят в ручную приёмку."> Нет, полную сборку и запуск проверяют вручную.</label>
    <label><input type="radio" name="build" data-feedback="Dry-run проверяет применимость патча к исходникам. Компилятор на этом шаге не запускается."> Да, если Wayland-патч прошёл dry-run.</label>
    <p class="quiz-feedback" data-feedback-output aria-live="polite"></p>
  </fieldset>
  <fieldset class="panel">
    <legend>2. Зачем нужен отдельный Validate release handoff?</legend>
    <label><input type="radio" name="handoff" data-correct data-feedback="Отдельный job сверяет полученные данные до того, как управление перейдёт к job с правами на запись."> Чтобы проверить переданные данные до запуска job с правами на запись.</label>
    <label><input type="radio" name="handoff" data-feedback="Архив готовит check. Проверяющий job скачивает его и сверяет с переданными метаданными."> Чтобы заново собрать архив для публикации.</label>
    <label><input type="radio" name="handoff" data-feedback="Отчёт о проверке нужен как условие запуска. Правами на публикацию обладает следующий job."> Чтобы опубликовать GitHub Release до запуска job для PR.</label>
    <p class="quiz-feedback" data-feedback-output aria-live="polite"></p>
  </fieldset>
  <fieldset class="panel">
    <legend>3. Валидный архив опубликован, но запуск остановился до создания ветки и PR. Что произойдёт при следующем успешном запуске?</legend>
    <label><input type="radio" name="reuse" data-feedback="Сбой на этапе PR не отменяет уже выполненную публикацию. Watcher сохраняет опубликованные assets."> Старый архив удалят и сгенерируют новый.</label>
    <label><input type="radio" name="reuse" data-feedback="Публикация архива сама по себе не создаёт ветку или PR. При выполнении условий публикации watcher сможет создать Draft PR."> Workflow найдёт открытый PR от предыдущего запуска.</label>
    <label><input type="radio" name="reuse" data-correct data-feedback="Watcher проверит опубликованный архив и повторно использует его. В указанном сценарии предыдущий запуск ещё не создал ветку."> Watcher повторно использует опубликованный архив.</label>
    <p class="quiz-feedback" data-feedback-output aria-live="polite"></p>
  </fieldset>
  <p data-score aria-live="polite"></p>
  <button type="reset">Сбросить ответы</button>
</form>

<noscript><p>Для выбора ответов нужен JavaScript.</p>
<details><summary>Ответы для самостоятельной проверки</summary>
<ol>
<li>Draft PR подтверждает подготовку кандидата. Полная сборка и запуск проверяются вручную.</li>
<li>Validate release handoff проверяет полученные файлы перед передачей управления job с правами на запись.</li>
<li>При следующем успешном запуске watcher повторно использует уже опубликованный валидный архив.</li>
</ol>
</details></noscript>
