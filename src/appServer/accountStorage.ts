import { join } from 'node:path';

export function accountStorageDirectory(storageDirectory: string, accountId?: string): string {
  if (accountId === undefined) {
    return storageDirectory;
  }
  if (typeof accountId !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(accountId)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(accountId)) {
    throw new TypeError('Invalid account identifier.');
  }
  return join(storageDirectory, 'accounts', accountId);
}
