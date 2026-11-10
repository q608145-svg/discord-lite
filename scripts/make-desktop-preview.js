const fs = require("node:fs");

// Достаём CSS и HTML шапки из desktop/main.js, чтобы проверить их в обычном Chrome:
// так видно, как окно Electron будет выглядеть с кастомным title bar.
const src = fs.readFileSync("desktop/main.js", "utf8");
const cssMatch = src.match(/const css = `([\s\S]*?)`;/);
const scriptMatch = src.match(/const script = `([\s\S]*?)`;/);
if (!cssMatch || !scriptMatch) throw new Error("не нашёл css/script в main.js");

const css = cssMatch[1].replace(/\$\{TITLEBAR_HEIGHT\}/g, "40");
// В main.js это интерполируется Node-ом; для предпросмотра подставляем адрес вручную.
const script = scriptMatch[1].replace("${host}", "localhost:3000");

fs.writeFileSync(
  "data/desktop-preview.js",
  `(() => {
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
    ${script}
  })();`,
  "utf8"
);

console.log("data/desktop-preview.js готов");
