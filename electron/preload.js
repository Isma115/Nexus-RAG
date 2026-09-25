const path = require('node:path');
const { contextBridge } = require('electron');

// API mínima expuesta al renderer (la UI actual funciona vía fetch HTTP,
// esto solo deja un puente preparado sin romper nada).
contextBridge.exposeInMainWorld('nexus', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
