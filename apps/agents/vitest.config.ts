import path from "node:path";
export default {
  resolve: {
    alias: {
      "@/": `${path.resolve(__dirname, "src")}/`,
      "@shared/types/": `${path.resolve(__dirname, "../../packages/types/src")}/`,
      "@shared/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@shared/rest/": `${path.resolve(__dirname, "../../packages/rest/src")}/`,
      "@shared/rest": path.resolve(__dirname, "../../packages/rest/src/index.ts"),
      "@shared/database/": `${path.resolve(__dirname, "../../packages/database/src")}/`,
      "@shared/database": path.resolve(__dirname, "../../packages/database/src/index.ts"),
      "@shared/env/": `${path.resolve(__dirname, "../../packages/env/src")}/`,
      "@shared/env": path.resolve(__dirname, "../../packages/env/src/index.ts"),
    },
  },
};
