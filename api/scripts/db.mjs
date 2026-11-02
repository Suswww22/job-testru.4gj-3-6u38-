// 開發用的 Postgres：用 embedded-postgres 套件附的執行檔，免安裝。npm run db 啟動、npm run db:stop 停止。
// initdb 放在含中文的路徑（本 repo 在「Claude作品集」底下）會失敗，所以先把執行檔複製到 %LOCALAPPDATA%\job-tracker，
// 再直接啟動 postgres.exe，資料也放在那裡。
// 之後改用 Docker Compose 時，只要把 DATABASE_URL 指向容器即可，程式不用改。

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pg from "pg";

const PORT = 5433;
const DB_NAME = "jobtracker";
const USER = "postgres";
const PASSWORD = "postgres";

const HOME = join(process.env["LOCALAPPDATA"] ?? join(homedir(), ".local", "share"), "job-tracker");
const BIN_DIR = join(HOME, "pg-bin");
const DATA_DIR = join(HOME, "pgdata");
// fs.cpSync 在 Windows 讀中文來源路徑時會讓 Node 當掉，所以自己逐檔複製
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else copyFileSync(src, dest);
  }
}

const exe = (name) => join(BIN_DIR, "bin", process.platform === "win32" ? `${name}.exe` : name);

if (!existsSync(exe("postgres"))) {
  const pkg = `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const { initdb } = await import(pkg); // 套件匯出的是執行檔路徑：<套件>/native/bin/initdb.exe
  const native = dirname(dirname(initdb));
  console.log(`複製 Postgres 執行檔到 ${BIN_DIR} …`);
  copyDir(native, BIN_DIR);
}

if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
  const pwfile = join(HOME, "pwfile");
  writeFileSync(pwfile, PASSWORD);
  const r = spawnSync(exe("initdb"), [
    "-D", DATA_DIR, "-U", USER, `--pwfile=${pwfile}`, "-A", "scram-sha-256", "--encoding=UTF8", "--locale=C",
  ], { stdio: "inherit" });
  rmSync(pwfile);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// postgres.exe 不允許以系統管理員身分直接執行；pg_ctl 會自動降權後再啟動，並在背景持續執行
const pgCtl = (...args) => spawnSync(exe("pg_ctl"), ["-D", DATA_DIR, ...args], { stdio: "inherit" }).status ?? 1;

if (process.argv[2] === "stop") process.exit(pgCtl("stop", "-m", "fast"));

const running = spawnSync(exe("pg_ctl"), ["-D", DATA_DIR, "status"], { stdio: "ignore" }).status === 0;
if (!running) {
  // 不接 stdio：背景的 postgres 會繼承管線，讓 npm 以為指令還沒結束
  const logFile = join(HOME, "postgres.log");
  const { status } = spawnSync(exe("pg_ctl"), ["-D", DATA_DIR, "start", "-w", "-l", logFile, "-o", `-p ${PORT}`], { stdio: "ignore" });
  if (status !== 0) {
    console.error(`Postgres 啟動失敗，請看 ${logFile}`);
    process.exit(status ?? 1);
  }
}

const client = new pg.Client({ host: "localhost", port: PORT, user: USER, password: PASSWORD, database: "postgres" });
await client.connect();
const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
if (rowCount === 0) await client.query(`CREATE DATABASE ${DB_NAME}`);
await client.end();

console.log(`Postgres 執行中：postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}（資料：${DATA_DIR}；停止：npm run db:stop）`);
