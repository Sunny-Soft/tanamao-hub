import { initPostgresApi } from '../api/postgree.js';
import { initTanamaoFoodApi } from '../api/tanamao-food.js';

export const programRegistry = [
    {
        program: {
            id: 'postgresql',
            name: 'PostgreSQL',
            icon: 'storage',
            type: 'service',
            description: 'Banco de dados principal do sistema.'
        },
        initApi: initPostgresApi
    },
    {
        program: {
            id: 'tanamao-food',
            name: 'Tanamao Food',
            icon: 'restaurant',
            type: 'app',
            description: 'Sistema de gestão para restaurantes.'
        },
        initApi: initTanamaoFoodApi
    }
];
