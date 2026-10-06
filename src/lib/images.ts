import { getImage, inferRemoteSize } from "astro:assets";
import { imageSourceUrl } from "./format.ts";

const cache = new Map<string, Promise<string>>();

/**
 * Resolves an admin-entered image URL to something safe to put in the page.
 *
 * Remote images on an allowed host (see `image.domains` in astro.config.mjs)
 * are downloaded at build time, resized and converted to WebP into assets/,
 * so the kiosk never loads from a third-party host. Anything Astro can't
 * optimize -- or any download failure -- falls back to the original URL
 * rather than failing the build over a single broken image.
 */
export function resolveImage(url: string | undefined | null, width: number): Promise<string> {
  const source = imageSourceUrl(url);
  if (!source) return Promise.resolve("");

  const key = `${width}|${source}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = optimize(source, width);
    cache.set(key, pending);
  }
  return pending;
}

async function optimize(source: string, width: number): Promise<string> {
  try {
    // Read the real dimensions and scale both sides together. Passing only
    // `width` with `inferSize` keeps the original height, which distorts the
    // image. Never upscale: a small logo stays at its own size.
    const natural = await inferRemoteSize(source);
    const targetWidth = Math.min(width, natural.width);
    const targetHeight = Math.max(1, Math.round((natural.height * targetWidth) / natural.width));
    const result = await getImage({ src: source, width: targetWidth, height: targetHeight, format: "webp" });
    return result.src;
  } catch (error) {
    console.warn(
      `[images] Using original URL for ${source}: ${error instanceof Error ? error.message : error}`,
    );
    return source;
  }
}
