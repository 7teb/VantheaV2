import { safeStorage } from "electron";

export type SecretCodec = {
  available: () => boolean;
  encrypt: (plain: string) => string;
  decrypt: (cipher: string) => string;
};

export const safe_storage_codec: SecretCodec = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS encryption (Electron safeStorage) is unavailable, so the key was not stored");
    }
    return safeStorage.encryptString(plain).toString("base64");
  },
  decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, "base64")),
};
