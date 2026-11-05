/** Stub of next/headers for scripts running outside the Next runtime. */
export async function cookies() {
  const store = new Map();
  return {
    get: (name) => (store.has(name) ? { name, value: store.get(name) } : undefined),
    set: (name, value) => store.set(name, value),
    delete: (name) => store.delete(name),
    has: (name) => store.has(name),
  };
}

export async function headers() {
  return new Headers();
}
