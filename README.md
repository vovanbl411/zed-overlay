# zed-overlay

`zed-overlay` — оверлей Gentoo для нативной сборки Zed через Portage. Текущий
пакет — `app-editors/zed-1.21.0`, основанный на официальном ebuild Gentoo и
адаптированный для сборки только с Wayland. Zed 1.21.0 прошёл automated release
validation; последним полностью подтверждённым manual runtime baseline остаётся
Zed 1.15.0.

## Структура репозитория

```text
app-editors/zed/
contrib/portage/repo.postsync.d/50-zed-overlay-cache
metadata/layout.conf
profiles/repo_name
```

Репозиторий использует `masters = gentoo` и тонкие манифесты. Предварительно
сгенерированный каталог `metadata/md5-cache/` не хранится в Git.

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

Один раз установите post-sync hook:

```sh
sudo install -Dm755 \
  /var/db/repos/zed-overlay/contrib/portage/repo.postsync.d/50-zed-overlay-cache \
  /etc/portage/repo.postsync.d/50-zed-overlay-cache
```

Hook запускается Portage после sync `zed-overlay` и регенерирует внешний кеш
метаданных. `metadata/md5-cache/` при этом не записывается в Git checkout.
После однократной настройки для дальнейших обновлений достаточно обычного
`emerge --sync`.

Для первоначальной установки используйте пакет без привязки к версии, чтобы он
попал в selected world set:

```sh
sudo emerge -av app-editors/zed::zed-overlay
```

После этого обычный workflow обновления выглядит так:

```sh
sudo emerge --sync
emerge -pvuDN @world
sudo emerge -avuDN @world
```

## Политика Wayland-only

Production backend — Wayland; X11 production feature edges удалены. Linux local
screen capture намеренно отключён. Не включайте `scap/wayland` без отдельного
решения, учитывающего цепочку зависимостей `pipewire-rs 0.8` и
`zed-scap 0.0.8`.

Runtime properties Zed 1.21.0 ещё требуют отдельного manual acceptance на
Gentoo workstation.
