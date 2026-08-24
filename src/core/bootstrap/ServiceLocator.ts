/**
 * Explicit dependency registry.
 *
 * Not a magic global: services are registered once at bootstrap and looked up by a typed token, so
 * "what does this system depend on" is answerable by grepping for the token. STYLE-GUIDE.md forbids
 * module-level side effects, which rules out the usual singleton-per-module habit.
 *
 * Resolving an unregistered token throws rather than returning undefined — a missing service is a
 * wiring bug and should be loud at startup, not silently absent at frame 4000.
 */

export interface ServiceToken<T> {
  readonly description: string;
  /** Phantom field carrying the service type; never read at runtime. */
  readonly __type?: T;
}

export const serviceToken = <T>(description: string): ServiceToken<T> => ({ description });

export class ServiceLocator {
  private readonly services = new Map<ServiceToken<unknown>, unknown>();

  register<T>(token: ServiceToken<T>, instance: T): void {
    if (this.services.has(token as ServiceToken<unknown>)) {
      throw new Error(`Service already registered: ${token.description}`);
    }
    this.services.set(token as ServiceToken<unknown>, instance);
  }

  /** Replace an existing registration. Tests and scene teardown only. */
  override<T>(token: ServiceToken<T>, instance: T): void {
    this.services.set(token as ServiceToken<unknown>, instance);
  }

  resolve<T>(token: ServiceToken<T>): T {
    const found = this.services.get(token as ServiceToken<unknown>);
    if (found === undefined) {
      throw new Error(`Service not registered: ${token.description}`);
    }
    return found as T;
  }

  tryResolve<T>(token: ServiceToken<T>): T | undefined {
    return this.services.get(token as ServiceToken<unknown>) as T | undefined;
  }

  has(token: ServiceToken<unknown>): boolean {
    return this.services.has(token);
  }

  clear(): void {
    this.services.clear();
  }
}

/** The container built by GameBootstrap. */
export const services = new ServiceLocator();
