import { createHash, randomBytes } from "node:crypto";

export const random_value = (): string => randomBytes(32).toString("base64url");

export const code_challenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");
