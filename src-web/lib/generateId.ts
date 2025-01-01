import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('023456789abcdefghijkmnpqrstuvwxyzABCDEFGHIJKMNPQRSTUVWXYZ', 10);

export function generateId(): string {
  return nanoid();
}
