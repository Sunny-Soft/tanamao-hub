import { Injectable } from '@angular/core';
import { ProgramHandler } from '../types/ProgramHandler';
import { PostgresHandler } from './handlers/postgres.handler';
import { PostgisHandler } from './handlers/postgis.handler';
import { TanamaoFoodHandler } from './handlers/tanamao-food.handler';

@Injectable({
  providedIn: 'root'
})
export class ProgramRegistryService {
  private handlersMap = new Map<string, ProgramHandler>();

  constructor(
    private postgres: PostgresHandler,
    private postgis: PostgisHandler,
    private tanamaoFood: TanamaoFoodHandler,
  ) {
    const registry = [this.postgres, this.postgis, this.tanamaoFood];
    registry.forEach(h => this.handlersMap.set(h.programId, h));
  }

  get handlers(): ProgramHandler[] {
    return Array.from(this.handlersMap.values());
  }

  getHandler(id: string): ProgramHandler | undefined {
    return this.handlersMap.get(id);
  }
}
