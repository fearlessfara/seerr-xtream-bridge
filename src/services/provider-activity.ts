export interface XtreamSource {
  id: string;
  name?: string;
  maxConnections?: number;
}

export interface ProviderActivityService {
  canAcquire(source: XtreamSource): Promise<boolean>;
}

/** v1: always allow. Future: Dispatcharr-aware coordination. */
export class AlwaysAllowProviderActivity implements ProviderActivityService {
  async canAcquire(_source: XtreamSource): Promise<boolean> {
    return true;
  }
}
