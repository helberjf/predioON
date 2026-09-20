/**
 * The package is consumed by Vite apps but is not a Vite app itself, so it declares the
 * only env var it reads instead of depending on vite/client types.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
