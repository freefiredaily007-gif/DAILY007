export const Paths = { cache: "isolated-preview-cache" };

export class File {
  uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  async text() {
    return "";
  }

  async write() {
    return undefined;
  }
}