const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getPrograms: () => ipcRenderer.invoke('programs:get'),
    postgresInstall: () => ipcRenderer.invoke('postgres:install'),
    postgresRunning: () => ipcRenderer.invoke('postgres:running'),
    postgresVersion: () => ipcRenderer.invoke('postgres:version'),
    postgresStart: () => ipcRenderer.invoke('postgres:start'),
    postgresStop: () => ipcRenderer.invoke('postgres:stop'),
    postgresUninstall: () => ipcRenderer.invoke('postgres:uninstall'),
    postgresTestConnection: (config) => ipcRenderer.invoke('postgres:test-connection', config),
    onPostgresProgress: (callback) => ipcRenderer.on('postgres:progress', (event, value) => callback(value)),
    tanamaoFoodOpen: () => ipcRenderer.invoke('tanamao-food:open'),
    tanamaoFoodIsInstalled: () => ipcRenderer.invoke('tanamao-food:is-installed'),
    tanamaoFoodIsRunning: () => ipcRenderer.invoke('tanamao-food:is-running'),
    tanamaoFoodInstall: (installDir) => ipcRenderer.invoke('tanamao-food:install', installDir),
    tanamaoFoodVersion: () => ipcRenderer.invoke('tanamao-food:version'),
    onTanamaoFoodProgress: (callback) => ipcRenderer.on('tanamao-food:progress', (event, value) => callback(value)),
    tanamaoFoodSetupDatabase: () => ipcRenderer.invoke('tanamao-food:setup-database'),
    tanamaoFoodUninstall: () => ipcRenderer.invoke('tanamao-food:uninstall'),

    onTanamaoFoodConfigProgress: (callback) => ipcRenderer.on('tanamao-food:config:progress', (event, value) => callback(value)),
    configsSave: (configs) => ipcRenderer.invoke('configs:save', configs),
    configsGet: () => ipcRenderer.invoke('configs:get'),

    postgresSetup: () => ipcRenderer.invoke('postgres:setup'),
    onPostgresConfigProgress: (callback) => ipcRenderer.on('postgres:config:progress', (event, value) => callback(value)),

    logsGet: (programId) => ipcRenderer.invoke('logs:get', programId),
    logsList: () => ipcRenderer.invoke('logs:list'),
    logsWatch: (programId) => ipcRenderer.send('logs:watch', programId),
    logsUnwatch: () => ipcRenderer.send('logs:unwatch'),
    onLogsUpdate: (callback) => ipcRenderer.on('logs:update', (event, data) => callback(data)),

    programConfigGet: (programId) => ipcRenderer.invoke('program:config:get', programId),
    programConfigSave: (programId, config) => ipcRenderer.invoke('program:config:save', programId, config),
});
