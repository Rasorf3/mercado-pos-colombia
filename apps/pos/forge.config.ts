import { cp } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

const workspaceNodeModules = resolve(process.cwd(), "../../node_modules");

const config: ForgeConfig = {
  packagerConfig: {
    prune: false,
    asar: {
      unpack: "**/*.node"
    }
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const targetNodeModules = resolve(buildPath, "node_modules");
      const sqlitePackage = resolve(workspaceNodeModules, "better-sqlite3");
      const targetSqlitePackage = resolve(targetNodeModules, "better-sqlite3");
      const nativeBinary = `prebuilds/${platform}-${arch}.node`;

      // The Forge webpack plugin intentionally copies only .webpack. Copy the
      // external native runtime dependency into the packaged app explicitly.
      await cp(sqlitePackage, targetSqlitePackage, {
        recursive: true,
        filter: (source) => {
          const pathFromPackage = relative(sqlitePackage, source).replaceAll("\\", "/");
          return pathFromPackage === "" ||
            pathFromPackage === "package.json" ||
            pathFromPackage === "lib" ||
            pathFromPackage.startsWith("lib/") ||
            pathFromPackage === "prebuilds" ||
            pathFromPackage === nativeBinary;
        }
      });
    }
  },
  rebuildConfig: {
    onlyModules: []
  },
  plugins: [
    new WebpackPlugin({
      mainConfig: "./webpack.main.config.ts",
      renderer: {
        config: "./webpack.renderer.config.ts",
        entryPoints: [
          {
            name: "main_window",
            html: "./src/renderer/index.html",
            js: "./src/renderer/index.tsx",
            preload: {
              js: "./src/preload.ts"
            }
          }
        ]
      }
    })
  ]
};

export default config;
