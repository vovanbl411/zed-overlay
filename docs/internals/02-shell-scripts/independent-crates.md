---
layout: handbook
title: Bash — подготовка crates и проверка исходников
description: От проверки исходников Zed и подготовки crates-архива до сверки локальных входов и обновления метаданных ebuild.
chapter: 2
eyebrow: Глава 02 / Shell scripts
permalink: /internals/02-shell-scripts/independent-crates/
shell_labs: true
scroll_page_nav: true
sections:
  - { id: parent, label: "4.1. От родительского скрипта к подготовке crates" }
  - { id: arguments, label: "4.2. Получаем и проверяем аргументы" }
  - { id: workspace, label: "4.3. Создаём рабочее окружение" }
  - { id: timing, label: "4.4. Функции summary и timed" }
  - { id: git-objects, label: "4.5. Git tag, commit и annotated tag" }
  - { id: remote-refs, label: "4.6. Получаем ссылки из upstream" }
  - { id: read-loop, label: "4.7. Читаем результат через while, read и case" }
  - { id: revision, label: "4.8. Выбираем точную upstream-ревизию" }
  - { id: checkout, label: "4.9. Создаём shallow checkout" }
  - { id: download, label: "4.10. Проверяем источник в ebuild и скачиваем архив" }
  - { id: tree-verification, label: "4.11. Сверяем архив с Git commit tree" }
  - { id: fingerprints, label: "4.12. Распаковываем исходники и фиксируем контрольные суммы" }
  - { id: archive-mode, label: "4.13. Определяем режим подготовки crates" }
  - { id: docker-architecture, label: "4.14. Docker image, container и volume" }
  - { id: prepare-portage, label: "4.15. Подготавливаем окружение Portage" }
  - { id: cleanup, label: "4.16. Управляем временем жизни контейнера через trap" }
  - { id: generator-venv, label: "4.17. Создаём изолированное окружение Python" }
  - { id: license-mapping, label: "4.18. Получаем лицензионное отображение Gentoo" }
  - { id: preparation-branch, label: "4.19. Выбираем ветку generation или reuse" }
  - { id: run-generator, label: "4.20. Как устроен запуск pycargoebuild" }
  - { id: generator-streams, label: "4.21. Объединяем stdout и stderr" }
  - { id: registry-inspection, label: "4.22. Проверяем содержимое crates-архива" }
  - { id: repacking-time, label: "4.23. Извлекаем время упаковки из журнала" }
  - { id: distribution-metadata, label: "4.24. Формируем distribution metadata" }
  - { id: reuse, label: "4.25. Переиспользуем опубликованный архив" }
  - { id: preparation-convergence, label: "4.26. Сравниваем результаты generation и reuse" }
  - { id: common-integrity, label: "4.27. Возвращаемся к общему пути проверки" }
  - { id: lock-integrity, label: "4.28. Повторно проверяем Cargo.lock" }
  - { id: source-reconstruction, label: "4.29. Восстанавливаем эталонное дерево исходников" }
  - { id: recursive-source-diff, label: "4.30. Сравниваем деревья через diff" }
  - { id: distribution-identity, label: "4.31. Проверяем identity архива и метаданных" }
  - { id: copy-git-distfiles, label: "4.32. Переносим Git archives в distfiles" }
  - { id: compare-git-crates, label: "4.33. Читаем и сравниваем GIT_CRATES" }
  - { id: validate-git-archives, label: "4.34. Проверяем Git archives и Cargo.toml" }
  - { id: replace-git-block, label: "4.35. Обновляем блок GIT_CRATES в кандидате" }
  - { id: curated-offline-substitutions, label: "4.36. Сохраняем offline substitutions и WebRTC pin" }
  - { id: license-term-differences, label: "4.37. Сравниваем лицензионные термины" }
  - { id: migrate-crates-uri, label: "4.38. Обновляем SRC_URI" }
  - { id: metadata-synchronization-flow, label: "4.39. Завершаем синхронизацию метаданных" }
  - { id: portage-candidate, label: "4.40. От подготовленного кандидата к Portage" }
  - { id: portage-manifest-copy, label: "4.41. Сохраняем исходный Manifest" }
  - { id: portage-donor, label: "4.42. Передаём том Portage во временный контейнер" }
  - { id: portage-bind-mounts, label: "4.43. Подключаем overlay и experiment через bind mounts" }
  - { id: portage-workdir, label: "4.44. Выбираем рабочий каталог внутри контейнера" }
  - { id: portage-env, label: "4.45. Передаём переменные через docker --env" }
  - { id: portage-candidate-paths, label: "4.46. Преобразуем пути кандидата" }
  - { id: portage-inner-bash, label: "4.47. Запускаем вложенный Bash" }
  - { id: portage-repos-conf, label: "4.48. Создаём repos.conf" }
  - { id: portage-keywords-use, label: "4.49. Настраиваем ACCEPT_KEYWORDS и USE" }
  - { id: portage-distdir, label: "4.50. Настраиваем и проверяем DISTDIR" }
  - { id: portage-log-timing, label: "4.51. Записываем журнал контейнера и результаты измерений" }
  - { id: portage-environment-check, label: "4.52. Проверяем готовность контейнерного окружения" }
---

{% assign revision = '38531d4e4cfe0506f0f5f6b551c60897b6bea83c' %}
{% assign script = 'scripts/ci/independent-crates.sh' %}
{% assign parent = 'scripts/ci/validate-release-candidate.sh' %}
{% assign verifier = 'scripts/verify_zed_source.py' %}
{% assign previous = '/internals/02-shell-scripts/validate-release-candidate/' | relative_url %}
{% capture call %}    "$disposable_workspace/scripts/ci/independent-crates.sh" \
      "$candidate_version" "$disposable_workspace/$candidate_ebuild" \
      "$disposable_workspace/$candidate_patch" "$disposable_workspace"{% endcapture %}
{% capture receiving %}version="${1:?candidate version required}"
candidate="${2:?candidate ebuild required}"
patch="${3:?candidate patch required}"
overlay="${4:?disposable overlay required}"{% endcapture %}
{% capture startup %}#!/usr/bin/env bash
# Generate or reuse validated crates in the read-only check job.
set -euo pipefail

version="${1:?candidate version required}"
candidate="${2:?candidate ebuild required}"
patch="${3:?candidate patch required}"
overlay="${4:?disposable overlay required}"
work="${RUNNER_TEMP:?}/zed-independent"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]{% endcapture %}
{% capture paths %}work="${RUNNER_TEMP:?}/zed-independent"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
mkdir "$work"
mkdir "$work/dist" "$work/cache" "$work/logs"
tag="v${version}"
repo=https://github.com/zed-industries/zed.git
checkout="$work/checkout"
source_dir="$work/source/zed-${version}"
archive="$work/dist/zed-${version}-overlay-crates.tar.xz"
source_archive="$work/dist/zed-${version}.tar.gz"
metadata="$work/dist/zed-${version}-overlay-crates.json"
start_total=$SECONDS{% endcapture %}
{% capture wrappers %}summary() { printf '%s\n' "$*" | tee -a "$GITHUB_STEP_SUMMARY"; }
timed() { local label="$1"; shift; local started=$SECONDS; "$@"; summary "$label: $((SECONDS - started))s"; }{% endcapture %}
{% capture entry %}summary '## Independent crates preparation'
timed 'Upstream source acquisition' acquire_source{% endcapture %}
{% capture lookup %}resolve_tag() {
  local refs ref object direct= peeled=
  refs="$(env -u GITHUB_TOKEN git ls-remote "$repo" "refs/tags/$tag" "refs/tags/$tag^{}")"{% endcapture %}
{% capture reading %}  while read -r object ref; do
    case "$ref" in
      "refs/tags/$tag") direct="$object" ;;
      "refs/tags/$tag^{}") peeled="$object" ;;
      *) echo "Unexpected upstream tag reference" >&2; return 1 ;;
    esac
  done <<< "$refs"{% endcapture %}
{% capture selection %}  [[ "$direct" =~ ^[0-9a-f]{40}$ ]]
  [[ -z "$peeled" || "$peeled" =~ ^[0-9a-f]{40}$ ]]
  printf '%s\n' "${peeled:-$direct}"
}{% endcapture %}
{% capture clone %}acquire_source() {
  upstream_commit="$(resolve_tag)"
  env -u GITHUB_TOKEN git clone --quiet --depth=1 --single-branch --no-tags --branch "$tag" "$repo" "$checkout"
  test "$(git -C "$checkout" rev-parse HEAD)" = "$upstream_commit"{% endcapture %}
{% capture source_check %}  test "$(grep -Fc 'https://github.com/zed-industries/zed/archive/refs/tags/v${PV/_/-}.tar.gz -> ${P}.tar.gz' "$candidate")" = 1{% endcapture %}
{% capture download %}  env -u GITHUB_TOKEN curl -fsSL --retry 3 \
    "https://github.com/zed-industries/zed/archive/refs/tags/${tag}.tar.gz" \
    -o "$source_archive"
  test "$(resolve_tag)" = "$upstream_commit"{% endcapture %}
{% capture verify %}  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/verify_zed_source.py" \
    --archive "$source_archive" --checkout "$checkout" --commit "$upstream_commit" \
    --root "zed-${version}"{% endcapture %}
{% capture extract %}  mkdir "$work/source"
  tar -xzf "$source_archive" -C "$work/source"
  lock_hash="$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)"
  source_hash="$(sha256sum "$source_archive" | cut -d' ' -f1)"
  summary "Upstream tag: $tag; commit: $upstream_commit; source archive SHA256: $source_hash; Cargo.lock SHA256: $lock_hash"
}{% endcapture %}
{% capture git_tree %}def git_tree(checkout: Path, commit: str) -> dict[str, tuple[str, str]]:
    result = subprocess.run(
        ['git', '-C', str(checkout), 'ls-tree', '-r', '-z', '--full-tree', commit],
        check=True, stdout=subprocess.PIPE,
    )
    entries: dict[str, tuple[str, str]] = {}
    for item in result.stdout.split(b'\0'):
        if not item:
            continue
        metadata, name = item.split(b'\t', 1)
        mode, kind, object_id = metadata.decode('ascii').split(' ')
        path = name.decode('utf-8')
        if kind != 'blob' or mode not in ('100644', '100755', '120000'):
            raise SourceVerificationError(f'Unsupported Git tree entry: {path!r}')
        if path in entries:
            raise SourceVerificationError(f'Duplicate Git tree entry: {path!r}')
        entries[path] = (mode, object_id)
    if not entries:
        raise SourceVerificationError('Git commit tree is empty')
    return entries{% endcapture %}
{% capture blob_hash %}def blob_hash(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest(){% endcapture %}
{% capture tree_checks %}def verify_archive(archive: Path, root: str, expected: dict[str, tuple[str, str]]) -> None:
    seen: set[str] = set()
    directories: set[str] = {root}
    for path in expected:
        parent = PurePosixPath(root, path).parent
        while str(parent) != '.':
            directories.add(str(parent))
            parent = parent.parent
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            name = member.name.rstrip('/')
            parts = name.split('/')
            if (not name or name in seen or parts[0] != root or
                    any(part in ('', '.', '..') for part in parts)):
                raise SourceVerificationError(f'Unsafe or duplicate archive member: {member.name!r}')
            seen.add(name)
            if member.isdir():
                if name not in directories:
                    raise SourceVerificationError(f'Unexpected archive directory: {name!r}')
                continue
            if len(parts) < 2:
                raise SourceVerificationError(f'Unexpected archive member: {name!r}')
            path = '/'.join(parts[1:])
            if path not in expected:
                raise SourceVerificationError(f'Unexpected archive path: {path!r}')
            mode, object_id = expected[path]
            if mode == '120000' and member.issym():
                data = member.linkname.encode('utf-8')
            elif mode in ('100644', '100755') and member.isfile():
                if bool(member.mode & 0o111) != (mode == '100755'):
                    raise SourceVerificationError(f'Executable mode differs: {path!r}')
                f = tar.extractfile(member)
                if f is None:
                    raise SourceVerificationError(f'Cannot read archive member: {path!r}')
                hasher = hashlib.sha1(b'blob ' + str(member.size).encode('ascii') + b'\0')
                for chunk in iter(lambda: f.read(1024 * 1024), b''):
                    hasher.update(chunk)
                if hasher.hexdigest() != object_id:
                    raise SourceVerificationError(f'Git blob differs: {path!r}')
                continue
            else:
                raise SourceVerificationError(f'File type differs: {path!r}')
            if blob_hash(data) != object_id:
                raise SourceVerificationError(f'Git blob differs: {path!r}')
    missing = set(expected) - {name[len(root) + 1:] for name in seen if name.startswith(root + '/')}
    if missing:
        raise SourceVerificationError(f'Archive is missing Git paths: {sorted(missing)[:5]!r}'){% endcapture %}
{% capture verifier_cli %}def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    try:
        verify_archive(args.archive, args.root, git_tree(args.checkout, args.commit))
    except (OSError, UnicodeError, ValueError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f'Source archive verification failed: {error}', file=sys.stderr)
        return 1
    print('Source archive matches the upstream Git commit tree: OK')
    return 0{% endcapture %}

## 4.1. От родительского скрипта к подготовке crates {#parent}

{% include source-preview.html source=call label="Вызов из родительского Bash · строки 144–146" path=parent revision=revision start=144 open=true %}
{% capture previews %}
{% include source-preview.html source=call label="Вызов из родительского Bash · строки 144–146" path=parent revision=revision start=144 open=true %}
{% include source-preview.html source=receiving label="Приём четырёх аргументов · строки 5–8" path=script revision=revision start=5 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="transfer" previews=previews %}

Родитель запускает файл из временной копии оверлея в отдельном процессе
Bash. Он передаёт четыре значения в том же порядке, что и в
[разборе вызова]({{ previous }}#independent-crates). Кавычки сохраняют
границы каждого аргумента, даже если в пути есть пробелы.

Задание `check` работает с правами чтения. Скрипт готовит локальные
файлы во временных каталогах. Публикация GitHub Release и создание PR
относятся к отдельному заданию.

<figure class="figure acquisition-flow">
  <figcaption>Путь от вызова до возвращения результата</figcaption>
  <ol class="shell-gates">
    <li class="flow-node">Родительский Bash → <code>independent-crates.sh</code></li>
    <li class="flow-node">Получение исходников → генерация или повторное использование crates</li>
    <li class="flow-node">Синхронизация метаданных → проверка в контейнере</li>
    <li class="flow-node">Локальный distribution bundle → <code>result.txt</code> → родительский Bash</li>
  </ol>
</figure>

У родителя есть функция [`main`]({{ previous }}#main). Здесь Bash сразу
проверяет аргументы и создаёт рабочие каталоги, затем объявляет функции
и выполняет последовательность команд на верхнем уровне. К строке 150
обработчик `trap cleanup EXIT` уже установлен в строке 72.

| Функции | Где участвуют |
| --- | --- |
| `summary`, `timed` | Записывают сообщения и длительность этапов. |
| `resolve_tag`, `acquire_source` | Получают ревизию тега, скачивают и сверяют исходники. |
| `prepare_portage`, `prepare_generator`, `cleanup` | Готовят окружение Portage и генератора. `cleanup` убирает контейнер при выходе. |
| `generate`, `reuse` | Создают crates-архив или получают готовый. |
| `verify_inputs`, `sync_metadata`, `validate_candidate` | Перепроверяют входы, обновляют данные в ebuild и проверяют кандидата в контейнере. |

После проверки скрипт копирует crates-архив и JSON в локальный
distribution bundle, записывает режим в `$work/logs/result.txt` и
выводит общее время. [Родитель читает результат]({{ previous }}#archive-mode-transfer).

## 4.2. Получаем и проверяем аргументы {#arguments}

{% capture previews %}
{% include source-preview.html source=startup label="Запуск и проверки аргументов · строки 1–10" path=script revision=revision start=1 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="arguments" previews=previews %}

[Shebang и `set -euo pipefail`]({{ previous }}#startup) работают здесь
так же, как у родителя. Раскрытие [`${параметр:?сообщение}`]({{ previous }}#environment)
требует непустое значение. Если позиционного параметра нет или он пуст,
Bash выводит указанное сообщение и завершает скрипт. Первые четыре
проверки идут в порядке аргументов. `RUNNER_TEMP` приходит отдельно,
через окружение процесса. В `${RUNNER_TEMP:?}` нет своего текста ошибки,
поэтому Bash подставляет стандартное сообщение.

Присваивания идут на верхнем уровне скрипта. Эти переменные доступны
его функциям. Первые проверки путей устанавливают только наличие
непустой строки. Файл может отсутствовать, быть недоступным или
содержать данные, которые скрипт не ожидает.

В `[[ … =~ … ]]` Bash сопоставляет строку с регулярным выражением.
Якоря `^` и `$` ограничивают всю строку, `[0-9]+` требует одну или
несколько цифр, а `\.` означает буквальную точку. Получаются три группы
цифр, как в учебной версии `1.29.0`. Проверка касается только формата.
Наличие выпуска в upstream и допустимость других версий Gentoo
определяются отдельно. Статус 1 этой команды останавливает скрипт до
первого `mkdir`.

## 4.3. Создаём рабочее окружение {#workspace}

{% capture previews %}
{% include source-preview.html source=paths label="Инициализация рабочей среды · строки 9–20" path=script revision=revision start=9 open=true %}
{% include source-preview.html source=clone label="Выбор коммита, clone и сверка HEAD · строки 39–42" path=script revision=revision start=39 %}
{% include source-preview.html source=download label="Скачивание и второй запрос тега · строки 44–47" path=script revision=revision start=44 %}
{% include source-preview.html source=extract label="Распаковка и SHA-256 · строки 51–56" path=script revision=revision start=51 %}
{% endcapture %}
{% include acquisition-lab.html lab="workspace" previews=previews %}

`work` указывает на `$RUNNER_TEMP/zed-independent`. Копия оверлея
`$RUNNER_TEMP/zed-overlay` уже содержит ebuild, patch и скрипты. Новый
каталог хранит Git checkout Zed, исходники, distfiles, кэш и журналы.
Модель показывает эти два соседних каталога в `RUNNER_TEMP`.

Первый `mkdir` создаёт `work`, второй создаёт в нём `dist`, `cache`
и `logs`. Здесь намеренно нет `-p`. Если `work` уже существует,
обычный `mkdir` завершается с ошибкой. Это проверка конкретного шага
инициализации. Она сама по себе не гарантирует свежесть или
безопасность всей файловой среды.

`tag="v${version}"` добавляет к версии префикс Git-тега. В
`"$work/source/zed-${version}"` Bash соединяет каталог, буквальный текст
и значение версии. Строки 15–19 пока только задают пути. Исходный
`zed-1.29.0.tar.gz` приходит из upstream. Crates-архив
`zed-1.29.0-overlay-crates.tar.xz` и сопровождающий JSON появляются
позже при генерации или повторном использовании. `start_total` хранит
показание счётчика `SECONDS` для общего времени.

## 4.4. Функции summary и timed {#timing}

{% capture previews %}
{% include source-preview.html source=wrappers label="Обёртки summary и timed · строки 21–22" path=script revision=revision start=21 trailing_blank=true open=true %}
{% include source-preview.html source=entry label="Начальные команды · строки 150–151" path=script revision=revision start=150 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="timing" previews=previews %}

Синтаксис `имя() { …; }` позволяет записать функцию в одну строку.
Точки с запятой разделяют команды. Bash выполняет их по порядку.
В `summary` при обычном `IFS` выражение `"$*"` соединяет позиционные
параметры пробелами в один аргумент для `printf`. `tee -a` сохраняет
вывод в журнале шага и дописывает его в файл `GITHUB_STEP_SUMMARY`.
Пример с этим конвейером есть в [разборе потоков]({{ previous }}#streams).

`timed` сохраняет `$1` в локальную `label`. После `shift` первый
параметр исчезает, а прежний `$2` становится `$1`. Затем функция
запоминает `SECONDS` в `started`. В позиции команды `"$@"` раскрывает
каждый оставшийся параметр отдельно. Первое слово задаёт имя команды,
остальные становятся её аргументами. Bash может так вызвать другую
функцию, как здесь с `acquire_source`. Содержимое аргументов остаётся
данными и повторно как код оболочки не разбирается.

После успеха `$((SECONDS - started))` даёт длительность этапа в
секундах. Строка 150 пишет заголовок, а строка 151 запускает получение
исходников с замером времени. При обычном вызове на строке 151
ошибка обёрнутой команды останавливает выполнение под `errexit` до
строки с длительностью. См. [замер времени у родителя]({{ previous }}#completion-duration).

## 4.5. Git tag, commit и annotated tag {#git-objects}

{% capture previews %}
{% include source-preview.html source=lookup label="Запрос двух ссылок · строки 24–26" path=script revision=revision start=24 %}
{% include source-preview.html source=reading label="Разбор записей · строки 27–33" path=script revision=revision start=27 %}
{% endcapture %}
{% include acquisition-lab.html lab="git" previews=previews %}

Commit связывает состояние дерева файлов с метаданными коммита и его
родителями. Git-ссылка хранит идентификатор объекта под именем, например
`refs/tags/v1.29.0`. Lightweight tag в нашем примере указывает сразу на
commit. У annotated tag ссылка указывает на отдельный объект тега с
метаданными, сообщением и ссылкой на следующий объект. Поэтому ID
объекта тега может отличаться от ID коммита, с которым сравнивают `HEAD`.

Суффикс `^{}` обозначает разыменование объектов тегов до первого
объекта другого типа. В примере это commit, но Git умеет помечать и
другие объекты. Peeling показывает, куда ведёт тег. Проверка
криптографической подписи была бы отдельной операцией.

## 4.6. Получаем ссылки из upstream {#remote-refs}

{% capture previews %}
{% include source-preview.html source=lookup label="Запрос двух ссылок · строки 24–26" path=script revision=revision start=24 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="remote" previews=previews %}

`local` объявляет несколько переменных функции одной командой.
`direct=` и `peeled=` начинают с пустых строк. `env -u GITHUB_TOKEN`
убирает эту переменную из окружения запускаемого Git. Остальные
механизмы аутентификации Git, включая настройки и credential helpers,
могут по-прежнему действовать.

`git ls-remote` читает доступные ссылки по адресу из `repo`, не
создавая локальный checkout и не скачивая историю. Два шаблона
запрашивают `refs/tags/v1.29.0` и `refs/tags/v1.29.0^{}`. Для обычного
annotated tag первый результат содержит ID объекта тега, второй
содержит ID его разыменованной цели. Каждая запись состоит из ID,
табуляции и имени ссылки. Подстановка `$(…)` захватывает stdout в
`refs` и убирает завершающие переводы строк. Подпись тега эта команда
не проверяет.

## 4.7. Читаем результат через while, read и case {#read-loop}

{% capture previews %}
{% include source-preview.html source=reading label="Разбор записей · строки 27–33" path=script revision=revision start=27 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="read" previews=previews %}

`while` повторяет тело, пока команда `read -r object ref` возвращает
ноль. `read` читает одну строку из stdin и распределяет поля по
переменным с учётом `IFS`. При обычном `IFS` табуляция разделяет
`object` и `ref`. Опция `-r` сохраняет обратные косые черты
буквально. При достижении конца ввода следующая попытка чтения
возвращает ненулевой статус и цикл завершается.

`case` сопоставляет `ref` с шаблонами ветвей. Кавычки вокруг двух
ожидаемых имён задают буквальные значения после раскрытия `$tag`.
Соответствующая ветвь запоминает ID в `direct` или `peeled`.
`;;` завершает ветвь. Шаблон `*` ловит всё остальное. Он пишет
сообщение в stderr через `>&2` и сразу выходит из функции с
`return 1`.

```bash
command < file
command < <(producer)
command <<< "$value"
```

В первом случае stdin открывается из файла. Во втором Bash подаёт
вывод команды через [process substitution]({{ previous }}#process-substitution).
Here-string передаёт раскрытую строку и добавляет перевод строки.
Даже при пустой `refs` встроенная команда Bash `read` успешно
читает одну пустую строку. Оба поля пусты, поэтому `case` попадает
в `*` и выполняет `return 1` ещё до проверок формата ID.

## 4.8. Выбираем точную upstream-ревизию {#revision}

{% capture previews %}
{% include source-preview.html source=reading label="Разбор записей · строки 27–33" path=script revision=revision start=27 open=true %}
{% include source-preview.html source=selection label="Формат и выбор ID · строки 34–37" path=script revision=revision start=34 trailing_blank=true open=true %}
{% include source-preview.html source=clone label="Выбор коммита, clone и сверка HEAD · строки 39–42" path=script revision=revision start=39 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="resolve" previews=previews %}

Регулярное выражение `^[0-9a-f]{40}$` описывает ровно 40
шестнадцатеричных символов в нижнем регистре. Для `direct` это
ожидаемый формат, а `peeled` разрешено оставить пустой. В строке 35
`||` вычисляет правую часть только если `-z "$peeled"` ложно.
Затем [раскрытие с запасным значением]({{ previous }}#mode)
`${peeled:-$direct}` отдаёт непустую `peeled` либо `direct`.
`printf` пишет выбранный ID в stdout. Строка 40 захватывает его в
`upstream_commit`.

### Статус внутри подстановки команды

В обычном Bash вне режима POSIX опция `inherit_errexit` выключена
по умолчанию. Bash снимает `-e` в подстановке `$(…)`. Поэтому
провал обычной команды с regex в `resolve_tag` может смениться
успешным `printf`. Итоговый статус функции и присваивания тогда
равен нулю, хотя регулярное выражение вернуло 1.

Попробуйте этот отдельный учебный пример в чистом Bash. Смена
`shopt -u` на `shopt -s` включает наследование `-e`.

```bash
bash --noprofile --norc -c '
  set +o posix
  shopt -u inherit_errexit
  set -e
  pick() {
    local direct=broken
    [[ "$direct" =~ ^[0-9a-f]{40}$ ]]
    printf "%s\n" "$direct"
  }
  value="$(pick)"
  printf "captured=%s\n" "$value"
'
```

С выключенной опцией Bash выводит `captured=broken` и возвращает 0.
С включённой опцией выполнение заканчивается со статусом 1 в
присваивании. Если вместо проверки функция выполняет явный
`return 1`, она не доходит до `printf` в обоих режимах. Присваивание
с одной подстановкой получает её статус и в строке 40 подчиняется
`errexit`.

В строке 47 вызов устроен иначе. В
`test "$(resolve_tag)" = "$upstream_commit"` оболочка подставляет
вывод как аргумент. Статус всей команды задаёт само сравнение
`test`. В частности, `return 1` без stdout даёт пустую строку
для сравнения. Первая и вторая проверки ревизии и сверка дерева
дальше работают как отдельные условия. Из них нельзя вывести, что
дефектная запись любого вида всегда будет отвергнута именно при
чтении тега.

## 4.9. Создаём shallow checkout {#checkout}

{% capture previews %}
{% include source-preview.html source=clone label="Выбор коммита, clone и сверка HEAD · строки 39–42" path=script revision=revision start=39 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="checkout" previews=previews %}

| Опция | Действие в этом вызове |
| --- | --- |
| `--quiet` | Убирает обычные сообщения о ходе клонирования. |
| `--depth=1` | Ограничивает историю одним коммитом от выбранной вершины. |
| `--single-branch` | Получает историю только для выбранной вершины. |
| `--no-tags` | Отключает обычное получение тегов. Явный выбор тега остаётся доступным. |
| `--branch "$tag"` | Выбирает именованный тег. В checkout по тегу `HEAD` указывает прямо на commit и оказывается в состоянии detached HEAD. |

Для сверки архива нужен Git tree выбранного коммита. Полная история
репозитория для этого шага не требуется. После клонирования
`git -C "$checkout" rev-parse HEAD` читает фактический ID, а `test`
сравнивает его с первым `upstream_commit`. Между запросом и clone
ссылка может измениться. При несовпадении уже созданный checkout
остаётся на диске, а до проверки ebuild выполнение не доходит.

## 4.10. Проверяем источник в ebuild и скачиваем архив {#download}

{% capture previews %}
{% include source-preview.html source=source_check label="Литеральная строка из ebuild · строка 43" path=script revision=revision start=43 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="grep" previews=previews %}
{% include source-preview.html source=download label="Скачивание и второй запрос тега · строки 44–47" path=script revision=revision start=44 open=true %}

Одинарные кавычки сохраняют `${PV/_/-}` и `${P}` буквально,
потому что `grep` ищет текст рецепта Portage. `-F` ищет фиксированную
строку, `-c` считает совпавшие **строки**, а `test` сравнивает
результат со строкой `1`. Два вхождения на одной строке дают 1.
Это проверка текста. Она не разбирает синтаксис ebuild и не вычисляет
значение `SRC_URI`. Разбор [частей команды `grep`]({{ previous }}#candidate-ebuild)
показывает, как читать её параметры.

В `curl -fsSL` опция `-f` даёт ошибку при HTTP-ошибке,
`-s` убирает индикатор прогресса и обычные сообщения, `-S`
оставляет сообщения об ошибках при `-s`, а `-L` следует HTTP-редиректам.
`--retry 3` разрешает до трёх повторов при подходящих для curl
ошибках. `-o` задаёт файл для ответа.

Для учебной версии запрос идёт к
`https://github.com/zed-industries/zed/archive/refs/tags/v1.29.0.tar.gz`,
в `$work/dist/zed-1.29.0.tar.gz`. После загрузки второй запрос
`resolve_tag` проверяет, совпадает ли текущий ID с сохранённым.
Загрузка может завершиться успешно при последующем несовпадении тега.
Если тег успел сместиться и вернуться между двумя запросами,
сравнение может этого не заметить. Следующий шаг отдельно проверяет
содержимое скачанного файла.

{% capture previews %}
{% include source-preview.html source=clone label="Выбор коммита, clone и сверка HEAD · строки 39–42" path=script revision=revision start=39 %}
{% include source-preview.html source=source_check label="Литеральная строка из ebuild · строка 43" path=script revision=revision start=43 %}
{% include source-preview.html source=download label="Скачивание и второй запрос тега · строки 44–47" path=script revision=revision start=44 %}
{% include source-preview.html source=verify label="Передача входов валидатору · строки 48–50" path=script revision=revision start=48 %}
{% include source-preview.html source=extract label="Распаковка и SHA-256 · строки 51–56" path=script revision=revision start=51 %}
{% include source-preview.html source=wrappers label="Обёртки summary и timed · строки 21–22" path=script revision=revision start=21 trailing_blank=true %}
{% endcapture %}
{% include acquisition-lab.html lab="timeline" previews=previews %}

## 4.11. Сверяем архив с Git commit tree {#tree-verification}

{% include source-preview.html source=verify label="Передача входов валидатору · строки 48–50" path=script revision=revision start=48 open=true %}

<figure class="figure acquisition-flow">
  <figcaption>Четыре входа в <code>verify_zed_source.py</code></figcaption>
  <ul class="acq-inputs">
    <li><code>--archive "$source_archive"</code><small>Файл после curl</small></li>
    <li><code>--checkout "$checkout"</code><small>Локальный Git checkout</small></li>
    <li><code>--commit "$upstream_commit"</code><small>ID из первого запроса</small></li>
    <li><code>--root "zed-${version}"</code><small>Ожидаемый корень архива</small></li>
  </ul>
  <div class="acq-converge" aria-hidden="true">↓</div>
  <div class="flow-node acq-verifier"><code>verify_zed_source.py</code></div>
</figure>

`PYTHONDONTWRITEBYTECODE=1` действует для запуска Python и отключает
запись файлов байткода. CLI читает дерево указанного коммита командой
`git ls-tree -r -z --full-tree`. Опции обходят дерево рекурсивно,
разделяют записи нулевым байтом и выводят пути относительно корня
дерева. Валидатор ожидает Git blobs с режимами `100644`, `100755` или
`120000`. Пустое дерево, неподдерживаемый тип или режим и повторный
путь в дереве дают ошибку.

{% include source-preview.html source=git_tree label="Чтение Git tree · строки 16–35" path=verifier revision=revision start=16 %}
{% include source-preview.html source=blob_hash label="Хеш Git blob · строки 38–39" path=verifier revision=revision start=38 %}

При чтении tar валидатор сверяет первый компонент имени с ожидаемым
корнем. Он отвергает пустые имена, пустые компоненты внутри пути,
`.`, `..` и повторы имён после удаления конечных косых черт.
Явные записи каталогов допустимы для корня и родителей ожидаемых
файлов. Наличие каждой отдельной записи каталога не требуется.
Файлы должны иметь ожидаемый относительный путь и тип.

Для обычного файла достаточно совпадения признака наличия хотя бы
одного бита из `0o111` с режимом Git `100755`. Остальные биты прав,
владелец, время и прочие tar-метаданные в этой проверке не сравниваются.
Для ссылки с режимом `120000` валидатор хеширует строку цели из
`linkname`. Совпадение цели с Git ничего отдельно не говорит о
безопасности её разрешения при произвольной распаковке.

{% capture previews %}
{% include source-preview.html source=tree_checks label="Сверка записей архива · строки 42–88" path=verifier revision=revision start=42 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="tree" previews=previews %}

Git blob ID здесь вычисляется как SHA-1 от заголовка
`blob <длина в байтах>\0` и данных. Для файла данные — его байты,
для символической ссылки — её цель в UTF-8. После обхода архива
валидатор проверяет, что встретились все ожидаемые Git-пути.
CLI печатает сообщение об успехе либо пишет первую диагностику
в stderr и возвращает 1.

{% include source-preview.html source=verifier_cli label="Аргументы и результат CLI · строки 91–104" path=verifier revision=revision start=91 %}

Успех означает, что архив и выбранный Git tree совпадают по
проверенным свойствам. Подпись, независимое подтверждение
подлинности upstream и общая безопасность произвольного tar-архива
лежат за их пределами. SHA-256 сжатого файла далее вычисляется по
другому набору байтов.

## 4.12. Распаковываем исходники и фиксируем контрольные суммы {#fingerprints}

{% include source-preview.html source=extract label="Распаковка и SHA-256 · строки 51–56" path=script revision=revision start=51 open=true %}

Только после успеха Python Bash создаёт `$work/source`. В
`tar -xzf … -C …` опция `-x` извлекает файлы, `-z` включает
gzip, `-f` берёт архив из заданного файла, а `-C` задаёт каталог
извлечения. Корень архива `zed-1.29.0/` даёт заранее вычисленный
`$source_dir`.

Первая команда `sha256sum` читает извлечённый `Cargo.lock`, вторая
читает сам сжатый архив. В обеих командах `cut -d' ' -f1` забирает
первое поле до пробела. Этот конвейер уже разобран в разделе
о [SHA-256 метаданных]({{ previous }}#metadata-checksum).

{% capture previews %}
{% include source-preview.html source=extract label="Распаковка и SHA-256 · строки 51–56" path=script revision=revision start=51 open=true %}
{% endcapture %}
{% include acquisition-lab.html lab="fingerprints" previews=previews %}

Это локально рассчитанные отпечатки. Их используют, чтобы позднее
обнаружить расхождение при повторном использовании и перепроверке
входов. Внешние ожидаемые SHA-256 и подписи на этом шаге не
загружаются. Значения в модели вымышлены.

<figure class="figure acquisition-flow">
  <figcaption>Где заканчивается получение исходников</figcaption>
  <ol class="shell-gates">
    <li class="flow-node">Запрос тега → clone → сверка <code>HEAD</code></li>
    <li class="flow-node">Проверка ebuild → загрузка → повторный запрос и сверка тега</li>
    <li class="flow-node">Сверка архива с Git tree → распаковка → два SHA-256</li>
    <li class="flow-node">Запись отпечатков → замер длительности в <code>timed</code></li>
  </ol>
</figure>

В [шкале получения исходников](#acquisition-timeline) видно, где
прерывается этот путь. Например, после расхождения `HEAD` остаётся
checkout. После отказа валидатора остаются checkout и скачанный
архив, а каталог распаковки ещё не создан. Уже выполненные файловые
операции не откатываются автоматически.

Теперь у скрипта есть проверенное дерево исходников и два отпечатка.
Прежде чем готовить crates, он узнаёт, есть ли у оверлея опубликованный архив для этой версии.

## 4.13. Определяем режим подготовки crates {#archive-mode}

{% capture crates_previews %}
{% capture crates_source_1 %}{% raw %}mode="$(PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" lookup --version "$version")"
summary "Result: $mode"
timed 'Portage environment preparation' prepare_portage{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_1 label="Выбор режима и подготовка Portage · строки 152–154" path="scripts/ci/independent-crates.sh" revision=revision start=152 open=true %}
{% capture crates_source_2 %}{% raw %}def release_tag(version: str) -> str:
    distribution.names(version)
    return f'crates-v{version}'


def expected_assets(release: object, version: str, *, draft: bool = False) -> dict[str, dict]:
    if (not isinstance(release, dict) or release.get('tag_name') != release_tag(version) or
            release.get('draft') is not draft or release.get('prerelease') is not False or
            type(release.get('id')) is not int or release['id'] <= 0 or
            (not draft and not isinstance(release.get('published_at'), str)) or
            (draft and release.get('published_at') is not None) or
            not isinstance(release.get('assets'), list)):
        raise GitHubError('Invalid release identity or state')
    names = set(distribution.names(version))
    assets = release['assets']
    if (len(assets) != len(names) or
            any(not isinstance(a, dict) or not isinstance(a.get('name'), str) for a in assets)):
        raise GitHubError('Release assets are incomplete or unexpected')
    if {a.get('name') for a in assets} != names:
        raise GitHubError('Release asset names are incomplete or unexpected')
    for asset in assets:
        if (type(asset.get('id')) is not int or asset['id'] <= 0 or
                type(asset.get('size')) is not int or asset['size'] <= 0 or
                asset.get('state') != 'uploaded'):
            raise GitHubError('Invalid release asset metadata')
    if len({a['id'] for a in assets}) != len(assets):
        raise GitHubError('Duplicate release asset IDs')
    return {a['name']: a for a in assets}{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_2 label="Тег релиза и проверка assets · строки 95–122" path="scripts/crates_github.py" revision=revision start=95 %}
{% capture crates_source_3 %}{% raw %}def require_published_tag(client: Client, version: str) -> None:
    tag = release_tag(version)
    status, reference = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
    obj = reference.get('object') if isinstance(reference, dict) else None
    if (status != 200 or not isinstance(reference, dict) or reference.get('ref') != f'refs/tags/{tag}' or
            not isinstance(obj, dict) or obj.get('type') not in ('tag', 'commit') or
            not isinstance(obj.get('sha'), str) or not distribution.SHA1.fullmatch(obj['sha'])):
        raise GitHubError('Published release has no valid matching Git tag')


def lookup(client: Client, version: str) -> tuple[str, dict | None]:
    tag = release_tag(version)
    status, release = client.api(f'/repos/{REPOSITORY}/releases/tags/{tag}')
    if status == 200:
        expected_assets(release, version)
        require_published_tag(client, version)
        return 'reuse', release
    if status != 404:
        raise GitHubError(f'Unexpected release lookup status: {status}')
    status, repo = client.api(f'/repos/{REPOSITORY}')
    if (status != 200 or not isinstance(repo, dict) or not isinstance(repo.get('full_name'), str) or
            repo['full_name'].lower() != REPOSITORY):
        raise GitHubError('Cannot confirm access to the expected repository')
    status, _ = client.api(f'/repos/{REPOSITORY}/git/ref/tags/{tag}')
    if status == 200:
        raise GitHubError('A standalone or unpublished tag already exists')
    if status != 404:
        raise GitHubError(f'Cannot determine tag state: HTTP {status}')
    # Read-only tokens cannot list all drafts; the write job checks them before mutation.
    return 'generation', None{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_3 label="Поиск релиза и проверка Git ref · строки 125–154" path="scripts/crates_github.py" revision=revision start=125 %}
{% capture crates_source_4 %}{% raw %}def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    lookup_parser = sub.add_parser('lookup')
    lookup_parser.add_argument('--version', required=True)
    reuse = sub.add_parser('reuse')
    for name in ('version', 'commit', 'source-archive', 'source', 'archive', 'metadata', 'cache', 'generated'):
        reuse.add_argument('--' + name, required=True)
    publisher = sub.add_parser('publish')
    for name in ('version', 'base-commit', 'base-manifest', 'bundle', 'handoff', 'expected-mode', 'metadata-sha256'):
        publisher.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        client = Client(os.environ.get('GITHUB_TOKEN', ''))
        if args.action == 'lookup':
            print(lookup(client, args.version)[0])
        elif args.action == 'reuse':
            prepare_reuse(client, args.version, args.commit, Path(args.source_archive), Path(args.source),
                          Path(args.archive), Path(args.metadata), Path(args.cache), Path(args.generated)){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_4 label="Аргументы CLI и вывод режима · строки 307–325" path="scripts/crates_github.py" revision=revision start=307 %}
{% capture crates_source_5 %}{% raw %}    except (GitHubError, OSError, ValueError, KeyError, distribution.snapshot.CargoSnapshotError,
            distribution.release_handoff.HandoffError) as error:
        print(f'Crates release error: {error}', file=sys.stderr)
        return 1
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_5 label="Сообщение об ошибке и код возврата · строки 341–345" path="scripts/crates_github.py" revision=revision start=341 %}
{% endcapture %}

В строке 152 Bash подставляет stdout Python через `$(…)`, убирает завершающий перевод строки и сохраняет результат в `mode`. Префикс `PYTHONDONTWRITEBYTECODE=1` действует на этот процесс Python и отключает запись файлов байткода. `lookup` выбирает подкоманду, а именованный аргумент `--version` передаёт ей значение `version`. Как и при [выборе upstream-ревизии](#revision), отдельное присваивание получает статус подстановки. При ошибке `set -e` останавливает скрипт до строки 153. При успехе [`summary`](#timing) пишет режим в консоль и сводку. Затем `timed` вызывает `prepare_portage` и добавляет длительность в сводку.

В учебном примере `v1.29.0` — тег исходников в репозитории Zed, а `crates-v1.29.0` — тег релиза с двумя assets в репозитории оверлея. Версия условная. `lookup` проверяет состояние релиза, имена и метаданные assets и форму совпадающей Git-ссылки. Допустимы ссылки на commit и annotated tag с корректным SHA. Сопоставления с базовым коммитом запуска workflow здесь нет. Проверка байтов assets происходит в [ветке reuse](#reuse).

Когда релиз и тег отсутствуют и доступ к ожидаемому репозиторию подтверждён, скрипт выбирает `generation`. Токен задания с правами чтения не позволяет перечислить все черновики. Job 3 перед изменением удалённого состояния выполняет [свои проверки]({{ '/internals/01-release-watcher/yaml/' | relative_url }}#publish-decision).

{% include crates-lab.html lab="lookup" title="Как ответ GitHub превращается в mode" options="Опубликованный релиз и тег|Релиз и тег отсутствуют|Недопустимое состояние релиза|Неполный список assets|Отсутствующий Git ref|Доступ к репозиторию не подтверждён|Тег уже существует|Ошибка GitHub API" gates="Запрос релиза по тегу|Проверка состояния и assets|Подтверждение доступа к репозиторию|Запрос Git ref|Строка 153 · summary" initial="Python печатает reuse. Bash доходит до строки 153." previews=crates_previews %}

## 4.14. Docker image, container и volume {#docker-architecture}

{% capture crates_source_6 %}{% raw %}    env:
      GENTOO_PORTAGE_IMAGE: gentoo/portage@sha256:ce69e5b771bfe9404731e846b835346c34f2c82817ac3626f13af198689a1961
      GENTOO_STAGE3_IMAGE: gentoo/stage3@sha256:d8536e52677e3efe4caf048ca588bc685bc2d24d7fdfc882de1cdc6d38c81d96{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_6 label="Два образа из окружения задания · строки 36–38" path=".github/workflows/zed-release-watcher.yml" revision=revision start=36 open=true %}

**Image** задаёт файловую систему и конфигурацию, из которых Docker создаёт контейнер. Ссылка `@sha256:…` закрепляет образ по дайджесту, а оценка его происхождения и безопасности требует отдельных доказательств. **Container** — экземпляр образа со своей конфигурацией, доступным для записи слоем и подключёнными точками монтирования. **Volume** — хранилище, которое можно смонтировать в нескольких контейнерах.

<figure class="figure crates-docker">
  <figcaption>Ожидаемая схема монтирования репозитория Gentoo</figcaption>
  <div class="crates-docker-lanes">
    <div><p class="crates-image"><small>Образ</small><code>gentoo/portage</code></p><p class="crates-edge"><code>docker create</code> ↓</p><p class="crates-container"><small>Контейнер-донор · Created</small><code>zed-independent-portage</code></p></div>
    <div><p class="crates-image"><small>Образ</small><code>gentoo/stage3</code></p><p class="crates-edge"><code>docker run --rm</code> ↓</p><p class="crates-container"><small>Временный контейнер · Running</small><code>cat</code></p></div>
  </div>
  <div class="crates-docker-lanes crates-edge"><span>↓ точка монтирования</span><span>↑ <code>--volumes-from</code></span></div>
  <p class="crates-volume"><small>Общий том · путь в контейнерах</small><code>/var/db/repos/gentoo</code></p>
</figure>

`--volumes-from` подключает монтирования контейнера-донора. Донор может оставаться в состоянии Created. Файловая система stage3 по-прежнему происходит из его собственного образа, а процессы и переменные окружения принадлежат самому stage3. Схема показывает путь, который ожидает скрипт. Объявления томов конкретного закреплённого образа локально не проверены. [Docker create](https://docs.docker.com/reference/cli/docker/container/create/) · [Docker run](https://docs.docker.com/reference/cli/docker/container/run/#volumes-from)

## 4.15. Подготавливаем окружение Portage {#prepare-portage}

{% capture crates_previews %}
{% capture crates_source_7 %}{% raw %}prepare_portage() {
  docker create --name zed-independent-portage "$GENTOO_PORTAGE_IMAGE" /bin/true > /dev/null
}{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_7 label="Создаём контейнер-донор · строки 58–61" path="scripts/ci/independent-crates.sh" revision=revision start=58 trailing_blank=true open=true %}
{% capture crates_source_8 %}{% raw %}  docker run --rm --volumes-from zed-independent-portage --entrypoint cat "$GENTOO_STAGE3_IMAGE" /var/db/repos/gentoo/metadata/license-mapping.conf > "$work/license-mapping.conf"
  test -s "$work/license-mapping.conf"{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_8 label="Временный потребитель тома · строки 66–67" path="scripts/ci/independent-crates.sh" revision=revision start=66 open=true %}
{% capture crates_source_9 %}{% raw %}cleanup() { docker rm -f zed-independent-portage >/dev/null 2>&1 || true; }
trap cleanup EXIT{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_9 label="Удаление донора при выходе · строки 71–72" path="scripts/ci/independent-crates.sh" revision=revision start=71 open=true %}
{% endcapture %}

`docker create` создаёт контейнер из `$GENTOO_PORTAGE_IMAGE` и через `--name` даёт ему имя `zed-independent-portage`. Команда `/bin/true` сохраняется в конфигурации. Она начнёт выполняться только при запуске контейнера, которого этот вызов не делает. `> /dev/null` направляет stdout с ID контейнера в устройство, отбрасывающее данные. Ошибки Docker по-прежнему идут в stderr.

Общий вызов на строке 154 предшествует `case`, поэтому донор готовится и при generation, и при reuse. В лаборатории показан временный потребитель ветки generation. Контейнер для проверки кандидата будет разобран позднее.

{% capture crates_diagram %}
<div class="crates-docker-lanes crates-payloads">
  <p class="flow-node"><strong>Portage</strong><small data-crates-docker-donor>Образ доступен</small></p>
  <p class="flow-node"><strong>Stage3</strong><small data-crates-docker-stage3>Контейнера нет</small></p>
</div>
<p class="crates-volume"><small>Общий том</small><code data-crates-mount>Монтирование ещё не создано</code></p>
{% endcapture %}
{% include crates-lab.html lab="docker" diagram=crates_diagram title="Жизненный цикл донора и потребителя" options="Образ доступен|Донор ещё не создан|Донор создан|Stage3 читает репозиторий|Stage3 завершился и удалён|Донор остаётся доступен|Shell выходит|docker create завершился ошибкой" gates="Образ доступен|docker create|Временный stage3|Удаление stage3|EXIT · попытка удаления донора" initial="Образ доступен. Контейнеры ещё не созданы." previews=crates_previews %}

## 4.16. Управляем временем жизни контейнера через trap {#cleanup}

{% capture crates_previews %}
{% capture crates_source_10 %}{% raw %}version="${1:?candidate version required}"
candidate="${2:?candidate ebuild required}"
patch="${3:?candidate patch required}"
overlay="${4:?disposable overlay required}"
work="${RUNNER_TEMP:?}/zed-independent"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
mkdir "$work"
mkdir "$work/dist" "$work/cache" "$work/logs"{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_10 label="Проверки до регистрации обработчика · строки 5–12" path="scripts/ci/independent-crates.sh" revision=revision start=5 open=true %}
{% capture crates_source_11 %}{% raw %}
cleanup() { docker rm -f zed-independent-portage >/dev/null 2>&1 || true; }
trap cleanup EXIT{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_11 label="Обработчик выхода · строки 70–73" path="scripts/ci/independent-crates.sh" revision=revision start=70 trailing_blank=true open=true %}
{% capture crates_source_12 %}{% raw %}summary '## Independent crates preparation'
timed 'Upstream source acquisition' acquire_source{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_12 label="Первые команды после определения функций · строки 150–151" path="scripts/ci/independent-crates.sh" revision=revision start=150 open=true %}
{% endcapture %}

`trap cleanup EXIT` регистрирует вызов функции при обычном выходе Bash, в том числе после ошибки с `set -e`. Регистрация стоит после начальных проверок аргументов и создания каталогов, до начала основного пути на строке 150. Поэтому сбой acquisition или lookup уже может привести к попытке удаления донора, даже если `prepare_portage` ещё не вызвана.

`docker rm -f` удаляет контейнер по имени, принудительно останавливая его при необходимости. Сначала `>/dev/null` направляет дескриптор 1 в устройство, затем `2>&1` дублирует уже перенаправленный дескриптор 1 в дескриптор 2. Если поменять порядок, stderr сохранит прежнее назначение stdout. `|| true` гасит отказ команды удаления. При обычном выходе исходный статус скрипта сохраняется.

Фиксированное имя важно при конфликте. Обработчик не проверяет, кто создал найденный контейнер. Удаление выполняется без `-v`, а образы и рабочие файлы эта функция вообще не трогает. Такой best-effort cleanup рассчитан на одноразовый runner. После SIGKILL обработчик не выполняется, а при потере runner его выполнение нельзя гарантировать. [Docker rm](https://docs.docker.com/reference/cli/docker/container/rm/)

{% include crates-lab.html lab="cleanup" title="Успеет ли выполниться EXIT trap?" options="Обычное завершение|Ошибка acquisition|Ошибка generation|Ошибка reuse|Донор отсутствует|Docker отказал в удалении|Начальный аргумент отсутствует|SIGKILL после установки trap" gates="trap установлен|cleanup достигнут|docker rm вызван|docker rm успешен" initial="Оба потока docker rm скрыты. Обычный выход со статусом 0." previews=crates_previews %}

## 4.17. Создаём изолированное окружение Python {#generator-venv}

{% capture crates_previews %}
{% capture crates_source_13 %}{% raw %}prepare_generator() {
  python3 -m venv "$work/venv"
  env -u GITHUB_TOKEN "$work/venv/bin/python" -m pip install 'pycargoebuild==0.16.0'
  test "$("$work/venv/bin/python" -c 'import importlib.metadata; print(importlib.metadata.version("pycargoebuild"))')" = 0.16.0{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_13 label="Создание venv, установка и проверка версии · строки 62–65" path="scripts/ci/independent-crates.sh" revision=revision start=62 open=true %}
{% endcapture %}

Системный `python3 -m venv` запускает модуль `venv` и создаёт каталог `$work/venv`. В нём есть конфигурация `pyvenv.cfg`, путь к интерпретатору в `bin/` и отдельный каталог `lib/pythonX.Y/site-packages`. Для установки скрипт вызывает `$work/venv/bin/python` и запускает его модуль `pip`. Менять `PATH` активацией окружения здесь не требуется.

`env -u GITHUB_TOKEN` убирает переменную из окружения процесса установки и его потомков. `==0.16.0` закрепляет версию прямой зависимости. Через `-c` тот же интерпретатор выполняет короткий фрагмент Python и читает установленную версию из метаданных дистрибутива. Bash сравнивает полученную строку с `0.16.0`. Установка создаёт и точку входа `bin/pycargoebuild`, которую вызовет обёртка.

Venv отделяет зависимости генератора от системных пакетов. Он не ограничивает доступ Python к системе как песочница. Закрепление одной версии оставляет открытыми версии транзитивных зависимостей и само по себе не обеспечивает полной воспроизводимости установки из сети.

{% capture crates_diagram %}
<div class="crates-transfer"><p><small>Runner</small><code>python3 -m venv</code></p><span class="crates-edge" aria-hidden="true">→</span><p><small>Venv</small><code>bin/python</code><small data-crates-python>Отдельный site-packages готов к установке</small></p></div>
{% endcapture %}
{% include crates-lab.html lab="venv" diagram=crates_diagram title="Какой Python выполняет следующий шаг?" options="Venv создан|Создание venv не удалось|Установка не удалась|Установлена версия 0.16.0|Установлена другая версия" gates="Системный python3 → venv|venv/bin/python → pip|site-packages → pycargoebuild|Чтение и сравнение версии|Чтение файла лицензий" initial="Созданы pyvenv.cfg, bin/python и отдельный site-packages. Следующий вызов запускает pip." previews=crates_previews %}

## 4.18. Получаем лицензионное отображение Gentoo {#license-mapping}

{% capture crates_previews %}
{% capture crates_source_14 %}{% raw %}  docker run --rm --volumes-from zed-independent-portage --entrypoint cat "$GENTOO_STAGE3_IMAGE" /var/db/repos/gentoo/metadata/license-mapping.conf > "$work/license-mapping.conf"
  test -s "$work/license-mapping.conf"
  summary 'Generator: pycargoebuild 0.16.0'
}{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_14 label="Чтение таблицы отображения лицензий · строки 66–70" path="scripts/ci/independent-crates.sh" revision=revision start=66 trailing_blank=true open=true %}
{% endcapture %}

`docker run` создаёт и запускает временный контейнер из `$GENTOO_STAGE3_IMAGE`. `--volumes-from zed-independent-portage` подключает том донора. Явного режима `:ro` здесь нет. `--entrypoint cat` выбирает исполняемую команду, а путь после образа становится её аргументом внутри контейнера. `--rm` удаляет временный контейнер после его завершения. Донор сохраняется для дальнейшей проверки.

Оператор `>` обрабатывает Bash на runner до запуска Docker-клиента. Он открывает, создаёт или обнуляет файл назначения. Docker передаёт stdout процесса `cat` в этот уже открытый поток. Если запуск или чтение завершатся ошибкой, на runner может остаться пустой или частично заполненный файл. `test -s` проверяет размер больше нуля. Смысл записей он не проверяет. Генератор применяет таблицу Gentoo при преобразовании идентификаторов лицензий Cargo в выражения для ebuild.

{% capture crates_diagram %}
<div class="crates-transfer"><p><small>Контейнер</small><code>Portage → том → stage3 → cat</code></p><span class="crates-edge" data-crates-mapping-edge>stdout →</span><p><small>Bash на runner открывает файл</small><code>$work/license-mapping.conf</code><small data-crates-mapping-file>Непустой файл</small></p></div>
{% endcapture %}
{% include crates-lab.html lab="mapping" diagram=crates_diagram title="От общего тома до файла на runner" options="Непустой файл прочитан|Команда в контейнере вернула ошибку|Чтение успешно, файл пуст|Bash не может открыть назначение" gates="Bash открывает путь назначения|Донор → том → stage3 → cat|stdout → открытый файл|test -s|Generator summary" initial="Файл на runner непустой. test -s и запись сводки достижимы." previews=crates_previews %}

## 4.19. Выбираем ветку generation или reuse {#preparation-branch}

{% capture crates_previews %}
{% capture crates_source_15 %}{% raw %}timed 'Portage environment preparation' prepare_portage
case "$mode" in
  generation)
    timed 'Generator environment preparation' prepare_generator
    timed 'Archive generation and validation' generate
    ;;
  reuse) timed 'Archive download and validation' reuse ;;
  *) echo "ERROR: invalid archive selection" >&2; exit 1 ;;
esac{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_15 label="Общая подготовка и развилка · строки 154–162" path="scripts/ci/independent-crates.sh" revision=revision start=154 open=true %}
{% endcapture %}

`case` сравнивает `mode` с двумя допустимыми значениями. Каждый вызов `timed` измеряет свою функцию, как в [первой части](#timing). В generation сначала готовится окружение генератора, затем создаётся архив. В reuse выполняется только скачивание с проверками. Неизвестный режим отклоняется после подготовки Portage. Ошибка в любой ветке останавливает обычный путь. Автоматического перехода из reuse в generation нет. Генерация на этом шаге создаёт локальные файлы.

{% include crates-lab.html lab="branch" title="Какие вызовы делает case" options="generation|reuse|Неизвестное значение" gates="prepare_portage|case mode|prepare_generator|generate|reuse|verify_inputs достижим" initial="После Portage выполняются prepare_generator и generate. Затем достижима строка 163." previews=crates_previews %}

## 4.20. Как устроен запуск pycargoebuild {#run-generator}

{% capture crates_previews %}
{% capture crates_source_16 %}{% raw %}generate() {
  local generator_start=$SECONDS
  "$overlay/scripts/ci/run-pycargoebuild.sh" "$work/venv/bin/pycargoebuild" \
    "$source_dir" "$archive" "$work/cache" "$work/license-mapping.conf" \
    "$work/generated-zed.ebuild" "$work" 2>&1 | tee "$work/logs/generator.log"
  summary "pycargoebuild download, repacking and metadata: $((SECONDS - generator_start))s"{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_16 label="Вызов генератора и замер времени · строки 74–79" path="scripts/ci/independent-crates.sh" revision=revision start=74 open=true %}
{% capture crates_source_17 %}{% raw %}#!/usr/bin/env bash
set -euo pipefail
binary="${1:?generator required}"
source_dir="${2:?source required}"
archive="${3:?archive required}"
cache="${4:?cache required}"
mapping="${5:?license mapping required}"
ebuild="${6:?output ebuild required}"
home="${7:?isolated home required}"
cd "$source_dir"
env -u GITHUB_TOKEN HOME="$home" "$binary" --no-config --crate-tarball \
  --crate-tarball-path "$archive" --distdir "$cache" --license-mapping "$mapping" \
  --output "$ebuild" crates/zed{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_17 label="Обёртка run-pycargoebuild.sh целиком · строки 1–13" path="scripts/ci/run-pycargoebuild.sh" revision=revision start=1 open=true %}
{% endcapture %}

Первая строка выбирает Bash через `env`. Обёртка включает [`set -euo pipefail`]({{ previous }}#startup) и проверяет семь позиционных аргументов по тому же правилу [`${n:?...}`](#arguments). Кавычки сохраняют каждый путь одним аргументом, в том числе с пробелами. `cd "$source_dir"` задаёт извлечённое дерево как рабочий каталог, поэтому относительный аргумент `crates/zed` указывает на пакет Zed внутри него. Исполняемый файл берётся из подготовленного venv.

{% capture crates_diagram %}
<div class="crates-transfer" data-crates-transfer><p><small>Выражение у вызывающего скрипта</small><code data-crates-input>$work/venv/bin/pycargoebuild</code></p><span class="crates-edge" aria-hidden="true">→</span><p><small>Позиция и имя в обёртке</small><code data-crates-target>$1 → binary</code></p></div>
<p class="crates-path"><small>Учебный абсолютный путь</small><code data-crates-path>/home/runner/work/_temp/zed-independent/venv/bin/pycargoebuild</code></p>
{% endcapture %}
{% include crates-lab.html lab="arguments" title="Семь аргументов от родительской функции к обёртке" options="$1 · binary|$2 · source_dir|$3 · archive|$4 · cache|$5 · mapping|$6 · ebuild|$7 · home" diagram=crates_diagram initial="Этот путь выбирает точку входа pycargoebuild из venv." previews=crates_previews %}

Последняя команда обёртки удаляет `GITHUB_TOKEN` из окружения генератора и назначает ему `HOME="$home"`. `--no-config` отключает загрузку файлов конфигурации pycargoebuild. Эти меры уменьшают зависимость от настроек пользователя. Остальные переменные Bash передаёт процессу как обычно.

- `--crate-tarball` включает упаковку registry crates. `--crate-tarball-path` задаёт путь выходного архива.
- `--distdir` задаёт каталог для скачиваемых файлов, включая отдельные архивы Git-зависимостей.
- `--license-mapping` передаёт файл соответствий Gentoo. `--output` направляет результат генерации ebuild в выбранный файл.

Генератор получает проверенное дерево исходников с `Cargo.lock`, окружение Python, таблицу лицензий и пути в рабочем каталоге. На диске появляются архив registry crates, отдельные архивы Git-зависимостей в кеше, сгенерированный ebuild и журнал. Этот шаг подготавливает зависимости и метаданные без сборки Zed. `generated-zed.ebuild` служит промежуточным источником данных для синхронизации. Сопровождаемый ebuild целиком им не заменяется. [Исходный дистрибутив pycargoebuild 0.16.0](https://pypi.org/project/pycargoebuild/0.16.0/#files)

## 4.21. Объединяем stdout и stderr {#generator-streams}

{% capture crates_previews %}
{% capture crates_source_18 %}{% raw %}    "$work/generated-zed.ebuild" "$work" 2>&1 | tee "$work/logs/generator.log"
  summary "pycargoebuild download, repacking and metadata: $((SECONDS - generator_start))s"{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_18 label="Общий журнал и следующая строка · строки 78–79" path="scripts/ci/independent-crates.sh" revision=revision start=78 open=true %}
{% endcapture %}

В конвейере [подготовки кандидата]({{ previous }}#streams) stderr Python шёл мимо `tee`. Здесь Bash соединяет дескриптор 1 производителя с pipe, затем `2>&1` дублирует его текущую цель в дескриптор 2. Число после `&` обозначает дескриптор. `tee` читает stdin, пишет в stdout и в `generator.log`. Без `-a` он открывает журнал для перезаписи.

{% capture crates_diagram %}
<div class="crates-streams">
  <div class="flow-node"><strong>Производитель</strong><code>1 · stdout</code><code>2 · stderr</code></div>
  <div class="crates-edge" data-crates-pipe>1 + 2 →</div>
  <div class="flow-node"><strong>tee</strong><small>stdin → stdout + файл</small></div>
</div>
<div class="shell-file-grid">
  <div class="workspace"><strong>stdout runner</strong><pre data-crates-console>Начало упаковки</pre></div>
  <div class="workspace"><strong>stderr runner</strong><pre data-crates-errors>—</pre></div>
  <div class="workspace"><strong>Файл журнала</strong><pre data-crates-log>Начало упаковки</pre></div>
</div>
{% endcapture %}
{% include crates-lab.html lab="streams" title="Как меняется маршрут stderr" options="Общий поток · обычный вывод|Раздельные потоки · предупреждение|Общий поток · предупреждение|Общий поток · генератор вернул 3|Общий поток · tee вернул 1" diagram=crates_diagram initial="При 2>&1 оба дескриптора ведут в pipe. Строка 79 достижима." previews=crates_previews %}

С `pipefail` статус конвейера равен последнему ненулевому статусу справа, либо нулю, когда обе команды успешны. При ошибке генератора `tee` всё ещё может записать полученный вывод. Уже созданные генератором файлы также могут остаться. Строка 79 с длительностью достижима только после успешного конвейера.

## 4.22. Проверяем содержимое crates-архива {#registry-inspection}

{% capture crates_previews %}
{% capture crates_source_19 %}{% raw %}  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/inspect_zed_archive.py" --archive "$archive" --lock "$source_dir/Cargo.lock" | tee -a "$GITHUB_STEP_SUMMARY"{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_19 label="Обязательная проверка архива · строка 80" path="scripts/ci/independent-crates.sh" revision=revision start=80 open=true %}
{% capture crates_source_20 %}{% raw %}def inspect(archive: Path, lock: Path) -> int:
    subprocess.run(['xz', '-t', str(archive)], check=True)
    with lock.open('rb') as f:
        packages = tomllib.load(f)['package']
    expected = {f"{p['name']}-{p['version']}": p['checksum'] for p in packages
                if p.get('source', '').startswith('registry+')}
    found: set[str] = set()
    checks: dict[str, str] = {}
    with tarfile.open(archive, 'r|xz') as tar:
        for member in tar:
            parts = member.name.split('/')
            if (len(parts) < 4 or parts[:2] != ['cargo_home', 'gentoo'] or
                    any(part in ('', '.', '..') for part in parts) or not member.isfile() or
                    member.name in found):
                raise ValueError(f'Unsafe or duplicate archive member: {member.name}')
            found.add(member.name)
            if parts[-1] == '.cargo-checksum.json':
                if len(parts) != 4 or parts[2] in checks or member.size > 100_000:
                    raise ValueError(f'Invalid crate checksum record: {member.name}')
                f = tar.extractfile(member)
                assert f is not None
                checks[parts[2]] = json.load(f)['package']
    crates = {name.split('/')[2] for name in found}
    if crates != expected.keys() or checks != expected:
        raise ValueError('Archive registry crate names or package checksums differ from Cargo.lock')
    print(f'Registry crate count: {len(crates)}')
    print(f'Archive size: {archive.stat().st_size} bytes')
    print(f'Archive SHA256: {digest(archive, "sha256")}')
    return len(crates){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_20 label="Проверки tar и Cargo.lock · строки 22–50" path="scripts/inspect_zed_archive.py" revision=revision start=22 %}
{% capture crates_source_21 %}{% raw %}def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--lock', type=Path)
    group.add_argument('--manifest', type=Path)
    args = p.parse_args()
    try:
        if args.lock:
            inspect(args.archive, args.lock)
        else:
            verify_manifest(args.archive, args.manifest)
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as e:
        print(f'Archive validation failed: {e}', file=sys.stderr)
        return 1
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_21 label="Аргументы и диагностика инспектора · строки 70–85" path="scripts/inspect_zed_archive.py" revision=revision start=70 %}
{% endcapture %}

Сначала `xz -t` проверяет целостность сжатого потока. Затем Python читает TOML из `Cargo.lock`, выбирает пакеты с `source`, начинающимся на `registry+`, и строит ожидаемое отображение `name-version → checksum`. Git-зависимости идут отдельным путём и в набор registry не входят.

Инспектор последовательно читает tar. Каждый просмотренный member должен быть обычным файлом под `cargo_home/gentoo/<crate>/`. Пустые компоненты пути, `.`, `..` и повторные имена отвергаются. Из корневого `.cargo-checksum.json` каждого crate берётся поле `package`. Проверяются набор crate-каталогов и совпадение этих полей с `Cargo.lock`. Пересчёта контрольных сумм каждого файла по карте `files` здесь нет. После успеха stdout содержит число registry crates, размер архива и SHA‑256 сжатого файла. Эти строки дописываются в сводку. Диагностика CLI идёт в stderr. Ключ `--lock` выбирает сверку с lock-файлом, а другой режим CLI, `--manifest`, здесь не используется.

{% capture crates_diagram %}
<div class="shell-file-grid crates-records">
<div class="workspace"><strong>Ожидается из Cargo.lock</strong><pre>example-a-1.0.0 → aa…
example-b-2.0.0 → bb…</pre></div>
<div class="workspace"><strong>Учебное дерево путей в tar</strong><pre data-crates-tree>cargo_home/
└── gentoo/
    ├── example-a-1.0.0/
    │   ├── Cargo.toml
    │   ├── src/lib.rs
    │   └── .cargo-checksum.json
    └── example-b-2.0.0/
        ├── Cargo.toml
        └── .cargo-checksum.json</pre><p data-crates-records>package: aa… и bb…</p></div>
</div>
{% endcapture %}
{% include crates-lab.html lab="registry" title="Какое расхождение остановит инспектор" options="Наборы и package совпали|Нет registry crate|Лишний registry crate|Поле package отличается|Небезопасный путь|Повторное имя member|Member не обычный файл|Поток xz повреждён" gates="xz -t|Чтение Cargo.lock|Чтение членов tar|Сравнение с lock|Создание metadata достижимо" diagram=crates_diagram initial="Наборы и объявления контрольных сумм совпали. Создание JSON достижимо." previews=crates_previews %}

Дерево показывает компоненты путей, а не отдельные записи каталогов в tar. Проверка отвечает за registry-часть и не доказывает, что весь исходный граф Cargo можно собрать офлайн.

## 4.23. Извлекаем время упаковки из журнала {#repacking-time}

{% capture crates_previews %}
{% capture crates_source_22 %}{% raw %}  grep -F 'Time elapsed during repacking:' "$work/logs/generator.log" | tee -a "$GITHUB_STEP_SUMMARY" || true{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_22 label="Необязательная строка времени упаковки · строка 81" path="scripts/ci/independent-crates.sh" revision=revision start=81 open=true %}
{% endcapture %}

`grep -F` ищет буквальный текст `Time elapsed during repacking:` и передаёт совпавшие строки в `tee -a` для дописывания в сводку. `pipefail` учитывает отказы обоих процессов. `|| true` относится ко всему конвейеру, поэтому продолжение возможно и при отсутствии строки, и при ошибке чтения или записи. У обязательной проверки архива строкой выше такого подавления нет.

{% include crates-lab.html lab="timing" title="Результат grep, tee и всего списка команд" options="Строка найдена|Совпадений нет|Ошибка чтения grep|tee не смог открыть сводку" gates="Поиск строки|Запись tee|Переход к create" initial="grep=0 · tee=0 · конвейер=0. Bash продолжает работу." previews=crates_previews %}

## 4.24. Формируем distribution metadata {#distribution-metadata}

{% capture crates_previews %}
{% capture crates_source_23 %}{% raw %}  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" create \
    --version "$version" --commit "$upstream_commit" --source "$source_dir" \
    --source-archive "$source_archive" --lock "$source_dir/Cargo.lock" --archive "$archive" \
    --generated "$work/generated-zed.ebuild" --cache "$work/cache" --output "$metadata"
}{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_23 label="Вызов create и выход из generate · строки 82–87" path="scripts/ci/independent-crates.sh" revision=revision start=82 trailing_blank=true open=true %}
{% capture crates_source_24 %}{% raw %}def validate_metadata(data: object, version: str) -> dict:
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
        raise ValueError('Invalid archive metadata')
    crates = data['git_crates']
    if not isinstance(crates, list) or not crates:
        raise ValueError('Missing Git crate metadata')
    for entry in crates:
        if (not isinstance(entry, dict) or set(entry) != {'name', 'repository', 'revision', 'unpack_path'} or
                any(not isinstance(v, str) for v in entry.values())):
            raise ValueError('Invalid Git crate record')
    try:
        normalized = sync.parse_entries(sync.entries_block(crates))
    except (ValueError, snapshot.CargoSnapshotError) as error:
        raise ValueError(f'Invalid Git crate metadata: {error}') from error
    if normalized != crates or len({x['name'] for x in crates}) != len(crates):
        raise ValueError('Duplicate or noncanonical Git crate metadata')
    licenses = data['licenses']
    if (not isinstance(licenses, list) or not licenses or
            any(not isinstance(x, str) or len(x) > 10000 or not LICENSE.fullmatch(x)
                or x != ' '.join(x.split()) for x in licenses)
            or licenses != sorted(set(licenses))):
        raise ValueError('Invalid license metadata')
    return data{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_24 label="Схема JSON и ограничения полей · строки 51–90" path="scripts/crates_distribution.py" revision=revision start=51 %}
{% capture crates_source_25 %}{% raw %}def create_metadata(version: str, commit: str, source: Path, source_archive: Path, lock: Path,
                    archive: Path, generated: Path, cache: Path) -> dict:
    archive_name, _ = names(version)
    if archive.name != archive_name:
        raise ValueError('Archive filename mismatch')
    text = generated.read_text(encoding='utf-8')
    sync.validate_sources(text, source, cache)
    data = {'schema_version': 1, 'zed_version': version, 'upstream_tag': f'v{version}',
            'upstream_commit': commit, 'source_sha256': sha256(source_archive),
            'cargo_lock_sha256': sha256(lock), 'generator': {'name': 'pycargoebuild', 'version': '0.16.0'},
            'archive': {'filename': archive.name, 'size': archive.stat().st_size, 'sha256': sha256(archive)},
            'git_crates': sync.parse_entries(text), 'licenses': license_expressions(text)}
    return validate_metadata(data, version)


def license_expressions(text: str) -> list[str]:
    """Preserve each generated Gentoo license expression for manual review."""
    values = re.findall(r'^LICENSE\+?="([^"]*)"', text, re.MULTILINE)
    return sorted({' '.join(value.split()) for value in values if value.strip()}){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_25 label="Источники полей и нормализация лицензий · строки 100–118" path="scripts/crates_distribution.py" revision=revision start=100 %}
{% capture crates_source_26 %}{% raw %}    create = sub.add_parser('create')
    for name in ('version', 'commit', 'source', 'source-archive', 'lock', 'archive', 'generated', 'cache', 'output'):
        create.add_argument('--' + name, required=True){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_26 label="Девять аргументов create · строки 210–212" path="scripts/crates_distribution.py" revision=revision start=210 %}
{% capture crates_source_27 %}{% raw %}    try:
        if args.action == 'create':
            data = create_metadata(args.version, args.commit, Path(args.source), Path(args.source_archive), Path(args.lock), Path(args.archive), Path(args.generated), Path(args.cache))
            Path(args.output).write_text(json.dumps(data, sort_keys=True, indent=2) + '\n', encoding='utf-8'){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_27 label="Проверка перед записью JSON · строки 225–228" path="scripts/crates_distribution.py" revision=revision start=225 %}
{% capture crates_source_28 %}{% raw %}    except (OSError, ValueError, KeyError, json.JSONDecodeError, snapshot.CargoSnapshotError, release_handoff.HandoffError) as error:
        print(f'Distribution validation failed: {error}', file=sys.stderr)
        return 1
    print(f'Distribution {args.action}: OK')
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_28 label="Результат CLI · строки 240–244" path="scripts/crates_distribution.py" revision=revision start=240 %}
{% capture crates_source_29 %}{% raw %}def validate_sources(generated: str, source: Path, cache: Path) -> dict[str, snapshot.GitCrate]:
    _, _, declaration = block(generated)
    entries = parse_entries(declaration)
    crates = snapshot.parse_git_crates(declaration)
    errors = snapshot.compare_snapshots(snapshot.parse_lock(source / "Cargo.lock"), crates)
    if errors:
        raise snapshot.CargoSnapshotError("\n".join(errors))
    for entry in entries:
        name, repository, commit, unpack = (entry[k] for k in ('name', 'repository', 'revision', 'unpack_path'))
        repo_name = repository.rsplit('/', 1)[1]
        archive = cache / f"{repo_name}-{commit}.gh.tar.gz"
        member_name = str(PurePosixPath(unpack.replace('%commit%', commit)) / 'Cargo.toml')
        try:
            with tarfile.open(archive, 'r:gz') as tar:
                matches = [m for m in tar if m.name == member_name]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 2_000_000:
                    raise snapshot.CargoSnapshotError(f"Invalid Cargo.toml for {name!r} in {archive.name}.")
                f = tar.extractfile(matches[0])
                assert f is not None
                manifest = tomllib.loads(f.read().decode('utf-8'))
                if manifest.get('package', {}).get('name') != name:
                    raise snapshot.CargoSnapshotError(f"Crate identity mismatch for {name!r}.")
        except (OSError, tarfile.TarError, UnicodeError, tomllib.TOMLDecodeError) as error:
            raise snapshot.CargoSnapshotError(f"Cannot validate source for {name!r}: {error}") from error
    return crates{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_29 label="Проверка декларации, исходников и кеша · строки 75–99" path="scripts/sync_zed_git_crates.py" revision=revision start=75 %}
{% endcapture %}

`create` принимает девять аргументов. `--version` задаёт версию и ожидаемые имена файлов, а `--commit` получает коммит из acquisition. `--source` ведёт к извлечённому дереву для сверки Git-зависимостей. `--source-archive` и `--lock` указывают файлы для вычисления SHA‑256. `--archive` задаёт уже проверенный crates-архив. Из `--generated` читаются декларация `GIT_CRATES` и выражения лицензий. `--cache` ведёт к архивам Git-ревизий, а `--output` задаёт путь нового JSON.

Перед формированием JSON Python проверяет ожидаемое имя архива и вызывает `validate_sources`. Она сверяет Git-декларацию с lock и читает ожидаемые `Cargo.toml` из кеша. `license_expressions` берёт непустые значения из строк присваивания `LICENSE` и `LICENSE+=`, нормализует пробелы, убирает повторы и сортирует выражения. Они остаются материалом для ручной проверки лицензий. Итог проходит проверку схемы, затем записывается в `--output`. CLI печатает `Distribution create: OK`. JSON описывает идентичность файлов и метаданные сборки. Криптографической подписи он не содержит. Архив и JSON остаются локальными.

{% capture crates_diagram %}
<div class="crates-transfer"><p><small>Поле и источник</small><code data-crates-input>Константа схемы в create_metadata</code></p><span class="crates-edge" aria-hidden="true">→</span><p><small>Файл назначения</small><code>dist/zed-1.29.0-overlay-crates.json</code></p></div>
<figure class="acq-records"><figcaption>Учебный фрагмент JSON · неполный пример</figcaption><pre data-crates-json>{
  "schema_version": 1
}</pre></figure>
{% endcapture %}
{% include crates-lab.html lab="metadata" title="Откуда приходит каждое поле JSON" options="schema_version|zed_version и upstream_tag|upstream_commit|source_sha256|cargo_lock_sha256|generator|archive|git_crates|licenses" diagram=crates_diagram initial="Версия схемы 1 определяет набор полей и проверок." previews=crates_previews %}

## 4.25. Переиспользуем опубликованный архив {#reuse}

{% capture crates_previews %}
{% capture crates_source_30 %}{% raw %}reuse() {
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" reuse \
    --version "$version" --commit "$upstream_commit" --source-archive "$source_archive" \
    --source "$source_dir" --archive "$archive" --metadata "$metadata" \
    --cache "$work/cache" --generated "$work/generated-zed.ebuild"
}{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_30 label="Вызов reuse · строки 88–94" path="scripts/ci/independent-crates.sh" revision=revision start=88 trailing_blank=true open=true %}
{% capture crates_source_31 %}{% raw %}            raise GitHubError('Refusing a non-HTTPS redirect')
        return redirected


class Client:
    def __init__(self, token: str):
        if not token:
            raise GitHubError('GitHub token is required')
        self.token = token
        self.opener = urllib.request.build_opener(SafeRedirect())

    def request(self, url: str, *, method: str = 'GET', payload: bytes | None = None,
                content_type: str = 'application/json', auth: bool = True,
                accept: str = 'application/vnd.github+json', output: Path | None = None) -> tuple[int, bytes]:
        if not url.startswith('https://'):
            raise GitHubError('Only HTTPS is supported')
        headers = {'Accept': accept, 'User-Agent': 'zed-overlay-release', 'X-GitHub-Api-Version': '2022-11-28'}
        if auth:
            host = urllib.parse.urlsplit(url).hostname
            if host not in ('api.github.com', 'uploads.github.com'):{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_31 label="Инициализация API-клиента и заголовки · строки 35–54" path="scripts/crates_github.py" revision=revision start=35 %}
{% capture crates_source_32 %}{% raw %}    def download(self, url: str, path: Path, *, auth: bool = False) -> None:
        status, _ = self.request(url, auth=auth, output=path,
                                 accept='application/octet-stream')
        if status != 200:
            raise GitHubError(f'Asset download failed: HTTP {status}'){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_32 label="Загрузка файла через Client.download · строки 88–93" path="scripts/crates_github.py" revision=revision start=88 trailing_blank=true %}
{% capture crates_source_33 %}{% raw %}def expected_assets(release: object, version: str, *, draft: bool = False) -> dict[str, dict]:
    if (not isinstance(release, dict) or release.get('tag_name') != release_tag(version) or
            release.get('draft') is not draft or release.get('prerelease') is not False or
            type(release.get('id')) is not int or release['id'] <= 0 or
            (not draft and not isinstance(release.get('published_at'), str)) or
            (draft and release.get('published_at') is not None) or
            not isinstance(release.get('assets'), list)):
        raise GitHubError('Invalid release identity or state')
    names = set(distribution.names(version))
    assets = release['assets']
    if (len(assets) != len(names) or
            any(not isinstance(a, dict) or not isinstance(a.get('name'), str) for a in assets)):
        raise GitHubError('Release assets are incomplete or unexpected')
    if {a.get('name') for a in assets} != names:
        raise GitHubError('Release asset names are incomplete or unexpected')
    for asset in assets:
        if (type(asset.get('id')) is not int or asset['id'] <= 0 or
                type(asset.get('size')) is not int or asset['size'] <= 0 or
                asset.get('state') != 'uploaded'):
            raise GitHubError('Invalid release asset metadata')
    if len({a['id'] for a in assets}) != len(assets):
        raise GitHubError('Duplicate release asset IDs')
    return {a['name']: a for a in assets}{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_33 label="Проверка метаданных assets · строки 100–122" path="scripts/crates_github.py" revision=revision start=100 %}
{% capture crates_source_34 %}{% raw %}def public_url(version: str, filename: str) -> str:
    if filename not in distribution.names(version):
        raise GitHubError('Unexpected asset filename')
    return f'{PUBLIC}/{release_tag(version)}/{filename}'


def prepare_reuse(client: Client, version: str, commit: str, source_archive: Path,
                  source: Path, archive: Path, metadata: Path, cache: Path, generated: Path) -> None:
    mode, release = lookup(client, version)
    if mode != 'reuse':
        raise GitHubError('Release disappeared before reuse')
    assets = expected_assets(release, version)
    client.download(public_url(version, metadata.name), metadata)
    data = distribution.read_metadata(metadata, version)
    if (assets[metadata.name]['size'] != metadata.stat().st_size or
            assets[metadata.name].get('digest') != 'sha256:' + distribution.sha256(metadata)):
        raise GitHubError('Published metadata asset size or digest mismatch')
    client.download(public_url(version, archive.name), archive)
    distribution.validate_archive(data, archive)
    if (assets[archive.name]['size'] != archive.stat().st_size or
            assets[archive.name].get('digest') != 'sha256:' + distribution.sha256(archive)):
        raise GitHubError('Published archive asset size or digest mismatch')
    distribution.validate_identity(data, commit, source_archive, source / 'Cargo.lock')
    inspector.inspect(archive, source / 'Cargo.lock')
    declaration = sync.entries_block(data['git_crates'])
    for entry in data['git_crates']:
        repo = entry['repository']
        revision = entry['revision']
        filename = f"{repo.rsplit('/', 1)[1]}-{revision}.gh.tar.gz"
        dest = cache / filename
        if not dest.exists():
            client.download(f'{repo}/archive/{revision}.tar.gz', dest)
    sync.validate_sources(declaration, source, cache)
    licenses = ''.join(f'LICENSE+="{value}"\n' for value in data['licenses'])
    generated.write_text(declaration + licenses, encoding='utf-8'){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_34 label="Публичный URL и последовательность reuse · строки 157–191" path="scripts/crates_github.py" revision=revision start=157 %}
{% capture crates_source_35 %}{% raw %}def read_metadata(path: Path, version: str) -> dict:
    regular(path)
    if path.stat().st_size > 1_000_000:
        raise ValueError('Metadata is too large')
    return validate_metadata(json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object), version){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_35 label="Чтение и проверка JSON · строки 93–97" path="scripts/crates_distribution.py" revision=revision start=93 %}
{% capture crates_source_36 %}{% raw %}def validate_archive(data: dict, archive: Path) -> None:
    regular(archive)
    if archive.name != data['archive']['filename'] or archive.stat().st_size != data['archive']['size'] or sha256(archive) != data['archive']['sha256']:
        raise ValueError('Archive does not match metadata')


def validate_identity(data: dict, commit: str, source_archive: Path, lock: Path) -> None:
    if (data['upstream_commit'] != commit or data['source_sha256'] != sha256(source_archive) or
            data['cargo_lock_sha256'] != sha256(lock)):
        raise ValueError('Upstream commit, source archive or Cargo.lock mismatch')
    expected = snapshot.parse_lock(lock)
    actual = snapshot.parse_git_crates(sync.entries_block(data['git_crates']))
    errors = snapshot.compare_snapshots(expected, actual)
    if errors:
        raise ValueError('\n'.join(errors)){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_36 label="Сопоставление с архивом и upstream · строки 121–135" path="scripts/crates_distribution.py" revision=revision start=121 %}
{% capture crates_source_37 %}{% raw %}    crates = {name.split('/')[2] for name in found}
    if crates != expected.keys() or checks != expected:
        raise ValueError('Archive registry crate names or package checksums differ from Cargo.lock')
    print(f'Registry crate count: {len(crates)}')
    print(f'Archive size: {archive.stat().st_size} bytes')
    print(f'Archive SHA256: {digest(archive, "sha256")}')
    return len(crates){% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_37 label="Итог проверки registry-части · строки 44–50" path="scripts/inspect_zed_archive.py" revision=revision start=44 %}
{% capture crates_source_38 %}{% raw %}def validate_sources(generated: str, source: Path, cache: Path) -> dict[str, snapshot.GitCrate]:
    _, _, declaration = block(generated)
    entries = parse_entries(declaration)
    crates = snapshot.parse_git_crates(declaration)
    errors = snapshot.compare_snapshots(snapshot.parse_lock(source / "Cargo.lock"), crates)
    if errors:
        raise snapshot.CargoSnapshotError("\n".join(errors))
    for entry in entries:
        name, repository, commit, unpack = (entry[k] for k in ('name', 'repository', 'revision', 'unpack_path'))
        repo_name = repository.rsplit('/', 1)[1]
        archive = cache / f"{repo_name}-{commit}.gh.tar.gz"
        member_name = str(PurePosixPath(unpack.replace('%commit%', commit)) / 'Cargo.toml')
        try:
            with tarfile.open(archive, 'r:gz') as tar:
                matches = [m for m in tar if m.name == member_name]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 2_000_000:
                    raise snapshot.CargoSnapshotError(f"Invalid Cargo.toml for {name!r} in {archive.name}.")
                f = tar.extractfile(matches[0])
                assert f is not None
                manifest = tomllib.loads(f.read().decode('utf-8'))
                if manifest.get('package', {}).get('name') != name:
                    raise snapshot.CargoSnapshotError(f"Crate identity mismatch for {name!r}.")
        except (OSError, tarfile.TarError, UnicodeError, tomllib.TOMLDecodeError) as error:
            raise snapshot.CargoSnapshotError(f"Cannot validate source for {name!r}: {error}") from error
    return crates{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_38 label="Проверки Git-источников · строки 75–99" path="scripts/sync_zed_git_crates.py" revision=revision start=75 %}
{% endcapture %}

`Client` требует `GITHUB_TOKEN` и использует его для запросов к API. У `Client.download` по умолчанию `auth=False`. Метаданные релиза поэтому запрашиваются с аутентификацией, а файлы release скачиваются по публичным URL без заголовка авторизации. Та же настройка по умолчанию действует при скачивании Git-архивов.

Сначала `prepare_reuse` повторяет lookup, требует режим `reuse` и снова получает записи двух ожидаемых assets. Затем скачивает JSON, читает его со строгой проверкой схемы и сверяет размер и SHA‑256 с API. Только после этого скачивается crates-архив. Сначала он сравнивается с JSON, затем с размером и дайджестом из API.

Далее проверяются upstream-коммит, отпечатки source archive и `Cargo.lock`, а также соответствие Git-снимка записей в JSON lock-файлу. Инспектор из [раздела 4.22](#registry-inspection) проверяет registry-архив. Из `git_crates` строится `GIT_CRATES`, затем скачиваются недостающие Git-архивы. После проверки их исходников скрипт записывает `generated-zed.ebuild`. Сбой останавливает ветку на первом отказе. Предыдущие загрузки остаются на диске, а прерванная запись может оставить частичный файл. Перехода к генерации нет.

{% capture crates_diagram %}
<div class="workspace crates-local"><strong>Состояние локальных файлов</strong><pre data-crates-files>dist/zed-1.29.0-overlay-crates.json
dist/zed-1.29.0-overlay-crates.tar.xz
cache/repository-&lt;revision&gt;.gh.tar.gz
generated-zed.ebuild</pre></div>
{% endcapture %}
{% include crates-lab.html lab="reuse" title="До какого шага доходит reuse" options="Релиз и файлы совпадают|Релиз исчез до повторного lookup|Размер или digest JSON расходятся с API|Архив расходится с JSON|Digest архива расходится с API|Upstream identity расходится|Инспектор registry отклонил архив|Не удалось скачать Git-архив|Git-источник не прошёл проверку" gates="Повторный lookup и режим reuse|Записи ожидаемых assets|Скачать JSON|Прочитать и проверить JSON|Сверить JSON с API|Скачать registry-архив|Сверить архив с JSON|Сверить архив с API|Проверить upstream identity|Проверить registry-архив|Построить GIT_CRATES|Скачать недостающие Git-архивы|Проверить Git-источники|Записать generated-zed.ebuild" diagram=crates_diagram initial="Обе загрузки и все проверки завершены. verify_inputs достижим." previews=crates_previews %}

<figure class="figure">
  <figcaption>Два источника загрузки · учебный репозиторий и ревизия</figcaption>
  <div class="crates-docker-lanes crates-records">
    <div class="workspace"><strong>Релиз <code>crates-v1.29.0</code> оверлея</strong><p>↓ registry archive и metadata JSON → <code>dist/</code></p></div>
    <div class="workspace"><strong>Ревизия Git из JSON</strong><p><code>https://github.com/example/repository/archive/0123456789abcdef0123456789abcdef01234567.tar.gz</code></p><p>↓ <code>cache/repository-0123456789abcdef0123456789abcdef01234567.gh.tar.gz</code></p></div>
  </div>
</figure>

Git-архивы берутся из указанных репозиториев и ревизий, отдельно от двух assets релиза. В кеше применяется форма имени `repository-<revision>.gh.tar.gz`. Уже существующий путь пропускает скачивание, но проверка `validate_sources` всё равно выполняется. Она сверяет Git-зависимости с lock и проверяет ожидаемый `Cargo.toml` и имя пакета внутри архива.

В reuse pycargoebuild и его venv не нужны. Скрипт записывает в `generated-zed.ebuild` только декларацию `GIT_CRATES` и строки `LICENSE+="…"`. Этих сведений достаточно для следующего этапа синхронизации.

## 4.26. Сравниваем результаты generation и reuse {#preparation-convergence}

В generation venv и таблица лицензий нужны для запуска pycargoebuild. После него инспектор проверяет registry-архив, а `create` формирует JSON. В reuse повторно проверяется релиз, скачиваются JSON и архив, сверяются их идентичность и содержимое в пределах реализованных проверок. Git-архивы поступают по отдельным URL, затем локальный файл метаданных восстанавливается из JSON.

{% capture crates_previews %}
{% capture crates_source_39 %}{% raw %}mode="$(PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" lookup --version "$version")"
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
timed 'Metadata and source integrity validation' verify_inputs{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_39 label="От lookup до следующей общей проверки · строки 152–163" path="scripts/ci/independent-crates.sh" revision=revision start=152 open=true %}
{% endcapture %}
{% capture crates_diagram %}
<div class="crates-docker-lanes crates-branches">
  <div class="flow-node shell-focus" data-crates-branch="generation"><code>generation</code><small>venv → генератор → инспектор → JSON</small></div>
  <div class="flow-node" data-crates-branch="reuse"><code>reuse</code><small>релиз → скачивание → проверки → декларация</small></div>
</div>
<p class="crates-edge crates-converge">↓ Общие локальные входы ↓</p>
<div class="workspace crates-local"><pre data-crates-files>zed-independent/
├── dist/
│   ├── zed-1.29.0.tar.gz
│   ├── zed-1.29.0-overlay-crates.tar.xz
│   └── zed-1.29.0-overlay-crates.json
├── source/
│   └── zed-1.29.0/
├── cache/
│   └── архивы Git-зависимостей
└── generated-zed.ebuild</pre><p data-crates-extra>Только generation · venv/, license-mapping.conf, logs/generator.log</p><p data-crates-donor>Донор остаётся доступен до выхода Bash.</p></div>
{% endcapture %}
{% include crates-lab.html lab="convergence" title="Какие файлы доходят до общей проверки" options="Успешная generation|Успешная reuse|Первый lookup не удался|Подготовка Portage не удалась|Подготовка генератора не удалась|Генератор вернул ошибку|Инспектор registry вернул ошибку|Создание metadata не удалось|Проверка identity в reuse не удалась|Не удалось получить Git-архив" gates="Первый lookup|Подготовка Portage|Окружение генератора|Запуск pycargoebuild|Инспекция registry · generation|Создание JSON|Повторный lookup и загрузка двух assets|Identity и инспекция registry · reuse|Git-архивы и восстановление декларации|verify_inputs достижим" diagram=crates_diagram initial="generation завершена. verify_inputs достижим." previews=crates_previews %}

Файл `generated-zed.ebuild` в обеих ветках пригоден как источник сведений для следующего этапа, хотя его байты могут отличаться. В `mode` ещё хранится локальная строка выбора. Каталог `$RUNNER_TEMP/crates-distribution` создаётся позднее, на строках 166–167, а `$work/logs/result.txt` записывается на строке 168. Строка 163 передаёт локальные файлы общей проверке. Handoff, публикация релиза и открытие PR относятся к следующим этапам workflow.

{% capture crates_source_40 %}{% raw %}timed 'Metadata and source integrity validation' verify_inputs{% endraw %}{% endcapture %}
{% include source-preview.html source=crates_source_40 label="Следующая общая команда · строка 163" path="scripts/ci/independent-crates.sh" revision=revision start=163 open=true %}

## 4.27. Возвращаемся к общему пути проверки {#common-integrity}

{% capture integrity_source %}{% raw %}timed 'Metadata and source integrity validation' verify_inputs
timed 'GIT_CRATES synchronization' sync_metadata{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Общие вызовы после generation и reuse · строки 163–164" path=script revision=revision start=163 open=true %}

После `esac` обе успешные ветки сходятся в одной точке. В [лаборатории 4.26](#preparation-convergence) можно переключить generation и reuse и увидеть общие входы: распакованные исходники, исходный `.tar.gz`, архив registry crates, JSON с метаданными дистрибутива, кеш Git-архивов и `generated-zed.ebuild`.

Первый `timed` вызывает `verify_inputs` и записывает длительность в сводку. Только после его успешного завершения запускается второй `timed` с `sync_metadata`. Подготовленные файлы должны пройти обе общие функции, прежде чем Bash дойдёт до проверки кандидата в Portage.

## 4.28. Повторно проверяем Cargo.lock {#lock-integrity}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}verify_inputs() {
  test "$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)" = "$lock_hash"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Сравнение сохранённого и текущего SHA-256 · строки 95–96" path=script revision=revision start=95 %}
{% capture integrity_source %}{% raw %}  lock_hash="$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Первоначальный отпечаток Cargo.lock · строка 53" path=script revision=revision start=53 %}
{% capture integrity_source %}{% raw %}  mkdir "$work/source-verify"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Следующая команда после сравнения · строка 97" path=script revision=revision start=97 %}
{% endcapture %}
{% include integrity-lab.html lab="lock-integrity" previews=integrity_previews %}

На строке 53 `lock_hash` сохранил дайджест после первоначальной распаковки. Теперь [тот же конвейер](#fingerprints) повторно читает рабочий `Cargo.lock`. `sha256sum` выдаёт контрольную сумму и имя файла, `cut` оставляет первое поле, а подстановка команды передаёт stdout как один строковый аргумент `test`. Сравнение показывает, сохранился ли lock-файл, который использовался при подготовке архива.

Внешний `test` возвращает собственный код по результату сравнения строк. Ошибка `sha256sum` сама по себе в этот код не переносится. В примере с отсутствующим файлом `sha256sum` пишет диагностику в stderr, `cut` получает пустой поток и завершается с кодом 0. При `pipefail` код конвейера равен 1, но для внешнего `test` важен пустой stdout: он отличается от сохранённой непустой строки. `test` возвращает 1, и `errexit` останавливает сценарий до `mkdir`. Дайджесты в лаборатории вымышлены.

## 4.29. Восстанавливаем эталонное дерево исходников {#source-reconstruction}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}  mkdir "$work/source-verify"
  tar -xzf "$source_archive" -C "$work/source-verify"
  diff -qr --no-dereference "$source_dir" "$work/source-verify/zed-${version}"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Каталог, повторная распаковка и сравнение · строки 97–99" path=script revision=revision start=97 %}
{% capture integrity_source %}{% raw %}  mkdir "$work/source"
  tar -xzf "$source_archive" -C "$work/source"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Первая распаковка · строки 51–52" path=script revision=revision start=51 %}
{% endcapture %}
{% include integrity-lab.html lab="source-rebuild" previews=integrity_previews %}

Первая распаковка подготовила дерево, с которым работала ветка generation или reuse. Теперь `mkdir` сначала создаёт отдельный пустой каталог, затем `tar -xzf` распаковывает в него текущий **локальный** `source_archive`. `-C` задаёт каталог назначения. При сбое `mkdir` запуск `tar` пропускается. Если `tar` успел извлечь часть файлов, они могут остаться в новом каталоге.

```text
zed-independent/
├── dist/
│   └── zed-1.29.0.tar.gz
├── source/
│   └── zed-1.29.0/
└── source-verify/
    └── zed-1.29.0/
```

В роли эталона выступает дерево, которое получилось из локального архива во второй раз. Здесь нет повторного скачивания и повторного вызова `verify_zed_source.py`. Если с момента acquisition архив на диске изменился, повторная распаковка читает уже изменившийся файл.

## 4.30. Сравниваем деревья через diff {#recursive-source-diff}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}  diff -qr --no-dereference "$source_dir" "$work/source-verify/zed-${version}"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" identity \{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Сравнение деревьев и следующая команда · строки 99–100" path=script revision=revision start=99 %}
{% endcapture %}
{% include integrity-lab.html lab="recursive-diff" previews=integrity_previews %}

`diff` получает рабочее дерево первым аргументом, повторно распакованное — вторым. `-q` сообщает о различиях без полного построчного diff, `-r` спускается во вложенные каталоги, `--no-dereference` сравнивает сами символические ссылки и их цели. Код 0 означает, что различий не обнаружено, 1 — есть различия, 2 — возникла проблема сравнения. В этом потоке оба ненулевых кода останавливают Bash.

Изменённый или отсутствующий `Cargo.lock` остановил бы запуск ещё на предыдущем сравнении. Здесь меняется другой файл, например `Cargo.toml`, при уже проверенном lock. Сравнение ограничено правилами `diff`: одинаковый обычный файл с разными битами исполнения даёт код 0. Владелец, временные метки и расширенные атрибуты выходят за рамки такой сверки. Сценарии со ссылкой и правами проверены на GNU diffutils 3.12.

## 4.31. Проверяем identity архива и метаданных {#distribution-identity}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" identity \
    --version "$version" --commit "$upstream_commit" --source-archive "$source_archive" \
    --lock "$source_dir/Cargo.lock" --archive "$archive" --metadata "$metadata"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Аргументы команды identity · строки 100–102" path=script revision=revision start=100 %}
{% capture integrity_source %}{% raw %}    identity = sub.add_parser('identity')
    for name in ('version', 'commit', 'source-archive', 'lock', 'archive', 'metadata'):
        identity.add_argument('--' + name, required=True){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Аргументы CLI · строки 213–215" path="scripts/crates_distribution.py" revision=revision start=213 %}
{% capture integrity_source %}{% raw %}        elif args.action == 'identity':
            data = read_metadata(Path(args.metadata), args.version)
            validate_archive(data, Path(args.archive))
            validate_identity(data, args.commit, Path(args.source_archive), Path(args.lock)){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Порядок трёх проверок · строки 229–232" path="scripts/crates_distribution.py" revision=revision start=229 %}
{% capture integrity_source %}{% raw %}def read_metadata(path: Path, version: str) -> dict:
    regular(path)
    if path.stat().st_size > 1_000_000:
        raise ValueError('Metadata is too large')
    return validate_metadata(json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object), version){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Чтение и проверка JSON · строки 93–97" path="scripts/crates_distribution.py" revision=revision start=93 %}
{% capture integrity_source %}{% raw %}    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ValueError('Unsupported metadata schema version'){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Ошибка версии схемы · строки 57–58" path="scripts/crates_distribution.py" revision=revision start=57 %}
{% capture integrity_source %}{% raw %}def validate_archive(data: dict, archive: Path) -> None:
    regular(archive)
    if archive.name != data['archive']['filename'] or archive.stat().st_size != data['archive']['size'] or sha256(archive) != data['archive']['sha256']:
        raise ValueError('Archive does not match metadata'){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Имя, размер и SHA-256 crates-архива · строки 121–124" path="scripts/crates_distribution.py" revision=revision start=121 %}
{% capture integrity_source %}{% raw %}def validate_identity(data: dict, commit: str, source_archive: Path, lock: Path) -> None:
    if (data['upstream_commit'] != commit or data['source_sha256'] != sha256(source_archive) or
            data['cargo_lock_sha256'] != sha256(lock)):
        raise ValueError('Upstream commit, source archive or Cargo.lock mismatch')
    expected = snapshot.parse_lock(lock)
    actual = snapshot.parse_git_crates(sync.entries_block(data['git_crates']))
    errors = snapshot.compare_snapshots(expected, actual)
    if errors:
        raise ValueError('\n'.join(errors)){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Upstream identity и Git-снимок · строки 127–135" path="scripts/crates_distribution.py" revision=revision start=127 %}
{% capture integrity_source %}{% raw %}    except (OSError, ValueError, KeyError, json.JSONDecodeError, snapshot.CargoSnapshotError, release_handoff.HandoffError) as error:
        print(f'Distribution validation failed: {error}', file=sys.stderr)
        return 1
    print(f'Distribution {args.action}: OK')
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Диагностика CLI · строки 240–244" path="scripts/crates_distribution.py" revision=revision start=240 %}
{% capture integrity_source %}{% raw %}        if upstream_crate.commit != ebuild_crate.commit:
            errors.append(
                f"{name}: revision differs (upstream {upstream_crate.commit}, "
                f"ebuild {ebuild_crate.commit})."{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Диагностика различия ревизий · строки 277–280" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=277 %}
{% endcapture %}
{% include integrity-lab.html lab="distribution-identity" previews=integrity_previews %}

CLI выполняет три вызова последовательно.

1. `read_metadata` требует обычный файл, ограничивает размер JSON миллионом байт, читает UTF-8, отклоняет повторные ключи и проверяет [схему метаданных](#distribution-metadata) для указанной версии.
2. `validate_archive` требует обычный файл crates-архива и сверяет имя, размер и SHA-256 с JSON. Условия вычисляются слева направо. При расхождении размера дайджест уже не вычисляется.
3. `validate_identity` сравнивает коммит и **текущие** SHA-256 исходного архива и lock-файла со значениями из JSON. Затем строит два Git-снимка: из `Cargo.lock` и из `git_crates` в JSON. При несовпадении CLI печатает первую возникшую ошибку со своим префиксом в stderr и возвращает 1. При успехе stdout содержит `Distribution identity: OK`.

У этих проверок разные точки отсчёта. [Первичная сверка](#tree-verification) сопоставляет исходный архив с Git tree. `test` сверяет lock с сохранённым Bash-отпечатком. `diff` сравнивает рабочее дерево с повторной распаковкой. `identity` проверяет согласованность текущих локальных файлов с distribution metadata, как и на [пути reuse](#reuse). Ранее вычисленный `source_hash` попал в сводку acquisition. Среди аргументов `identity` его нет. Согласованные изменения нескольких входов могут пройти проверку согласованности, поэтому один её успех не служит независимым подтверждением неизменности файлов.

## 4.32. Переносим Git archives в distfiles {#copy-git-distfiles}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}  cp -n "$work/cache/"*.gh.tar.gz "$work/dist/"
}{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Копирование Git-архивов · строки 103–104" path=script revision=revision start=103 %}
{% capture integrity_source %}{% raw %}timed 'GIT_CRATES synchronization' sync_metadata{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Следующий общий вызов · строка 164" path=script revision=revision start=164 %}
{% endcapture %}
{% include integrity-lab.html lab="git-glob" previews=integrity_previews %}

Каталог кеша в учебном примере выглядит так:

```text
cache/
├── repository-<revision>.gh.tar.gz
├── another-repository-<revision>.gh.tar.gz
├── example-1.0.0.crate
└── notes.txt
```

`"$work/cache/"` даёт буквальный префикс пути, а `*.gh.tar.gz` находится вне кавычек. Bash раскрывает шаблон **до запуска** `cp`. Каждое найденное имя становится отдельным аргументом, даже если внутри имени есть пробел. Последний аргумент — каталог `"$work/dist/"`. Выбираются все совпавшие имена в `cache/`, независимо от того, какие записи есть в JSON.

При стандартных настройках Bash (`nullglob` и `failglob` выключены) шаблон без совпадений остаётся буквальным. В показанном случае `cp` не находит такой путь, возвращает ненулевой статус и останавливает сценарий. `-n` сохраняет существующий файл назначения без сверки его содержимого. В опыте с GNU coreutils 9.12 пропуск такого файла вернул 0. Код пропуска зависит от версии и реализации `cp`. Исходные файлы остаются в кеше. Ниже Portage получит копии из `dist/`.

## 4.33. Читаем и сравниваем GIT_CRATES {#compare-git-crates}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}sync_metadata() {
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/sync_zed_git_crates.py" --candidate "$candidate" --generated "$work/generated-zed.ebuild" --source "$source_dir" --cache "$work/cache" | tee -a "$GITHUB_STEP_SUMMARY"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Запуск Python и stdout в summary · строки 106–107" path=script revision=revision start=106 %}
{% capture integrity_source %}{% raw %}def block(text: str) -> tuple[int, int, str]:
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if snapshot.GIT_CRATES_START.fullmatch(line.rstrip("\r\n"))]
    if len(starts) != 1:
        raise snapshot.CargoSnapshotError("Expected exactly one GIT_CRATES block.")
    start = starts[0]
    for end in range(start + 1, len(lines)):
        if lines[end].strip() == ")":
            return sum(map(len, lines[:start])), sum(map(len, lines[:end + 1])), "".join(lines[start:end + 1])
    raise snapshot.CargoSnapshotError("Unterminated GIT_CRATES block."){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Поиск границ единственного блока · строки 23–32" path="scripts/sync_zed_git_crates.py" revision=revision start=23 %}
{% capture integrity_source %}{% raw %}def parse_entries(generated: str) -> list[dict[str, str]]:
    _, _, declaration = block(generated)
    snapshot.parse_git_crates(declaration)
    entries = []
    archive_origins: dict[tuple[str, str], str] = {}
    for line in declaration.splitlines()[1:-1]:
        if not line.strip():
            continue
        match = ENTRY.fullmatch(line)
        if not match:
            raise snapshot.CargoSnapshotError("Malformed generated entry.")
        name, value = match.groups()
        repository, commit, unpack = value.split(";")
        repo = REPO.fullmatch(repository)
        if (not NAME.fullmatch(name) or not repo or not SHA.fullmatch(commit) or
                repo.group(1) in ('.', '..') or repo.group(2) in ('.', '..')):
            raise snapshot.CargoSnapshotError(f"Unsupported generated entry: {name!r}.")
        repo_name = repo.group(2)
        if repo_name.endswith('.git'):
            raise snapshot.CargoSnapshotError(f"Unsupported repository spelling: {repository!r}.")
        archive_key = (repo_name, commit)
        if archive_key in archive_origins and archive_origins[archive_key] != repository:
            raise snapshot.CargoSnapshotError(f"Conflicting Git archive names for {name!r}.")
        archive_origins[archive_key] = repository
        components = unpack.split('/')
        if (not components or components[0] != f"{repo_name}-%commit%" or
                any(not PART.fullmatch(p) or p in ('.', '..') for p in components[1:])):
            raise snapshot.CargoSnapshotError(f"Unsafe unpack path for {name!r}: {unpack!r}.")
        entries.append({'name': name, 'repository': repository, 'revision': commit, 'unpack_path': unpack})
    return entries{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Ограничения сгенерированных записей · строки 35–64" path="scripts/sync_zed_git_crates.py" revision=revision start=35 %}
{% capture integrity_source %}{% raw %}def validate_sources(generated: str, source: Path, cache: Path) -> dict[str, snapshot.GitCrate]:
    _, _, declaration = block(generated)
    entries = parse_entries(declaration)
    crates = snapshot.parse_git_crates(declaration)
    errors = snapshot.compare_snapshots(snapshot.parse_lock(source / "Cargo.lock"), crates)
    if errors:
        raise snapshot.CargoSnapshotError("\n".join(errors))
    for entry in entries:{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Разбор нового блока и проверка по lock · строки 75–82" path="scripts/sync_zed_git_crates.py" revision=revision start=75 %}
{% capture integrity_source %}{% raw %}def parse_git_crates(ebuild_text: str) -> dict[str, GitCrate]:
    """Read the simple associative-array form emitted by the ebuild."""
    lines = ebuild_text.splitlines()
    try:
        start = next(index for index, line in enumerate(lines) if GIT_CRATES_START.fullmatch(line))
    except StopIteration as error:
        raise CargoSnapshotError("Missing declare -A GIT_CRATES block.") from error

    crates: dict[str, GitCrate] = {}
    for line in lines[start + 1 :]:
        if line.strip() == ")":
            if not crates:
                raise CargoSnapshotError("GIT_CRATES block is empty.")
            return crates
        if not line.strip():
            continue
        match = GIT_CRATE_ENTRY.fullmatch(line)
        if match is None:
            raise CargoSnapshotError(f"Malformed GIT_CRATES entry: {line.strip()!r}.")
        name, value = match.groups()
        parts = value.split(";")
        if len(parts) != 3 or not all(parts):
            raise CargoSnapshotError(f"Malformed GIT_CRATES entry for {name!r}.")
        repository, commit, _unpack_path = parts
        if not COMMIT.fullmatch(commit):
            raise CargoSnapshotError(f"Malformed GIT_CRATES commit for {name!r}: {commit!r}.")
        if name in crates:
            raise CargoSnapshotError(f"Duplicate GIT_CRATES entry for {name!r}.")
        crates[name] = GitCrate(canonical_repository(repository), commit)
    raise CargoSnapshotError("Unterminated GIT_CRATES block."){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Чтение ассоциативного массива как текста · строки 104–133" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=104 %}
{% capture integrity_source %}{% raw %}def parse_lock(path: Path) -> dict[str, GitCrate]:
    try:
        with path.open("rb") as lock_file:
            lock = tomllib.load(lock_file)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise CargoSnapshotError(f"Could not parse {path}.") from error

    packages = lock.get("package")
    if not isinstance(packages, list):
        raise CargoSnapshotError("Cargo.lock has no package list.")
    crates: dict[str, GitCrate] = {}
    for package in packages:
        if not isinstance(package, dict):
            raise CargoSnapshotError("Cargo.lock has a malformed package entry.")
        source = package.get("source")
        if source is None:
            continue
        name = package.get("name")
        if not isinstance(name, str) or not isinstance(source, str):
            raise CargoSnapshotError("Cargo.lock has a malformed package source.")
        if not source.startswith("git+"):
            continue
        repository_and_query, separator, commit = source[4:].partition("#")
        if not separator or not COMMIT.fullmatch(commit):
            raise CargoSnapshotError(f"Malformed Git source for {name!r}: {source!r}.")
        repository = repository_and_query.split("?", 1)[0]
        crate = GitCrate(canonical_repository(repository), commit)
        existing = crates.get(name)
        if existing is not None and existing != crate:
            raise CargoSnapshotError(f"Cargo.lock has conflicting Git sources for {name!r}.")
        crates[name] = crate
    return crates{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Git-записи из Cargo.lock · строки 136–167" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=136 %}
{% capture integrity_source %}{% raw %}def compare_snapshots(upstream: dict[str, GitCrate], ebuild: dict[str, GitCrate]) -> list[str]:
    errors: list[str] = []
    # Сверяем по имени crate, чтобы отдельно показать добавление или удаление
    # зависимости, а также несовпадение URL репозитория или commit.
    for name in sorted(upstream.keys() - ebuild.keys()):
        errors.append(f"{name}: upstream Git dependency is missing from GIT_CRATES.")
    for name in sorted(ebuild.keys() - upstream.keys()):
        errors.append(f"{name}: GIT_CRATES entry is absent from upstream Cargo.lock.")
    for name in sorted(upstream.keys() & ebuild.keys()):
        upstream_crate = upstream[name]
        ebuild_crate = ebuild[name]
        if upstream_crate.repository != ebuild_crate.repository:
            errors.append(
                f"{name}: repository differs (upstream {upstream_crate.repository}, "
                f"ebuild {ebuild_crate.repository})."
            )
        if upstream_crate.commit != ebuild_crate.commit:
            errors.append(
                f"{name}: revision differs (upstream {upstream_crate.commit}, "
                f"ebuild {ebuild_crate.commit})."
            )
    return errors{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Сверка двух снимков · строки 261–282" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=261 %}
{% endcapture %}
{% include integrity-lab.html lab="git-compare" previews=integrity_previews %}

`--candidate` указывает на сопровождаемый ebuild, который готовится к проверке. `--generated` указывает на файл, полученный от генератора или восстановленный из metadata при reuse. `--source` даёт путь к извлечённым upstream-исходникам, а `--cache` — к Git-архивам. Python пишет итоговые строки в stdout, который `tee -a` выводит в журнал и дописывает в summary. Ошибки Python идут в stderr. Применяются [те же правила конвейера и pipefail]({{ previous }}#streams).

Пример ниже вымышленный:

```bash
declare -A GIT_CRATES=(
    [example]='https://github.com/example/repository;0123456789abcdef0123456789abcdef01234567;repository-%commit%/crates/example'
)
```

В ассоциативном массиве `declare -A` ключ `example` обозначает имя crate. Строка содержит три поля, разделённые точками с запятой: URL репозитория, Git-ревизию и путь после распаковки. `%commit%` в пути подставляется позднее. Python читает эту простую форму как текст, без `source` и исполнения ebuild.

`block` требует один заголовок декларации и ищет закрывающую строку `)`. `parse_git_crates` читает записи по имени и отвергает дубликаты. `parse_entries` дополнительно ограничивает форму сгенерированных имён, URL, полного 40-символьного SHA и пути. Корень пути имеет вид `repository-%commit%`, а компоненты `.` и `..` запрещены. `parse_lock` берёт из TOML только источники `git+`, отделяет ревизию после `#` и убирает query. Канонизация URL нормализует регистр схемы и хоста, завершающий слеш и суффикс `.git`.

`compare_snapshots` сверяет по имени crate отсутствующие, лишние и общие записи. Для общих записей сверяются канонический URL и ревизия. На этом шаге с lock сверяется **generated**. Устаревший блок кандидата ожидаем при обновлении. Его можно заменить, если новый снимок проходит проверки. Если отстаёт уже generated, синхронизация останавливается. Зависимости Cargo заново не разрешаются, граф features здесь не строится. При расхождении в generated диагностика содержит обе стороны, например `example: repository differs (upstream https://github.com/example/renamed, ebuild https://github.com/example/repository).` Для ревизии применяется формат `revision differs (upstream …, ebuild …)`.

## 4.34. Проверяем Git archives и Cargo.toml {#validate-git-archives}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}def validate_sources(generated: str, source: Path, cache: Path) -> dict[str, snapshot.GitCrate]:
    _, _, declaration = block(generated)
    entries = parse_entries(declaration)
    crates = snapshot.parse_git_crates(declaration)
    errors = snapshot.compare_snapshots(snapshot.parse_lock(source / "Cargo.lock"), crates)
    if errors:
        raise snapshot.CargoSnapshotError("\n".join(errors))
    for entry in entries:
        name, repository, commit, unpack = (entry[k] for k in ('name', 'repository', 'revision', 'unpack_path'))
        repo_name = repository.rsplit('/', 1)[1]
        archive = cache / f"{repo_name}-{commit}.gh.tar.gz"
        member_name = str(PurePosixPath(unpack.replace('%commit%', commit)) / 'Cargo.toml')
        try:
            with tarfile.open(archive, 'r:gz') as tar:
                matches = [m for m in tar if m.name == member_name]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 2_000_000:
                    raise snapshot.CargoSnapshotError(f"Invalid Cargo.toml for {name!r} in {archive.name}.")
                f = tar.extractfile(matches[0])
                assert f is not None
                manifest = tomllib.loads(f.read().decode('utf-8'))
                if manifest.get('package', {}).get('name') != name:
                    raise snapshot.CargoSnapshotError(f"Crate identity mismatch for {name!r}.")
        except (OSError, tarfile.TarError, UnicodeError, tomllib.TOMLDecodeError) as error:
            raise snapshot.CargoSnapshotError(f"Cannot validate source for {name!r}: {error}") from error
    return crates{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Проверки Git-снимка и Cargo.toml в кеше · строки 75–99" path="scripts/sync_zed_git_crates.py" revision=revision start=75 %}
{% endcapture %}
{% include integrity-lab.html lab="git-member" previews=integrity_previews %}

Для каждой записи `validate_sources` берёт последний компонент URL и добавляет ревизию, получая имя кеша `repository-<revision>.gh.tar.gz`. Затем заменяет `%commit%` в пути распаковки и добавляет `Cargo.toml`. Среди элементов tar должно быть ровно одно совпадение с этим именем. Оно должно быть обычным файлом размером не больше 2 000 000 байт.

Далее Python читает этот элемент, декодирует UTF-8, разбирает TOML и сверяет `package.name` с ключом из `GIT_CRATES`. Лаборатория продолжает пример с crate `example`. Формат системной части сообщения об отсутствующем архиве зависит от переданного пути и окружения. Формат диагностики TOML может зависеть от версии Python. Проверка устанавливает согласованность ожидаемого манифеста с записью crate. Полнота прочих элементов и соответствие всего архива дереву указанного Git-коммита здесь не проверяются.

## 4.35. Обновляем блок GIT_CRATES в кандидате {#replace-git-block}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}def sync(candidate: Path, generated: Path, source: Path, cache: Path) -> int:
    generated_text = snapshot.read_text(generated)
    crates = validate_sources(generated_text, source, cache)
    original = snapshot.read_text(candidate)
    start, end, _ = block(original)
    _, _, replacement = block(generated_text)
    updated = original[:start] + replacement + original[end:]
    # All validation happens before writing. Offline substitutions remain curated.
    snapshot.parse_offline_substitutions(updated, crates)
    tmp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=candidate.parent, delete=False) as f:
            tmp = Path(f.name)
            f.write(updated)
        snapshot.validate(tmp, source)
        os.chmod(tmp, candidate.stat().st_mode & 0o777)
        tmp.replace(candidate)
    finally:
        if tmp is not None and tmp.exists():
            tmp.unlink()
    return len(crates){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Сборка, валидация и замена кандидата · строки 102–122" path="scripts/sync_zed_git_crates.py" revision=revision start=102 %}
{% capture integrity_source %}{% raw %}def block(text: str) -> tuple[int, int, str]:
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if snapshot.GIT_CRATES_START.fullmatch(line.rstrip("\r\n"))]
    if len(starts) != 1:
        raise snapshot.CargoSnapshotError("Expected exactly one GIT_CRATES block.")
    start = starts[0]
    for end in range(start + 1, len(lines)):
        if lines[end].strip() == ")":
            return sum(map(len, lines[:start])), sum(map(len, lines[:end + 1])), "".join(lines[start:end + 1])
    raise snapshot.CargoSnapshotError("Unterminated GIT_CRATES block."){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Диагностика границ блока · строки 23–32" path="scripts/sync_zed_git_crates.py" revision=revision start=23 %}
{% endcapture %}
{% include integrity-lab.html lab="candidate-replace" previews=integrity_previews %}

<figure class="figure lesson-figure">
  <figcaption>Как новый блок попадает в сопровождаемый ebuild · условные фрагменты</figcaption>
  <div class="integrity-panels integrity-candidate">
    <div class="workspace">
      <strong>Существующий candidate</strong>
      <pre>Заголовок · EAPI · сведения о пакете
<mark>declare -A GIT_CRATES=(… прежние записи …)</mark>
Зависимости · Wayland patch · LICENSE · SRC_URI
Функции подготовки и сборки</pre>
    </div>
    <div class="workspace">
      <strong>generated-zed.ebuild</strong>
      <pre><mark>declare -A GIT_CRATES=(… новые записи …)</mark>
Сгенерированные сведения о лицензиях</pre>
    </div>
    <p class="crates-edge crates-converge">↓ Префикс и суффикс из кандидата + блок из generated ↓</p>
    <div class="workspace integrity-output">
      <strong>Подготовленный текст кандидата</strong>
      <pre>Заголовок · EAPI · сведения о пакете
<mark>declare -A GIT_CRATES=(… новые записи …)</mark>
Зависимости · Wayland patch · LICENSE · SRC_URI
Функции подготовки и сборки</pre>
    </div>
  </div>
</figure>

`sync` читает и проверяет generated, затем находит границы декларации в обоих текстах. Из кандидата берутся префикс и суффикс, между ними вставляется только новый блок. Полученный текст сначала проверяется на совместимость с ручными offline substitutions.

Временный файл создаётся рядом с кандидатом, в `candidate.parent`. В него записывается текст UTF-8, после чего `snapshot.validate` проверяет временный ebuild по upstream. Строка с `chmod` копирует обычные биты доступа через маску `0o777`. Содержимое кандидата меняется на `tmp.replace(candidate)`. При отказе проверки до этой строки исходный текст в контролируемом сценарии сохраняется. `finally` удаляет временный файл, если он остался. В успешном сценарии временное имя исчезает при переименовании.

Эта операция относится к одному файлу и одному моменту замены. Сохранение всех атрибутов, исходного байтового представления переводов строк и устойчивость к аварийному отключению здесь не гарантируются. Последующие запись сводки и правка `SRC_URI` выполняются отдельно.

## 4.36. Сохраняем offline substitutions и WebRTC pin {#curated-offline-substitutions}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}	git_crate_commit() {
		local crate="$1"
		local output_variable="$2"
		local value="${GIT_CRATES[${crate}]}"
		local repository remainder commit unpack_path

		[[ -n "${crate}" && -n "${output_variable}" && -n "${value}" ]] \
			|| die "Missing GIT_CRATES entry for ${crate}"
		repository="${value%%;*}"
		remainder="${value#*;}"
		commit="${remainder%%;*}"
		unpack_path="${remainder#*;}"
		[[ -n "${repository}" && "${remainder}" != "${value}" \
			&& -n "${commit}" && "${unpack_path}" != "${remainder}" \
			&& -n "${unpack_path}" && "${unpack_path}" != *";"* \
			&& "${commit}" =~ ^[0-9a-f]{7,64}$ ]] \
			|| die "Malformed GIT_CRATES entry for ${crate}"
		printf -v "${output_variable}" '%s' "${commit}"
	}

	local ASYNC_PROCESS_COMMIT
	git_crate_commit async-process ASYNC_PROCESS_COMMIT
	local ASYNC_PROCESS_GIT="async-process = { git = \"https://github.com/zed-industries/async-process.git\", rev = \"${ASYNC_PROCESS_COMMIT}\""
	local ASYNC_PROCESS_PATH="async-process = { path = \"${WORKDIR}/async-process-${ASYNC_PROCESS_COMMIT}\""{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Реальный пример git_crate_commit в ebuild Zed 1.29.2 · строки 207–230" path="app-editors/zed/zed-1.29.2.ebuild" revision="e3523562379eaf24e05e73107d5f18fdacdcede7" start=207 %}
{% capture integrity_source %}{% raw %}    updated = original[:start] + replacement + original[end:]
    # All validation happens before writing. Offline substitutions remain curated.
    snapshot.parse_offline_substitutions(updated, crates)
    tmp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=candidate.parent, delete=False) as f:
            tmp = Path(f.name)
            f.write(updated)
        snapshot.validate(tmp, source)
        os.chmod(tmp, candidate.stat().st_mode & 0o777)
        tmp.replace(candidate){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Два места проверки до замены ebuild · строки 108–118" path="scripts/sync_zed_git_crates.py" revision=revision start=108 %}
{% capture integrity_source %}{% raw %}def parse_offline_substitutions(
    ebuild_text: str, git_crates: dict[str, GitCrate]
) -> list[OfflineSubstitution]:
    """Validate the existing explicit local Cargo replacement convention."""
    variables: dict[str, str] = {}
    # Ebuild не выполняем: читаем только известную форму local assignments,
    # чтобы проверить pins без запуска команд из файла.
    for line in ebuild_text.splitlines():
        match = LOCAL_ASSIGNMENT.fullmatch(line)
        if match is not None:
            name, value = match.groups()
            if name in variables:
                raise CargoSnapshotError(f"Duplicate local variable {name!r}.")
            variables[name] = value

    for line in ebuild_text.splitlines():
        match = GIT_CRATE_COMMIT_ASSIGNMENT.fullmatch(line)
        if match is None:
            continue
        crate, name = match.groups()
        try:
            variables[name] = git_crates[crate].commit
        except KeyError as error:
            raise CargoSnapshotError(
                f"Offline commit {name!r} references missing GIT_CRATES entry {crate!r}."
            ) from error{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Чтение локальных присваиваний и commit variables · строки 195–220" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=195 %}
{% capture integrity_source %}{% raw %}    substitutions: list[OfflineSubstitution] = []
    for name, raw_declaration in variables.items():
        if not name.endswith("_GIT"):
            continue
        stem = name.removesuffix("_GIT")
        declaration = expand_variables(raw_declaration, variables, name)
        match = GIT_DECLARATION.fullmatch(declaration)
        if match is None:
            raise CargoSnapshotError(f"Malformed offline Git declaration {name!r}.")
        crate, repository, declared_commit = match.groups()
        commit_variables = VARIABLE.findall(raw_declaration)
        if not commit_variables:
            commit_variable = f"{stem}_COMMIT"
        elif len(commit_variables) == 1 and commit_variables[0].endswith("_COMMIT"):
            commit_variable = commit_variables[0]
        else:
            raise CargoSnapshotError(f"Offline Git declaration {name!r} has no single commit variable.")
        commit = variables.get(commit_variable)
        if commit is None or not COMMIT.fullmatch(commit):
            raise CargoSnapshotError(f"Malformed offline commit for {name!r}.")
        if declared_commit is not None and declared_commit != commit:
            raise CargoSnapshotError(f"Offline Git declaration {name!r} disagrees with its commit variable.")

        path_variable = f"{stem}_PATH"
        try:
            path_declaration = expand_variables(
                variables[path_variable], variables, path_variable, allow_external=True
            )
        except KeyError as error:
            raise CargoSnapshotError(f"Missing offline path declaration {path_variable!r}.") from error
        path_match = PATH_DECLARATION.fullmatch(path_declaration)
        if path_match is None or path_match.group(1) != crate or commit not in path_match.group(2):
            raise CargoSnapshotError(f"Malformed offline path declaration {path_variable!r}.")
        substitutions.append(
            OfflineSubstitution(crate, canonical_repository(repository), commit, declaration)
        )
    return substitutions{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Формы Git- и path-деклараций · строки 222–258" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=222 %}
{% capture integrity_source %}{% raw %}def parse_webrtc_commit(ebuild_text: str) -> str:
    """Read the single explicit WebRTC prebuilt pin from the ebuild."""
    assignments = [
        line for line in ebuild_text.splitlines() if re.match(r"^\s*WEBRTC_COMMIT\s*=", line)
    ]
    if not assignments:
        raise CargoSnapshotError("Missing WEBRTC_COMMIT assignment.")
    if len(assignments) != 1:
        raise CargoSnapshotError("WEBRTC_COMMIT is defined more than once.")
    match = WEBRTC_COMMIT_ASSIGNMENT.fullmatch(assignments[0])
    if match is None or not WEBRTC_COMMIT_VALUE.fullmatch(match.group(1)):
        raise CargoSnapshotError("Malformed WEBRTC_COMMIT assignment.")
    return match.group(1)


def parse_upstream_webrtc_version(path: Path) -> str:
    """Read the WebRTC prebuilt version from the exact upstream source tree."""
    try:
        with path.open("rb") as corgi_file:
            corgi_toml = tomllib.load(corgi_file)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise CargoSnapshotError(f"Could not parse {path}.") from error
    tools = corgi_toml.get("tools")
    if not isinstance(tools, dict):
        raise CargoSnapshotError("corgi.toml has no tools table.")
    webrtc_prebuilt = tools.get("webrtc-prebuilt")
    if not isinstance(webrtc_prebuilt, dict):
        raise CargoSnapshotError("corgi.toml has no tools.webrtc-prebuilt table.")
    version = webrtc_prebuilt.get("version")
    if not isinstance(version, str) or not version:
        raise CargoSnapshotError("corgi.toml has no non-empty tools.webrtc-prebuilt.version.")
    return version{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Чтение WebRTC pin из двух файлов · строки 57–88" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=57 %}
{% capture integrity_source %}{% raw %}def validate(ebuild_path: Path, source_path: Path) -> None:
    """Validate a candidate ebuild against one exact extracted upstream source tree."""
    ebuild_text = read_text(ebuild_path)
    webrtc_commit = parse_webrtc_commit(ebuild_text)
    upstream_webrtc_version = parse_upstream_webrtc_version(source_path / "corgi.toml")
    lock_crates = parse_lock(source_path / "Cargo.lock")
    ebuild_crates = parse_git_crates(ebuild_text)
    errors = compare_snapshots(lock_crates, ebuild_crates)
    if webrtc_commit != upstream_webrtc_version:
        errors.append(
            "WEBRTC_COMMIT differs from upstream corgi.toml\n"
            f"ebuild: {webrtc_commit}\n"
            f"upstream: {upstream_webrtc_version}"
        )

    cargo_toml_path = source_path / "Cargo.toml"
    validate_cargo_toml(cargo_toml_path)
    cargo_toml = read_text(cargo_toml_path)
    for substitution in parse_offline_substitutions(ebuild_text, ebuild_crates):
        if substitution.declaration not in cargo_toml:
            errors.append(
                f"{substitution.crate}: expected offline Git declaration is absent from upstream Cargo.toml."
            )
    if errors:
        raise CargoSnapshotError("\n".join(errors)){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Проверка временного кандидата · строки 285–309" path="scripts/check_zed_cargo_snapshot.py" revision=revision start=285 %}
{% endcapture %}
{% include integrity-lab.html lab="offline-boundary" previews=integrity_previews %}

Ebuild использует `git_crate_commit crate VARIABLE`, чтобы взять ревизию из записи массива и присвоить её переменной. В Python та же поддерживаемая строка читается регулярным выражением. Для подходящих `local NAME="…"` собираются значения, повторные имена отвергаются. При обработке `git_crate_commit` переменная получает ревизию crate из нового снимка и возникает ошибка, если записи уже нет.

Для каждой переменной `*_GIT` раскрываются известные переменные и проверяется форма Git-декларации. Без ссылки на переменную в строке используется `<stem>_COMMIT`. Иначе допустима одна ссылка с именем на `_COMMIT`. Ревизия должна подходить под формат, а явный `rev` должен с ней совпасть. Парная `<stem>_PATH` должна существовать, иметь поддерживаемую форму, указывать то же имя crate и содержать ревизию в пути. Внешние переменные вроде `${WORKDIR}` в path-декларации могут остаться нераскрытыми.

На временном файле `validate` повторно сверяет Git-снимок с `Cargo.lock`, читает один корректно оформленный `WEBRTC_COMMIT` и сравнивает его с `tools.webrtc-prebuilt.version` из `corgi.toml`. Корневой `Cargo.toml` должен разбираться как TOML. Затем проверяется присутствие ожидаемой Git-декларации как **подстроки** в его тексте. Эти правила рассчитаны на конкретные формы ebuild. Они не разбирают произвольный Bash, не проверяют все отношения между зависимостями и не запускают offline-сборку Cargo.

Автоматически обновляется `GIT_CRATES`. Offline substitutions и `WEBRTC_COMMIT` сопровождает владелец ebuild, а синхронизация проверяет их совместимость. Wayland-only patch и `LICENSE` остаются частью ручной упаковки.

## 4.37. Сравниваем лицензионные термины {#license-term-differences}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}def license_terms(text: str) -> set[str]:
    terms: set[str] = set()
    for match in re.finditer(r'^LICENSE\+?="([^"]*)"', text, re.MULTILINE):
        terms.update(match.group(1).split())
    return terms{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Извлечение терминов LICENSE · строки 125–129" path="scripts/sync_zed_git_crates.py" revision=revision start=125 %}
{% capture integrity_source %}{% raw %}def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--generated', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    args = parser.parse_args()
    try:
        candidate_terms = license_terms(snapshot.read_text(args.candidate))
        generated_terms = license_terms(snapshot.read_text(args.generated))
        count = sync(args.candidate, args.generated, args.source, args.cache)
        print(f'Git dependency count: {count}')
        print('Generated-only licenses for review: ' + json.dumps(sorted(generated_terms - candidate_terms)))
        print('Candidate-only licenses for review: ' + json.dumps(sorted(candidate_terms - generated_terms)))
    except (OSError, ValueError, snapshot.CargoSnapshotError) as error:
        print(f'Git synchronization failed: {error}', file=sys.stderr)
        return 1
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Чтение, синхронизация и отчёт · строки 132–149" path="scripts/sync_zed_git_crates.py" revision=revision start=132 %}
{% capture integrity_source %}{% raw %}  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/sync_zed_git_crates.py" --candidate "$candidate" --generated "$work/generated-zed.ebuild" --source "$source_dir" --cache "$work/cache" | tee -a "$GITHUB_STEP_SUMMARY"{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Отчёт Python и tee · строка 107" path=script revision=revision start=107 %}
{% endcapture %}
{% include integrity-lab.html lab="license-sets" previews=integrity_previews %}

CLI читает оба текста до вызова `sync`. `license_terms` находит регулярным выражением поддерживаемые присваивания `LICENSE="…"` и `LICENSE+="…"`, разбивает захваченные значения по пробельным символам и собирает множества. После успешной синхронизации печатается число Git-зависимостей и обе разности. Каждая разность сортируется и сериализуется в JSON, поэтому порядок отчёта устойчив.

Это анализ текстовых терминов. Он не охватывает все варианты многострочных и динамически построенных присваиваний и не проверяет семантическую эквивалентность Gentoo LICENSE-выражений. В [фазе 4.2](#distribution-metadata) `license_expressions` сохраняет нормализованные выражения целиком для JSON. Здесь разности служат подсказкой сопровождающему. Они сами по себе не делают запуск неуспешным и не заменяют `LICENSE` кандидата.

## 4.38. Обновляем SRC_URI {#migrate-crates-uri}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" rewrite-uri "$candidate"
}{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Команда rewrite-uri · строки 108–109" path=script revision=revision start=108 %}
{% capture integrity_source %}{% raw %}LEGACY_URI = 'https://github.com/gentoo-crate-dist/zed/releases/download/v${PV/_/-}/${P/_/-}-crates.tar.xz'
OVERLAY_URI = 'https://github.com/vovanbl411/zed-overlay/releases/download/crates-v${PV/_/-}/${P/_/-}-overlay-crates.tar.xz'
SOURCE_URI = 'https://github.com/zed-industries/zed/archive/refs/tags/v${PV/_/-}.tar.gz -> ${P}.tar.gz'{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Точные текстовые формы URI · строки 21–23" path="scripts/crates_distribution.py" revision=revision start=21 %}
{% capture integrity_source %}{% raw %}def validate_uri(text: str, *, allow_legacy: bool) -> None:
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
{% include source-preview.html source=integrity_source label="Проверки поддерживаемого SRC_URI · строки 138–152" path="scripts/crates_distribution.py" revision=revision start=138 %}
{% capture integrity_source %}{% raw %}def rewrite_uri(candidate: Path) -> None:
    text = candidate.read_text(encoding='utf-8')
    validate_uri(text, allow_legacy=True)
    updated = text.replace(LEGACY_URI, OVERLAY_URI)
    if 'gentoo-crate-dist/zed' in updated:
        raise ValueError('Unexpected legacy crates source')
    validate_uri(updated, allow_legacy=False)
    candidate.write_text(updated, encoding='utf-8'){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Порядок переписывания · строки 155–162" path="scripts/crates_distribution.py" revision=revision start=155 %}
{% capture integrity_source %}{% raw %}    rewrite = sub.add_parser('rewrite-uri')
    rewrite.add_argument('candidate', type=Path){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Аргумент CLI rewrite-uri · строки 216–217" path="scripts/crates_distribution.py" revision=revision start=216 %}
{% capture integrity_source %}{% raw %}        elif args.action == 'rewrite-uri':
            rewrite_uri(args.candidate){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Вызов rewrite_uri · строки 233–234" path="scripts/crates_distribution.py" revision=revision start=233 %}
{% capture integrity_source %}{% raw %}    except (OSError, ValueError, KeyError, json.JSONDecodeError, snapshot.CargoSnapshotError, release_handoff.HandoffError) as error:
        print(f'Distribution validation failed: {error}', file=sys.stderr)
        return 1
    print(f'Distribution {args.action}: OK')
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Результат CLI · строки 240–244" path="scripts/crates_distribution.py" revision=revision start=240 %}
{% endcapture %}
{% include integrity-lab.html lab="uri-migrate" previews=integrity_previews %}

В исходнике выше `LEGACY_URI` указывает на registry crates из прежнего хранилища gentoo-crate-dist, `OVERLAY_URI` — на registry crates из релиза оверлея. `SOURCE_URI` указывает на архив исходников самого Zed и задаёт его имя после `->`. Он должен остаться в блоке. В [разделе 4.10](#download) уже показано, почему запись содержит буквальные `${PV/_/-}` и `${P}`. На этом шаге Python сравнивает строки, а раскрытие переменных и оценка ebuild относятся к Portage.

После чтения UTF-8 текста валидатор требует одно распознаваемое присваивание и один простой блок `SRC_URI="…"` с точной строкой upstream-архива. Он считает вхождения обеих crates-строк во всём тексте. Допустима одна legacy-строка или одна overlay-строка, причём нужный URI должен быть отдельной строкой внутри блока. После замены в памяти проверяется отсутствие оставшихся `gentoo-crate-dist/zed` и повторно проверяется структура с разрешённым только overlay URI. Лишь затем вызывается `write_text`.

С валидным уже мигрированным URI команда также вызывает `write_text`, записывая тот же текст. Успех печатает `Distribution rewrite-uri: OK`. Проверка касается формы поддерживаемого простого присваивания, а наличие удалённого asset не проверяется. При generation архив может пока существовать только локально.

Здесь используется прямая запись. Если проверка URI останавливается с ошибкой, уже завершённая замена блока `GIT_CRATES` остаётся в кандидате.

## 4.39. Завершаем синхронизацию метаданных {#metadata-synchronization-flow}

{% capture integrity_previews %}
{% capture integrity_source %}{% raw %}timed 'Metadata and source integrity validation' verify_inputs
timed 'GIT_CRATES synchronization' sync_metadata
timed 'Candidate validation' validate_candidate{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Граница общей проверки, синхронизации и следующего этапа · строки 163–165" path=script revision=revision start=163 %}
{% capture integrity_source %}{% raw %}verify_inputs() {
  test "$(sha256sum "$source_dir/Cargo.lock" | cut -d' ' -f1)" = "$lock_hash"
  mkdir "$work/source-verify"
  tar -xzf "$source_archive" -C "$work/source-verify"
  diff -qr --no-dereference "$source_dir" "$work/source-verify/zed-${version}"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" identity \
    --version "$version" --commit "$upstream_commit" --source-archive "$source_archive" \
    --lock "$source_dir/Cargo.lock" --archive "$archive" --metadata "$metadata"
  cp -n "$work/cache/"*.gh.tar.gz "$work/dist/"
}

sync_metadata() {
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/sync_zed_git_crates.py" --candidate "$candidate" --generated "$work/generated-zed.ebuild" --source "$source_dir" --cache "$work/cache" | tee -a "$GITHUB_STEP_SUMMARY"
  PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_distribution.py" rewrite-uri "$candidate"
}{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Общие функции · строки 95–109" path=script revision=revision start=95 %}
{% capture integrity_source %}{% raw %}def validate_sources(generated: str, source: Path, cache: Path) -> dict[str, snapshot.GitCrate]:
    _, _, declaration = block(generated)
    entries = parse_entries(declaration)
    crates = snapshot.parse_git_crates(declaration)
    errors = snapshot.compare_snapshots(snapshot.parse_lock(source / "Cargo.lock"), crates)
    if errors:
        raise snapshot.CargoSnapshotError("\n".join(errors))
    for entry in entries:{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Сверка сгенерированного Git-снимка · строки 75–82" path="scripts/sync_zed_git_crates.py" revision=revision start=75 %}
{% capture integrity_source %}{% raw %}def sync(candidate: Path, generated: Path, source: Path, cache: Path) -> int:
    generated_text = snapshot.read_text(generated)
    crates = validate_sources(generated_text, source, cache)
    original = snapshot.read_text(candidate)
    start, end, _ = block(original)
    _, _, replacement = block(generated_text)
    updated = original[:start] + replacement + original[end:]
    # All validation happens before writing. Offline substitutions remain curated.
    snapshot.parse_offline_substitutions(updated, crates)
    tmp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=candidate.parent, delete=False) as f:
            tmp = Path(f.name)
            f.write(updated)
        snapshot.validate(tmp, source)
        os.chmod(tmp, candidate.stat().st_mode & 0o777)
        tmp.replace(candidate)
    finally:
        if tmp is not None and tmp.exists():
            tmp.unlink()
    return len(crates){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Состояние кандидата при замене · строки 102–122" path="scripts/sync_zed_git_crates.py" revision=revision start=102 %}
{% capture integrity_source %}{% raw %}        candidate_terms = license_terms(snapshot.read_text(args.candidate))
        generated_terms = license_terms(snapshot.read_text(args.generated))
        count = sync(args.candidate, args.generated, args.source, args.cache)
        print(f'Git dependency count: {count}')
        print('Generated-only licenses for review: ' + json.dumps(sorted(generated_terms - candidate_terms)))
        print('Candidate-only licenses for review: ' + json.dumps(sorted(candidate_terms - generated_terms)))
    except (OSError, ValueError, snapshot.CargoSnapshotError) as error:
        print(f'Git synchronization failed: {error}', file=sys.stderr)
        return 1
    return 0{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Отчёт после замены · строки 140–149" path="scripts/sync_zed_git_crates.py" revision=revision start=140 %}
{% capture integrity_source %}{% raw %}def validate_uri(text: str, *, allow_legacy: bool) -> None:
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
        raise ValueError('Candidate crates URL is not an SRC_URI entry')


def rewrite_uri(candidate: Path) -> None:
    text = candidate.read_text(encoding='utf-8')
    validate_uri(text, allow_legacy=True)
    updated = text.replace(LEGACY_URI, OVERLAY_URI)
    if 'gentoo-crate-dist/zed' in updated:
        raise ValueError('Unexpected legacy crates source')
    validate_uri(updated, allow_legacy=False)
    candidate.write_text(updated, encoding='utf-8'){% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Проверки и запись URI · строки 138–162" path="scripts/crates_distribution.py" revision=revision start=138 %}
{% endcapture %}
{% include integrity-lab.html lab="integrity-flow" previews=integrity_previews %}

В этой лаборатории PASS означает завершённый шаг, FAIL — первый отказ, SKIP — шаг, до которого Bash не дошёл. Успешный `sync` может заменить блок кандидата до завершения `tee`. Например, если путь summary — каталог, `tee` выдаёт ошибку открытия, но продолжает читать поток и писать в stdout. Python может завершиться с 0, а весь конвейер с `pipefail` вернёт 1 из-за `tee`. При `errexit` команда `rewrite-uri` тогда пропускается. Так же отдельно может отказать сам `rewrite-uri`, уже после успешной записи сводки. Оба случая оставляют завершённое обновление `GIT_CRATES` на диске.

В успешном состоянии у кандидата новый `GIT_CRATES` и overlay crates URI, ручная логика упаковки сохранена, копии Git-архивов доступны в `dist/`. Исходный Manifest ещё не перегенерирован. Строка 165 открывает следующий этап.

{% capture integrity_source %}{% raw %}timed 'Candidate validation' validate_candidate{% endraw %}{% endcapture %}
{% include source-preview.html source=integrity_source label="Следующая команда · строка 165" path=script revision=revision start=165 open=true %}

## 4.40. От подготовленного кандидата к Portage {#portage-candidate}

К строке 165 обе предыдущие функции завершились успешно. `verify_inputs()` проверила входы и скопировала Git-архивы в `dist/`. `sync_metadata()` обновила `GIT_CRATES` и URI crates-архива в `SRC_URI` ebuild из одноразовой копии overlay. Manifest ещё ждёт генерации. Теперь `validate_candidate()` сохраняет его исходное содержимое и готовит среду, в которой Portage прочитает обновлённый ebuild.

{% capture portage_launch %}{% raw %}validate_candidate() {
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
    "$GENTOO_STAGE3_IMAGE" /bin/bash -euo pipefail -c '{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_launch label="Запуск контейнера · строки 111–122" path=script revision=revision start=111 open=true %}

## 4.41. Сохраняем исходный Manifest {#portage-manifest-copy}

{% capture portage_copy %}{% raw %}validate_candidate() {
  cp "$overlay/app-editors/zed/Manifest" "$work/original-Manifest"{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_copy label="Начало функции и копирование · строки 111–112" path=script revision=revision start=111 open=true %}

`cp` сохраняет содержимое `$overlay/app-editors/zed/Manifest` в `$work/original-Manifest` до запуска Docker. После подключения `$work` эта копия доступна внутри контейнера как `/experiment/original-Manifest`. Она нужна для сравнения с Manifest после генерации. Если исходный файл нельзя прочитать или копию нельзя записать, внешний Bash останавливается на `cp`.

В модели будущее состояние предполагает, что команда генерации позже завершилась успешно. Правила сравнения рассмотрим в фазе 4.5.

{% capture portage_previews %}{% include source-preview.html source=portage_copy label="Копирование · строки 111–112" path=script revision=revision start=111 %}{% endcapture %}
{% include integrity-lab.html lab="portage-manifest" data=site.data.portage_labs previews=portage_previews %}

## 4.42. Передаём том Portage во временный контейнер {#portage-donor}

{% capture portage_donor %}{% raw %}  docker run --rm --volumes-from zed-independent-portage \{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_donor label="Docker run и тома донора · строка 113" path=script revision=revision start=113 open=true %}

В [4.15](#prepare-portage) команда `docker create` уже создала `zed-independent-portage`. Донор может оставаться остановленным. `docker run` создаёт и запускает другой контейнер, из образа по ссылке в `$GENTOO_STAGE3_IMAGE`. Здесь потребителем является stage3. Флаг `--volumes-from zed-independent-portage` подключает тома донора по их путям в контейнере. Скрипт ожидает дерево Gentoo в `/var/db/repos/gentoo`: оттуда он ранее читал таблицу лицензий, и этот же путь укажет в `repos.conf`. Закреплённые образы локально отсутствовали, поэтому размещение дерева описано по контракту скрипта. [Справка Docker по `--volumes-from`](https://docs.docker.com/reference/cli/docker/container/run/#volumes-from).

При выходе `--rm` удаляет запущенный stage3 и его собственные анонимные тома. Донор остаётся отдельным контейнером до обработки внешнего [`EXIT`](#cleanup). [Справка Docker по `--rm`](https://docs.docker.com/reference/cli/docker/container/run/#rm).

## 4.43. Подключаем overlay и experiment через bind mounts {#portage-bind-mounts}

{% capture portage_mounts %}{% raw %}    --mount "type=bind,src=$overlay,dst=/overlay" \
    --mount "type=bind,src=$work,dst=/experiment" \{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_mounts label="Два bind mount · строки 114–115" path=script revision=revision start=114 open=true %}

Docker открывает файлы каталогов хоста по новым путям внутри контейнера. `src` указывает путь на хосте Docker, `dst` — точку монтирования в контейнере. В CI каталог runner доступен демону по указанному пути. Если источник `--mount type=bind` отсутствует, Docker отклоняет запуск. [Справка Docker по bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

Оба подключения допускают запись с учётом прав доступа к файлам. При последующей генерации Manifest запись в `/overlay/app-editors/zed/Manifest` изменит файл в одноразовой копии overlay на хосте. Выберите подключение, чтобы увидеть его файлы и строку Docker, которая задаёт путь.

{% capture portage_previews %}{% include source-preview.html source=portage_mounts label="Подключения · строки 114–115" path=script revision=revision start=114 %}{% endcapture %}
{% include integrity-lab.html lab="portage-mounts" data=site.data.portage_labs previews=portage_previews %}

## 4.44. Выбираем рабочий каталог внутри контейнера {#portage-workdir}

{% capture portage_cwd %}{% raw %}    --workdir /overlay \{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_cwd label="Рабочий каталог · строка 116" path=script revision=revision start=116 open=true %}

`cd` меняет текущий каталог самого Bash. Родительский скрипт уже выполнил `cd "$disposable_workspace"`, поэтому внешний Bash работает в одноразовой копии на runner. Как и [`git -C`]({{ previous }}#source-workspace), `--workdir` задаёт каталог для запускаемой операции. Внутренний Bash начинает работу в `/overlay`, и относительные пути в его программе разрешаются оттуда. Текущий каталог внешнего Bash при этом остаётся прежним.

Например, `scripts/inspect_zed_archive.py` на строках 136–137 означает `/overlay/scripts/inspect_zed_archive.py`. Тот же принцип применяется к `scripts/crates_distribution.py` и `scripts/check_zed_cargo_snapshot.py`. Абсолютные пути под `/experiment` и `/etc/portage` от рабочего каталога не зависят.

## 4.45. Передаём переменные через docker --env {#portage-env}

{% capture portage_env %}{% raw %}    --env CANDIDATE_VERSION="$version" \
    --env EXPECTED_ARCHIVE_SHA256="$(sha256sum "$archive" | cut -d' ' -f1)" \
    --env EXPECTED_SOURCE_SHA256="$source_hash" \
    --env CANDIDATE_EBUILD="/overlay/${candidate#"$overlay"/}" \
    --env CANDIDATE_PATCH="/overlay/${patch#"$overlay"/}" \{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_env label="Пять значений окружения · строки 117–121" path=script revision=revision start=117 open=true %}

Внешний Bash подставляет значения в пять аргументов `ИМЯ=значение`. Docker помещает эти пары в окружение процесса контейнера. Внутренний Bash читает переданные значения по именам слева от `=`. Выберите переменную, чтобы проследить её от входа до места чтения. [Справка Docker по `--env`](https://docs.docker.com/reference/cli/docker/container/run/#env).

В строке 118 `sha256sum "$archive"` печатает хеш и имя файла, а `cut -d' ' -f1` оставляет первое поле. Как в [4.12](#fingerprints), `$(…)` захватывает stdout и убирает завершающие переводы строк. Внешний `pipefail` сохраняет ошибку `sha256sum` в статусе внутреннего конвейера. Здесь Bash подставляет его **вывод** в аргумент `docker run`, поэтому ошибка хеширования сама по себе не задаёт статус Docker. При пустом stdout Docker может получить `EXPECTED_ARCHIVE_SHA256=`. Позже проверка контрольной суммы использует переданное значение.

{% capture portage_previews %}{% include source-preview.html source=portage_env label="Переменные · строки 117–121" path=script revision=revision start=117 %}{% endcapture %}
{% include integrity-lab.html lab="portage-env" data=site.data.portage_labs previews=portage_previews %}

## 4.46. Преобразуем пути кандидата {#portage-candidate-paths}

{% capture portage_paths %}{% raw %}    --env CANDIDATE_EBUILD="/overlay/${candidate#"$overlay"/}" \
    --env CANDIDATE_PATCH="/overlay/${patch#"$overlay"/}" \{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_paths label="Подстановка пути ebuild и patch · строки 120–121" path=script revision=revision start=120 open=true %}

`${candidate#"$overlay"/}` удаляет кратчайший совпавший префикс. Кавычки вокруг `$overlay` задают буквальный текст каталога, а `/` завершает префикс. Для `$patch` работает та же подстановка. Затем Bash добавляет `/overlay/`, чтобы путь начинался с точки монтирования в контейнере.

| Шаг | Ebuild | Patch |
| --- | --- | --- |
| Исходный путь | `/tmp/zed-overlay/app-editors/zed/zed-1.29.2.ebuild` | `/tmp/zed-overlay/app-editors/zed/files/zed-1.29.2-wayland-only.patch` |
| Удаляемый префикс | `/tmp/zed-overlay/` | `/tmp/zed-overlay/` |
| Остаток | `app-editors/zed/zed-1.29.2.ebuild` | `app-editors/zed/files/zed-1.29.2-wayland-only.patch` |
| Путь после добавления `/overlay/` | `/overlay/app-editors/zed/zed-1.29.2.ebuild` | `/overlay/app-editors/zed/files/zed-1.29.2-wayland-only.patch` |

Оба входа ожидаются под `"$overlay"/`: родительский скрипт строит абсолютные пути от каталога одноразовой копии. Если префикс не совпадёт, значение останется целиком, например `/tmp/other/zed-1.29.2.ebuild` превратится в `/overlay//tmp/other/zed-1.29.2.ebuild`. Подстановка работает со строкой, а файл проверяется позже при обращении по полученному пути.

## 4.47. Запускаем вложенный Bash {#portage-inner-bash}

{% capture portage_bash %}{% raw %}    "$GENTOO_STAGE3_IMAGE" /bin/bash -euo pipefail -c '{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_bash label="Образ и начало программы Bash · строка 122" path=script revision=revision start=122 open=true %}

После опций `docker run` идёт ссылка на образ. За ней идут команда контейнера `/bin/bash` и её аргументы. В `-euo pipefail` флаг `-e` включает `errexit`, а `-u` делает раскрытие неустановленной переменной ошибкой. С `pipefail` статус конвейера равен статусу последнего справа звена, завершившегося с ошибкой, или 0 при успехе всех звеньев. Внутренний Bash получает эти настройки при запуске. У внешнего Bash свои параметры. `-c` велит Bash выполнить следующий аргумент как программу. [Синтаксис `docker run`](https://docs.docker.com/reference/cli/docker/container/run/).

Одинарная кавычка в строке 122 открывает один многострочный аргумент. Внешний Bash сохраняет его текст буквально до закрывающей кавычки в строке 146. Так `$version` в опции Docker раскрывается на runner, а `$CANDIDATE_VERSION` в программе раскрывается в контейнере. Лаборатория использует фиксированные примеры из исходника.

{% capture portage_previews %}
{% include source-preview.html source=portage_launch label="Аргументы внешнего Bash · строки 111–122" path=script revision=revision start=111 %}
{% capture portage_setup %}{% raw %}      mkdir -p /etc/portage/repos.conf /etc/portage/package.accept_keywords /etc/portage/package.use
      printf "%s\n" "[DEFAULT]" "main-repo = gentoo" "[gentoo]" "location = /var/db/repos/gentoo" "auto-sync = no" "[zed-overlay]" "location = /overlay" "masters = gentoo" "auto-sync = no" > /etc/portage/repos.conf/zed-overlay.conf
      printf "=app-editors/zed-%s::zed-overlay ~amd64\n" "$CANDIDATE_VERSION" > /etc/portage/package.accept_keywords/zed-candidate
      printf "%s\n" "media-libs/vulkan-loader wayland" "media-video/pipewire sound-server" > /etc/portage/package.use/zed-validation
      export DISTDIR=/experiment/dist
      test "$(portageq envvar DISTDIR)" = "$DISTDIR"
      printf "%s  %s\n" "$EXPECTED_ARCHIVE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" | sha256sum -c -{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_setup label="Программа внутри stage3 · строки 123–129" path=script revision=revision start=123 open=true %}
{% endcapture %}
{% include integrity-lab.html lab="portage-shell" data=site.data.portage_labs previews=portage_previews %}

## 4.48. Создаём repos.conf {#portage-repos-conf}

{% capture portage_repos %}{% raw %}      mkdir -p /etc/portage/repos.conf /etc/portage/package.accept_keywords /etc/portage/package.use
      printf "%s\n" "[DEFAULT]" "main-repo = gentoo" "[gentoo]" "location = /var/db/repos/gentoo" "auto-sync = no" "[zed-overlay]" "location = /overlay" "masters = gentoo" "auto-sync = no" > /etc/portage/repos.conf/zed-overlay.conf{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_repos label="Каталоги конфигурации и repos.conf · строки 123–124" path=script revision=revision start=123 open=true %}

`mkdir -p` готовит каталоги для трёх файлов. Строка 124 выводит по одному аргументу на строку через `printf "%s\n"`. Перенаправление `>` открывает файл `/etc/portage/repos.conf/zed-overlay.conf` для записи с заменой прежнего содержимого.

Portage использует основное дерево Gentoo из тома донора для профилей, зависимостей и общих eclass. В `/overlay` находится репозиторий с ebuild кандидата. Для него `masters = gentoo` задаёт связь с основным деревом. Обе записи исключены из автоматической синхронизации через `auto-sync = no`. Эта настройка относится к синхронизации репозиториев. Другие операции сохраняют возможность доступа к сети.

{% capture portage_previews %}
{% include source-preview.html source=portage_donor label="Том Gentoo · строка 113" path=script revision=revision start=113 %}
{% include source-preview.html source=portage_mounts label="Подключения · строки 114–115" path=script revision=revision start=114 %}
{% include source-preview.html source=portage_repos label="Настройка репозиториев · строки 123–124" path=script revision=revision start=123 %}
{% endcapture %}
{% include integrity-lab.html lab="portage-repos" data=site.data.portage_labs previews=portage_previews %}

## 4.49. Настраиваем ACCEPT_KEYWORDS и USE {#portage-keywords-use}

{% capture portage_flags %}{% raw %}      printf "=app-editors/zed-%s::zed-overlay ~amd64\n" "$CANDIDATE_VERSION" > /etc/portage/package.accept_keywords/zed-candidate
      printf "%s\n" "media-libs/vulkan-loader wayland" "media-video/pipewire sound-server" > /etc/portage/package.use/zed-validation{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_flags label="Настройки пакетов · строки 125–126" path=script revision=revision start=125 open=true %}

В `package.accept_keywords/zed-candidate` записывается атом `=app-editors/zed-<version>::zed-overlay` и разрешённый keyword `~amd64`. `app-editors/zed` задаёт категорию и имя пакета, `=` с версией выбирает конкретную версию, а `::zed-overlay` ограничивает совпадение этим репозиторием. `~amd64` разрешает Portage рассматривать ebuild с соответствующим тестовым keyword для amd64.

В `package.use/zed-validation` записываются флаги для двух пакетов. `wayland` включается для `media-libs/vulkan-loader`, `sound-server` — для `media-video/pipewire`. Это настройки разрешения зависимостей во временном контейнере. Обе записи лежат в его `/etc/portage`, вне подключённых каталогов хоста. Политика Wayland-only задаётся отдельно в overlay, а запуск Zed под Wayland подтверждается ручной проверкой.

{% capture portage_previews %}{% include source-preview.html source=portage_flags label="Два файла настроек · строки 125–126" path=script revision=revision start=125 %}{% endcapture %}
{% include integrity-lab.html lab="portage-flags" data=site.data.portage_labs previews=portage_previews %}

## 4.50. Настраиваем и проверяем DISTDIR {#portage-distdir}

{% capture portage_distdir %}{% raw %}      export DISTDIR=/experiment/dist
      test "$(portageq envvar DISTDIR)" = "$DISTDIR"{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_distdir label="Экспорт и проверка DISTDIR · строки 127–128" path=script revision=revision start=127 open=true %}

`export` задаёт `DISTDIR` и передаёт её дочерним процессам внутреннего Bash. `portageq envvar DISTDIR` печатает эффективное значение настройки Portage. Подстановка команды передаёт этот вывод в `test`, а `=` сравнивает две строки. Если запрос завершится с ошибкой и ничего не напечатает, сравнение пустой строки с `/experiment/dist` вернёт 1. Статус запроса здесь отдельно не проверяется.

Значение `/experiment/dist` указывает на `$work/dist` на хосте. Равенство строк не открывает каталог и ничего не сообщает о доступности файлов. Хеширование на строках 129–130 уже читает сами архивы. Выберите ситуацию, чтобы увидеть, до какого шага дойдёт Bash.

{% capture portage_previews %}
{% include source-preview.html source=portage_distdir label="Проверка значения · строки 127–128" path=script revision=revision start=127 %}
{% capture portage_next %}{% raw %}      printf "%s  %s\n" "$EXPECTED_ARCHIVE_SHA256" "$DISTDIR/zed-${CANDIDATE_VERSION}-overlay-crates.tar.xz" | sha256sum -c -{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_next label="Первое чтение архива · строка 129" path=script revision=revision start=129 open=true %}
{% endcapture %}
{% include integrity-lab.html lab="portage-distdir" data=site.data.portage_labs previews=portage_previews %}

## 4.51. Записываем журнал контейнера и результаты измерений {#portage-log-timing}

{% capture portage_output %}{% raw %}    ' 2>&1 | tee "$work/logs/portage.log"
  cat "$work/logs/timing.txt" >> "$GITHUB_STEP_SUMMARY"{% endraw %}{% endcapture %}
{% include source-preview.html source=portage_output label="Журнал и перенос замеров · строки 146–147" path=script revision=revision start=146 open=true %}

Первая одинарная кавычка в строке 146 закрывает программу для `bash -c`. Операторы после неё выполняет внешний Bash. Как в [4.21](#generator-streams), `2>&1` направляет stderr команды Docker туда же, куда stdout. `tee` записывает объединённый поток в `$work/logs/portage.log` и выводит его в журнал задания. Если контейнер завершится с ошибкой, `tee` может сохранить весь вывод, который успел поступить. Внешний `pipefail` возвращает ненулевой статус, даже если `tee` получил и записал этот поток успешно.

Внутренний Bash дописывает замеры в `/experiment/logs/timing.txt` во время следующих этапов. Через bind mount этот файл виден на хосте как `$work/logs/timing.txt`. Лишь после успеха Docker и `tee` внешний Bash доходит до `cat` и дописывает содержимое файла в `$GITHUB_STEP_SUMMARY` через `>>`.

{% capture portage_previews %}{% include source-preview.html source=portage_output label="Вывод и замеры · строки 146–147" path=script revision=revision start=146 %}{% endcapture %}
{% include integrity-lab.html lab="portage-output" data=site.data.portage_labs previews=portage_previews %}

## 4.52. Проверяем готовность контейнерного окружения {#portage-environment-check}

В карте PASS означает, что шаг в выбранном сценарии прошёл, FAIL — что шаг или показанное условие не выполнены, SKIP — что выполнение до него не дошло. Строки карты с путями показывают и условия, которые скрипт проверяет лишь при дальнейшем использовании. Например, неверный путь ebuild можно передать через `--env` и дойти до строки 129. В этом сценарии файл не обнаружится при более позднем вызове `ebuild`.

Успешная настройка окружения позволяет начать проверку архива. В реальном запуске тот же контейнер продолжает выполнять строки 129–145. В них входят проверки архивов, работа с Manifest, разрешение зависимостей, проверки Cargo snapshot и Wayland patch. Итоговый статус контейнера становится известен после этой работы или при первом отказе.

{% capture portage_previews %}
{% include source-preview.html source=portage_launch label="Подготовка запуска · строки 111–122" path=script revision=revision start=111 %}
{% include source-preview.html source=portage_setup label="Настройки и переход · строки 123–129" path=script revision=revision start=123 %}
{% include source-preview.html source=portage_output label="Статус конвейера и замеры · строки 146–147" path=script revision=revision start=146 %}
{% endcapture %}
{% include integrity-lab.html lab="portage-flow" data=site.data.portage_labs previews=portage_previews %}

Строка 129 открывает фазу 4.5. Внутренний Bash передаёт ожидаемый хеш и путь к crates-архиву в `sha256sum -c -`.

{% include source-preview.html source=portage_next label="Начало проверки crates-архива · строка 129" path=script revision=revision start=129 open=true %}
