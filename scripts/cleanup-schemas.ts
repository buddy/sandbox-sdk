import { readFileSync, writeFileSync } from "node:fs";

// Remove ClientOptions type from types.gen.ts (contains hardcoded base URL)
const typesFile = "src/api/openapi/types.gen.ts";
let typesContent = readFileSync(typesFile, "utf8");
typesContent = typesContent.replace(/export type ClientOptions[\s\S]*?^};\n\n/m, "");
writeFileSync(typesFile, typesContent);

// Remove ClientOptions export from index.ts
const indexFile = "src/api/openapi/index.ts";
let indexContent = readFileSync(indexFile, "utf8");
indexContent = indexContent.replace(/\tClientOptions,\n/, "");
writeFileSync(indexFile, indexContent);

console.log("Removed ClientOptions from generated schemas");
