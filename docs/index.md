---
layout: handbook
title: "Zed Overlay — Under the Hood"
description: "Как редактор Zed становится пакетом Gentoo и какие проверки проходит обновление до того, как владелец оверлея решит его принять."
---

Gentoo — дистрибутив Linux, в котором систему сборки и установки пакетов
называют Portage. `zed-overlay` добавляет в неё рецепт сборки Zed для
нативной работы в Wayland, протоколе взаимодействия приложений с графической
средой.

<div class="chapter-card" markdown="1">
<p class="eyebrow">Глава 01</p>

## Как устроен Zed release watcher

Проследите путь от выхода Zed 1.28.1 до черновика pull request. Разберите,
как три задания обмениваются файлами, и попробуйте сценарии, в которых
автоматизация останавливается или использует уже опубликованный архив.

<a class="primary-link" href="{{ '/internals/01-release-watcher/' | relative_url }}">Читать главу <span aria-hidden="true">→</span></a>
</div>

<div class="chapter-card" markdown="1">
<p class="eyebrow">Глава 02 · Shell scripts</p>

## Bash — подготовка кандидата Zed

Разберите, как скрипт получает окружение от runner, переносит снимок Git
во временный каталог и проверяет результат подготовки. Проследите, куда
попадают вывод и ошибки конвейера с `tee`.

<a class="primary-link" href="{{ '/internals/02-shell-scripts/validate-release-candidate/' | relative_url }}">Читать главу <span aria-hidden="true">→</span></a>
</div>

Справочник рассчитан на читателя, который впервые открывает репозиторий.
Команды и условия для сопровождения релизов описаны отдельно в документе
[«CI и модель безопасности»](https://github.com/vovanbl411/zed-overlay/blob/main/docs/CI_AND_SECURITY.md).
