export function isFirefoxForAndroid(userAgent = navigator.userAgent): boolean {
  return userAgent.includes('Android') && userAgent.includes('Firefox/');
}

export function isFirefoxForIos(userAgent = navigator.userAgent): boolean {
  return userAgent.toLowerCase().includes('fxios');
}
