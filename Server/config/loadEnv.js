// Load Server/.env, from beside this folder rather than from wherever the process was
// started.
//
// This is its own file, imported first, because of how ES modules run: every `import`
// in a file is evaluated BEFORE the file's own code. server.js used to call
// dotenv.config() in its body, which meant config/env.js had already read NODE_ENV and
// CLIENT_URL — as empty. On a server whose settings live in .env (every deployed one)
// that quietly turned "only my own site may call this API" into "any site may", with
// nothing in the log to say so. An import placed first runs first.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });
