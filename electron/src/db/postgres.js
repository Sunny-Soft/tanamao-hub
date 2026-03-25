// Conexão com o banco postgres
import pkg from 'pg'
import { getConfigs } from '../utils/config.js'

const { Pool } = pkg

const configs = getConfigs()

const pool = new Pool({
    host: configs.host || 'localhost',
    port: configs.port || 5432,
    user: configs.user || 'postgres',
    password: configs.password || 'admin',
    database: configs.database || 'dados'
})

export default pool