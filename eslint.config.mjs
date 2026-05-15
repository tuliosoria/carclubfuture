import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "scripts/.cache/**",
      "src/lib/data/cars-ml/*.json",
      "public/**",
    ],
  },
];

export default eslintConfig;
