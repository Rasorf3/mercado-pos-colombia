import type { ForgeConfig } from "@electron-forge/shared-types";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true
  },
  rebuildConfig: {},
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
