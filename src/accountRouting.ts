import { isAccountStorageId } from './appServer/accountStorage';
import type { ResolvedProviderModel } from './models';

const ACCOUNT_MODEL_PREFIX = 'codex-account::';

export interface NamedAccount {
  readonly id: string;
  readonly label: string;
}

export type AccountRoute =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'named'; readonly accountId: string; readonly catalogId: string };

export function parseAccountRoute(id: string): AccountRoute {
  if (!id.startsWith(ACCOUNT_MODEL_PREFIX)) return { kind: 'legacy' };
  const tail = id.slice(ACCOUNT_MODEL_PREFIX.length);
  const separator = tail.indexOf('::');
  if (separator < 0) return { kind: 'invalid' };
  const accountId = tail.slice(0, separator);
  const catalogId = tail.slice(separator + 2);
  if (!isAccountStorageId(accountId) || !catalogId) return { kind: 'invalid' };
  return { kind: 'named', accountId, catalogId };
}

export function qualifyAccountModel(model: ResolvedProviderModel, account: NamedAccount): ResolvedProviderModel {
  return {
    ...model,
    info: {
      ...model.info,
      id: `${ACCOUNT_MODEL_PREFIX}${account.id}::${model.catalogId}`,
      name: `${model.info.name} · ${account.label}`
    }
  };
}

export function findAccountModel(id: string, models: readonly ResolvedProviderModel[]): ResolvedProviderModel | undefined {
  return models.find((model) => model.info.id === id);
}
