import { Injectable } from '@angular/core';
import { BaseHandler } from './base.handler';
import { Program } from '../../types/Program';

@Injectable({ providedIn: 'root' })
export class PostgisHandler extends BaseHandler {
    readonly programId = 'postgis';

    override init(onProgress: (id: string, status: Program['status'], progress?: number, message?: string) => void): void {
        super.init(onProgress);
    }
}
