"use strict";

// electron-builder afterPack: вписываем иконку и версию в discord-lite.exe.
//
// Делаем это на чистом JS (resedit), чтобы не зависеть от winCodeSign/rcedit:
// их архивы содержат macOS-симлинки и на Windows без прав администратора
// не распаковываются.

const path = require("node:path");
const fs = require("node:fs");
const {
  NtExecutable,
  NtExecutableResource,
  Resource,
  Data,
} = require("resedit");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");
  const version = context.packager.appInfo.version;

  if (!fs.existsSync(exePath)) {
    console.warn("[after-pack] не найден", exePath);
    return;
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  // ---- иконка
  if (fs.existsSync(iconPath)) {
    const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
    const groups = Resource.IconGroupEntry.fromEntries(res.entries);
    Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      groups.length ? groups[0].id : 1,
      groups.length ? groups[0].lang : 1033,
      iconFile.icons.map((item) => item.data)
    );
  }

  // ---- версия
  const viList = Resource.VersionInfo.fromEntries(res.entries);
  if (viList.length > 0) {
    const vi = viList[0];
    const [major, minor, patch] = version.split(".").map((n) => Number(n) || 0);
    vi.setFileVersion(major, minor, patch, 0);
    vi.setProductVersion(major, minor, patch, 0);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      CompanyName: "discord-lite",
      ProductName: "discord-lite",
      FileDescription: "discord-lite — чат и голос для друзей",
      InternalName: "discord-lite",
      OriginalFilename: "discord-lite.exe",
      FileVersion: version,
      ProductVersion: version,
    });
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log("[after-pack] иконка и версия записаны в", path.basename(exePath));
};
