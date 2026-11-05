/**
 * Resolves the "@/…" alias and extensionless relative imports for plain Node
 * scripts (e2e tests), so they exercise the real TypeScript services instead of
 * reimplementing the maths. Node 24 strips the types; this hook only fixes
 * module resolution.
 */
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];

/** Next runtime modules that only exist inside the framework build. */
const NEXT_STUBS = {
  "next/headers": path.join(root, "scripts", "lib", "stubs", "next-headers.mjs"),
  "next/navigation": path.join(root, "scripts", "lib", "stubs", "next-navigation.mjs"),
  "next/cache": path.join(root, "scripts", "lib", "stubs", "next-cache.mjs"),
};

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NEXT_STUBS[specifier]) {
      return { url: pathToFileURL(NEXT_STUBS[specifier]).href, shortCircuit: true };
    }

    if (specifier.startsWith("@/")) {
      const base = path.join(root, "src", specifier.slice(2));
      for (const extension of EXTENSIONS) {
        const candidate = `${base}${extension}`;
        if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }

    // Extensionless relative import inside a .ts file (e.g. "./schema").
    if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const base = path.resolve(parentDir, specifier);
      for (const extension of [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"]) {
        const candidate = `${base}${extension}`;
        if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
