# zed-overlay

[English](README.en.md) | Русский

`zed-overlay` — оверлей Gentoo для нативной сборки Zed через Portage. Ebuild
основан на официальном ebuild Gentoo и адаптирован для Wayland-only сборки.

## Структура репозитория

```text
app-editors/zed/
contrib/portage/repo.postsync.d/50-zed-overlay-cache
metadata/layout.conf
profiles/repo_name
```

Репозиторий использует `masters = gentoo` и тонкие манифесты. Сгенерированный
каталог `metadata/md5-cache/` не хранится в Git.

## Подключение оверлея к Portage

Создайте `/etc/portage/repos.conf/zed-overlay.conf`:

```ini
[zed-overlay]
location = /var/db/repos/zed-overlay
sync-type = git
sync-uri = https://github.com/vovanbl411/zed-overlay.git
auto-sync = yes
sync-hooks-only-on-change = yes
```

Post-sync hook необязателен. Чтобы установить его один раз, выполните:

```sh
sudo install -Dm755 \
  /var/db/repos/zed-overlay/contrib/portage/repo.postsync.d/50-zed-overlay-cache \
  /etc/portage/repo.postsync.d/50-zed-overlay-cache
```

После установки Portage запускает hook после синхронизации `zed-overlay` и
обновляет внешний кеш метаданных командой:

```sh
egencache --repo=zed-overlay --update --external-cache-only
```

Каталог `metadata/md5-cache/` при этом не записывается в рабочую копию Git. Для
дальнейших обновлений оверлея используйте обычный `emerge --sync`.

В ebuild указан testing keyword `~amd64`. Если у вас стабильная система amd64,
добавьте строку в `/etc/portage/package.accept_keywords` или в отдельный файл
внутри этого каталога:

```text
app-editors/zed::zed-overlay ~amd64
```

Если система уже принимает `~amd64`, эта запись не нужна.

Для первоначальной установки укажите пакет без привязки к версии, чтобы Portage
добавил Zed в набор `@world`:

```sh
sudo emerge -av app-editors/zed::zed-overlay
```

Для обычного обновления:

```sh
sudo emerge --sync
emerge -pvuDN @world
sudo emerge -avuDN @world
```

## Область применения и проверки

Патч убирает X11 из production features Zed и отключает локальный захват экрана
в Linux. Не включайте `scap/wayland` без отдельного решения, учитывающего цепочку
зависимостей PipeWire/scap.

CI проверяет подготовку релиза, зависимости и применение патча. Он не собирает
Zed и не проверяет его работу. Для проверки нового релиза в Gentoo по-прежнему
нужно вручную собрать пакет, проверить зависимости через `scanelf` и `lddtree`
и убедиться, что Zed запускается в Wayland без нежелательной связи с X11.

Версия 1.21.0 прошла такую проверку на amd64; сборка и запуск на arm64 пока не
проверялись, хотя ebuild имеет keyword `~arm64`.

Описание автоматических проверок релиза и их ограничений см. в документе
[«CI и модель безопасности»](docs/CI_AND_SECURITY.md).
