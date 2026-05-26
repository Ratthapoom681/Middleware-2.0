const express = require('express');

module.exports = function(ctx) {
    const router = express.Router();

    router.use('/config', ctx.requireAuth, ctx.requireAdmin);

    router.get('/config', (req, res) => {
        res.json(ctx.getConfig());
    });

    router.get('/config/backups', async (req, res) => {
        try {
            res.json(await ctx.listConfigBackups());
        } catch (error) {
            console.error('Error listing config backups:', error);
            res.status(500).json({
                error: 'Failed to list config backups',
                details: error.message
            });
        }
    });

    router.get('/config/backups/:fileName/export', async (req, res) => {
        try {
            const {fileName} = req.params;
            if (!ctx.isSafeConfigBackupFileName(fileName)) {
                return res.status(400).json({
                    error: 'Backup fileName is required'
                });
            }
            const backupConfig = await ctx.readConfigBackup(fileName);
            if (!backupConfig) {
                return res.status(404).json({
                    error: 'Backup file not found'
                });
            }
            const backup = (await ctx.listConfigBackups()).find(item => item.fileName === fileName);
            const exportPayload = ctx.createConfigBackupExport({
                fileName,
                label: ctx.getBackupLabelFromFileName(fileName),
                sourceConfig: backupConfig,
                createdAt: backup?.createdAt
            });
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(JSON.stringify(exportPayload, null, 2));
        } catch (error) {
            console.error('Error exporting config backup:', error);
            res.status(500).json({
                error: 'Failed to export config backup',
                details: error.message
            });
        }
    });

    router.post('/config/backup', async (req, res) => {
        try {
            const backup = await ctx.writeConfigBackup(ctx.getConfig(), 'manual');
            res.json({
                message: 'Configuration backup created',
                backup
            });
        } catch (error) {
            console.error('Error backing up config:', error);
            res.status(500).json({
                error: 'Failed to backup config',
                details: error.message
            });
        }
    });

    router.get('/config/export', (req, res) => {
        const fileName = `defectdojo-viewer-config-${ctx.getBackupTimestamp()}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(JSON.stringify(ctx.getConfig(), null, 2));
    });

    router.post('/config/import', async (req, res) => {
        try {
            const importedConfig = ctx.extractConfigFromBackupPayload(req.body);
            if (!importedConfig) {
                return res.status(400).json({
                    error: 'Config JSON body is required'
                });
            }
            const previousScanPath = ctx.getConfig().scanPath;
            const backup = await ctx.writeConfigBackup(ctx.getConfig(), 'pre-import');
            ctx.setConfig(ctx.normalizeConfigObject(importedConfig));
            await ctx.saveConfigToDisk();
            await ctx.afterConfigChanged(previousScanPath, 'config-imported');
            res.json({
                message: 'Configuration imported',
                config: ctx.getConfig(),
                backup
            });
        } catch (error) {
            console.error('Error importing config:', error);
            res.status(500).json({
                error: 'Failed to import config',
                details: error.message
            });
        }
    });

    router.post('/config/restore', async (req, res) => {
        try {
            const fileName = String(req.body?.fileName || '');
            if (!ctx.isSafeConfigBackupFileName(fileName)) {
                return res.status(400).json({
                    error: 'Backup fileName is required'
                });
            }
            const restoredConfig = await ctx.readConfigBackup(fileName);
            if (!restoredConfig) {
                return res.status(404).json({
                    error: 'Backup file not found'
                });
            }
            const currentBackup = await ctx.writeConfigBackup(ctx.getConfig(), 'pre-restore');
            const previousScanPath = ctx.getConfig().scanPath;
            ctx.setConfig(ctx.normalizeConfigObject(restoredConfig));
            await ctx.saveConfigToDisk();
            await ctx.afterConfigChanged(previousScanPath, 'config-restored');
            res.json({
                message: 'Configuration restored',
                config: ctx.getConfig(),
                backup: currentBackup
            });
        } catch (error) {
            console.error('Error restoring config:', error);
            res.status(500).json({
                error: 'Failed to restore config',
                details: error.message
            });
        }
    });

    router.post('/config', async (req, res) => {
        try {
            const previousScanPath = ctx.getConfig().scanPath;
            const backup = await ctx.writeConfigBackup(ctx.getConfig(), 'pre-save');
            ctx.setConfig(ctx.normalizeConfigObject(req.body || ({})));
            await ctx.saveConfigToDisk();
            await ctx.afterConfigChanged(previousScanPath, 'config-saved');
            res.json({
                message: 'Configuration updated',
                config: ctx.getConfig(),
                backup
            });
        } catch (error) {
            console.error('Error updating config:', error);
            res.status(500).json({
                error: 'Failed to update config',
                details: error.message
            });
        }
    });

    return router;
};
