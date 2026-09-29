import type { Configuration } from "webpack";
import { rules } from "./webpack.rules.ts";

const config: Configuration = {
  entry: "./src/main.ts",
  externals: {
    "better-sqlite3": "commonjs better-sqlite3"
  },
  module: {
    rules
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx"]
  }
};

export default config;
