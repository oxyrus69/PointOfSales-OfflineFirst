/** Stub of next/navigation for scripts running outside the Next runtime. */
export function redirect(url) {
  const error = new Error(`NEXT_REDIRECT:${url}`);
  error.digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw error;
}

export function notFound() {
  const error = new Error("NEXT_NOT_FOUND");
  error.digest = "NEXT_NOT_FOUND";
  throw error;
}

export function useRouter() {
  throw new Error("useRouter is not available in script context");
}

export function usePathname() {
  return "/";
}
