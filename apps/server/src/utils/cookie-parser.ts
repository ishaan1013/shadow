export function parseApiKeysFromCookies(cookieHeader?: string): {
  openai?: string;
  anthropic?: string;
} {
  if (!cookieHeader) {
    return {};
  }

  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((cookie) => {
    const trimmedCookie = cookie.trim();
    const equalIndex = trimmedCookie.indexOf("=");

    if (equalIndex > 0) {
      const name = trimmedCookie.substring(0, equalIndex);
      const value = trimmedCookie.substring(equalIndex + 1);

      // Only decode if the value contains URL-encoded characters
      // API keys typically don't need decoding, but session tokens might
      cookies[name] = value.includes("%") ? decodeURIComponent(value) : value;
    }
  });

  return {
    openai: cookies["openai-key"] || undefined,
    anthropic: cookies["anthropic-key"] || undefined,
  };
}