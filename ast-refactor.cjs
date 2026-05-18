const fs = require('fs');
const acorn = require('acorn');
const astring = require('astring');

const utils = require('./backend/utils.cjs');
const auth = require('./backend/auth.cjs');
const logger = require('./backend/logger.cjs');
const syncUtils = require('./backend/sync-utils.cjs');
const defectdojoClient = require('./backend/defectdojo-client.cjs');
const redmineClient = require('./backend/redmine-client.cjs');
const compaction = require('./backend/compaction.cjs');

const extractedKeys = new Set([
    ...Object.keys(utils),
    ...Object.keys(auth),
    ...Object.keys(logger),
    ...Object.keys(syncUtils),
    ...Object.keys(defectdojoClient),
    ...Object.keys(redmineClient),
    ...Object.keys(compaction),
    'globalLogs', 'MAX_LOGS', 'originalLog', 'originalWarn', 'originalError',
    'requireAuth', 'requireAdmin'
]);

const serverCode = fs.readFileSync('./backend/server.cjs', 'utf-8');

const ast = acorn.parse(serverCode, { ecmaVersion: 2022, locations: true, sourceType: 'script' });

// We want to remove top-level VariableDeclarations and FunctionDeclarations whose names are in extractedKeys
const newBody = [];
let removedNames = [];

for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') {
        // Only keep declarators that are NOT in the extractedKeys
        const newDeclarators = node.declarations.filter(decl => {
            if (decl.id.type === 'Identifier') {
                if (extractedKeys.has(decl.id.name)) {
                    removedNames.push(decl.id.name);
                    return false;
                }
            }
            return true;
        });

        if (newDeclarators.length > 0) {
            newBody.push({ ...node, declarations: newDeclarators });
        }
    } else if (node.type === 'FunctionDeclaration') {
        if (extractedKeys.has(node.id.name)) {
            removedNames.push(node.id.name);
        } else {
            newBody.push(node);
        }
    } else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression') {
        // e.g. console.log = (...args) => ...
        const left = node.expression.left;
        if (left.type === 'MemberExpression' && left.object.name === 'console') {
            if (['log', 'warn', 'error'].includes(left.property.name)) {
                // This is the console override, remove it
                removedNames.push(`console.${left.property.name} override`);
                continue; // Skip adding to newBody
            }
        }
        newBody.push(node);
    } else {
        newBody.push(node);
    }
}

ast.body = newBody;
console.log('Removed top-level identifiers:', removedNames.join(', '));

// Generate the new code
let newCode = astring.generate(ast, {
    indent: '    ',
    lineEnd: '\n',
    comments: true
});

fs.writeFileSync('./backend/server.cjs.ast', newCode);
console.log('AST generated output saved to backend/server.cjs.ast');
