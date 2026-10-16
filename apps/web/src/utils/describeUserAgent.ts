export interface IUserAgentSummary {
  /** For example `Firefox 157` or `Firefox for Android 157`; `Unknown browser` when nothing matches. */
  browser: string;
  /** For example `macOS`, `Windows` or `Linux`; null when nothing matches. */
  os: string | null;
}

const OPERATING_SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux|X11/, 'Linux'],
];

const BROWSERS: [RegExp, string][] = [
  [/FxiOS\/(\d+)/, 'Firefox for iOS'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Edg\/(\d+)/, 'Edge'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari'],
];

/** A rough, display-only reading of a User-Agent header; nothing depends on it being right. */
export const describeUserAgent = (userAgent: string | null): IUserAgentSummary => {
  const header = userAgent ?? '';
  const os = OPERATING_SYSTEMS.find(([pattern]) => pattern.test(header))?.[1] ?? null;

  for (const [pattern, name] of BROWSERS) {
    const version = pattern.exec(header)?.[1];

    if (version !== undefined) {
      const browser = name === 'Firefox' && os === 'Android' ? 'Firefox for Android' : name;

      return { browser: `${browser} ${version}`, os };
    }
  }

  return { browser: 'Unknown browser', os };
};
