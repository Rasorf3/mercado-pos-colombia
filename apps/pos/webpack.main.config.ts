import type { Configuration } from "webpack";
import { rules } from "./webpack.rules";

const config: Configuration = {
  entry: "./src/main.ts",
  module: {
    rules
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx"]
  }
};

export default config;
