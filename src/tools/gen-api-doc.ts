/** Write `docs/07-api.md` from the live schema. `npm run gen:api`. */

import { writeFileSync } from "node:fs";
import { generateApiDoc } from "./api-doc-source.js";
import { liveTools } from "./live-tools.js";

const OUT = "docs/07-api.md";

const tools = await liveTools();
writeFileSync(OUT, generateApiDoc(tools));
console.log(`${OUT}: ${tools.length} tools, from the live tools/list schema`);
