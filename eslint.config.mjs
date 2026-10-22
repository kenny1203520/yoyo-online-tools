import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [...nextVitals, { ignores: ["out/**", "test-results/**", "tests/fixtures/models/**", "public/sw.js"] }];

export default eslintConfig;
