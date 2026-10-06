export function shouldStackRoomCredentialRows(fontScale: number, screenWidth: number) {
  return fontScale >= 1.5 && screenWidth <= 380;
}
