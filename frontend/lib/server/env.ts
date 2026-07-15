import { config } from "dotenv";
import path from "node:path";

const frontendDir = path.resolve(process.cwd());
const repoRoot = path.resolve(frontendDir, "..");

config({ path: path.join(repoRoot, ".env") });
config({ path: path.join(frontendDir, ".env") });
config({ path: path.join(frontendDir, ".env.local"), override: true });
