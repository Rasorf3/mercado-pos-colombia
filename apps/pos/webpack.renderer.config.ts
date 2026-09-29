import type { Configuration } from "webpack";
import { rules } from "./webpack.rules.ts";

const config: Configuration = {
  module: {
    rules
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx"]
  }
};

export default config;
