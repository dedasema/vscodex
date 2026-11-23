import { join } from 'node:path';

export function isAccountStorageId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value);
}

export function accountStorageDirectory(storageDirectory: string, accountId?: string): string {
  if (accountId === undefined) {
    return storageDirectory;
  }
  if (!isAccountStorageId(accountId)) {
    throw new TypeError('Invalid account identifier.');
  }
  return join(storageDirectory, 'accounts', accountId);
}
