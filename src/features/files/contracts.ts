export interface FileOpenResult {
  ok: boolean;
  path: string;
  error?: { code: "PATH_INVALID" | "PATH_NOT_FOUND" | "PATH_NOT_FILE" | "OPEN_FAILED"; message: string };
}

export interface FileOpener {
  open(path: string): Promise<FileOpenResult>;
}
