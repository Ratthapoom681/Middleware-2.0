const createAuthRoutes = require('./auth.cjs');
const createConfigRoutes = require('./config.cjs');
const createFindingsRoutes = require('./findings.cjs');
const createMitigationRoutes = require('./mitigation.cjs');
const createRedmineRoutes = require('./redmine.cjs');
const createSyncRoutes = require('./sync.cjs');
const createSystemRoutes = require('./system.cjs');

const registerApiRoutes = (app, ctx) => {
    app.use('/api', createAuthRoutes(ctx));
    app.use('/api', ctx.requireAuth);

    app.use('/api', createConfigRoutes(ctx));
    app.use('/api', createSystemRoutes(ctx));
    app.use('/api', createMitigationRoutes(ctx));
    app.use('/api/redmine', createRedmineRoutes(ctx));
    app.use('/api', createSyncRoutes(ctx));
    app.use('/api', createFindingsRoutes(ctx));
};

module.exports = {
    registerApiRoutes
};
