// Run from the repository root after npm run build:packages. No new dependencies.
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const webpack = require("webpack");

const root = resolve(__dirname, "../../..");
const output = join(root, "tmp", "pdfs", "receipt-qa");
const compiler = webpack({
  mode: "development", target: "electron-main", devtool: false,
  entry: join(__dirname, "receipt-smoke.ts"),
  output: { path: output, filename: "receipt-smoke.cjs" },
  externals: { "better-sqlite3": "commonjs better-sqlite3" },
  module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: [{ loader: "ts-loader", options: {
    transpileOnly: true, configFile: join(root, "apps/pos/tsconfig.json")
  } }] }] },
  resolve: { extensions: [".ts", ".js"] }
});
compiler.run((error, stats) => compiler.close(() => {
  if (error || stats.hasErrors()) {
    console.error(error ?? stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [join(output, "receipt-smoke.cjs"), output], {
    cwd: root, env, stdio: "inherit", windowsHide: true
  });
  child.on("error", (reason) => { console.error(reason); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}));
