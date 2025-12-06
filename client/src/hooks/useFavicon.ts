import { useEffect } from "react";

export function useFavicon(emoji: string) {
  useEffect(() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>`;
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
    if (link) {
      link.href = url;
    }
  }, [emoji]);
}
