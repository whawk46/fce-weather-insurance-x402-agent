import { config } from "dotenv";
import path from "node:path";

// npm run mcp runs with cwd = frontend/
const frontendDir = process.cwd();
const repoRoot = path.resolve(frontendDir, "..");

config({ path: path.join(repoRoot, ".env") });
config({ path: path.join(frontendDir, ".env") });
config({ path: path.join(frontendDir, ".env.local"), override: true });
