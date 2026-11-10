"""Генерация иконок PWA для discord-lite.

Запуск: python scripts/make-icons.py
Создаёт:
  public/icons/icon-192.png
  public/icons/icon-512.png
  public/icons/maskable-512.png
  src/app/icon.png          (favicon, 512)
  src/app/apple-icon.png    (180)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ICONS = ROOT / "public" / "icons"
APP = ROOT / "src" / "app"
BUILD = ROOT / "build"

BG_TOP = (110, 122, 255)     # светлее сверху
BG_BOTTOM = (71, 82, 196)    # #4752C4 снизу
WHITE = (255, 255, 255, 255)


def find_font() -> ImageFont.FreeTypeFont:
    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\calibrib.ttf",
    ]
    for name in candidates:
        if Path(name).exists():
            return ImageFont.truetype(name, 10)
    return ImageFont.load_default()


def gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        r = round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b, 255)
    return img


def rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(size * radius_ratio)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    base = gradient(size)
    if maskable:
        # Без скруглений: платформа сама обрежет по своей маске.
        icon = base
    else:
        icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        icon.paste(base, (0, 0), rounded_mask(size))

    draw = ImageDraw.Draw(icon)
    # Буква D по центру (для maskable — с safe zone ~80%).
    glyph_ratio = 0.46 if not maskable else 0.38
    font = find_font()
    font = ImageFont.truetype(font.path, int(size * glyph_ratio))
    # anchor="mm" центрирует глиф ровно по середине иконки.
    draw.text((size / 2, size / 2), "D", font=font, fill=WHITE, anchor="mm")
    return icon


def main() -> None:
    PUBLIC_ICONS.mkdir(parents=True, exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)

    make_icon(192).save(PUBLIC_ICONS / "icon-192.png")
    make_icon(512).save(PUBLIC_ICONS / "icon-512.png")
    make_icon(512, maskable=True).save(PUBLIC_ICONS / "maskable-512.png")
    make_icon(512).save(APP / "icon.png")
    make_icon(180).save(APP / "apple-icon.png")

    # Electron: build/icon.ico (Windows) и build/icon.png (окно и Linux).
    BUILD.mkdir(parents=True, exist_ok=True)
    base = make_icon(256)
    base.save(
        BUILD / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    make_icon(512).save(BUILD / "icon.png")

    for path in sorted(
        list(PUBLIC_ICONS.glob("*.png"))
        + [APP / "icon.png", APP / "apple-icon.png", BUILD / "icon.png", BUILD / "icon.ico"]
    ):
        with Image.open(path) as im:
            print(f"{path.relative_to(ROOT)} — {im.width}x{im.height}")


if __name__ == "__main__":
    main()
