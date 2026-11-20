---
layout: handbook
title: Bash — подготовка crates и проверка исходников
description: От аргументов дочернего Bash и проверки исходников Zed до локального crates-архива и метаданных.
chapter: 2
eyebrow: Глава 02 / Shell scripts
permalink: /internals/02-shell-scripts/independent-crates/
shell_labs: true
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
