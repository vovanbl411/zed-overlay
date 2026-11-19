---
layout: handbook
title: Bash — подготовка crates и проверка исходников
description: От четырёх аргументов дочернего Bash до проверенного дерева исходников Zed и двух контрольных сумм.
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
{% capture next %}mode="$(PYTHONDONTWRITEBYTECODE=1 python3 "$overlay/scripts/crates_github.py" lookup --version "$version")"{% endcapture %}
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

{% include source-preview.html source=next label="Следующая команда · строка 152" path=script revision=revision start=152 open=true %}

Строка 152 передаёт управление следующему этапу. В фазе 4.2 начнём
с подготовки окружения и выбора между генерацией и повторным
использованием crates.
