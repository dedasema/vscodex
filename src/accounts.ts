import { randomUUID } from 'node:crypto';
import { isAccountStorageId } from './appServer/accountStorage';
import type { NamedAccount } from './accountRouting';

const KEY = 'codexvs.namedAccounts';

type Store = { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> };

export class NamedAccountRegistry<B extends { dispose(): void }> {
  private accounts: NamedAccount[];
  private readonly backends = new Map<string, B>();
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly store: Store, private readonly createBackend: (id: string) => B) {
    const saved = store.get(KEY);
    if (saved === undefined) {
      this.accounts = [];
      return;
    }
    if (!Array.isArray(saved)) throw new Error('Invalid account metadata');
    const ids = new Set<string>();
    const labels = new Set<string>();
    this.accounts = saved.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) throw new Error('Invalid account metadata');
      const { id, label } = entry as { id?: unknown; label?: unknown };
      if (!isAccountStorageId(id) || ids.has(id) || typeof label !== 'string' || !label.trim() || labels.has(label.trim())) {
        throw new Error('Invalid account metadata');
      }
      ids.add(id);
      labels.add(label.trim());
      return { id, label: label.trim() };
    });
  }

  list(): readonly NamedAccount[] {
    return this.accounts.map(({ id, label }) => ({ id, label }));
  }

  get(id: string): B | undefined {
    if (this.disposed || !this.accounts.some((account) => account.id === id)) return undefined;
    let backend = this.backends.get(id);
    if (!backend) {
      backend = this.createBackend(id);
      this.backends.set(id, backend);
    }
    return backend;
  }

  add(label: string): Promise<NamedAccount> {
    const operation = this.pending.then(async () => {
      if (this.disposed) throw new Error('Account registry is disposed');
      const normalized = label.trim();
      if (!normalized || this.accounts.some((account) => account.label === normalized)) throw new Error('Invalid or duplicate account label');
      let id: string;
      do { id = randomUUID(); } while (this.accounts.some((account) => account.id === id));
      const account = { id, label: normalized };
      const next = [...this.accounts, account];
      await this.store.update(KEY, next.map((item) => ({ ...item })));
      this.accounts = next;
      return { ...account };
    });
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const backend of this.backends.values()) backend.dispose();
    this.backends.clear();
  }
}
