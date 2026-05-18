const fs = require('fs');

const utils = require('./backend/utils.cjs');
const auth = require('./backend/auth.cjs');
const logger = require('./backend/logger.cjs');
const syncUtils = require('./backend/sync-utils.cjs');
const defectdojoClient = require('./backend/defectdojo-client.cjs');
const redmineClient = require('./backend/redmine-client.cjs');
const compaction = require('./backend/compaction.cjs');

const allKeys = [
    ...Object.keys(utils),
    ...Object.keys(auth),
    ...Object.keys(logger),
    ...Object.keys(syncUtils),
    ...Object.keys(defectdojoClient),
    ...Object.keys(redmineClient),
    ...Object.keys(compaction)
];

// Special cases that shouldn't be deleted or need special handling
const dontDelete = new Set([
    'requireAdmin', // Factory renamed this, but route handlers might use the old name if we just delete it. We'll replace it.
    'createRequireAuth' // It was `requireAuth` in server.cjs
]);

let serverCode = fs.readFileSync('./backend/server.cjs', 'utf-8');
const lines = serverCode.split('\n');

const toDelete = new Set(allKeys.filter(k => !dontDelete.has(k)));
toDelete.add('requireAuth'); // Handle the rename in auth.cjs

// Also we extracted some constants.
// Let's find exactly where each top-level const or let is.
let i = 0;
while (i < lines.length) {
    const line = lines[i];
    let match = line.match(/^(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*/);
    
    // Also match function definitions if any (though most are const arrow functions)
    if (!match) {
        match = line.match(/^function\s+([a-zA-Z0-9_]+)\s*\(/);
    }
    
    if (match) {
        const name = match[1];
        if (toDelete.has(name)) {
            // Count braces and parens to find the end of this definition
            let openBraces = 0;
            let openParens = 0;
            let inString = false;
            let stringChar = '';
            
            let j = i;
            let foundSemicolonAtZero = false;
            
            while (j < lines.length) {
                const currentLine = lines[j];
                for (let c = 0; c < currentLine.length; c++) {
                    const char = currentLine[c];
                    if (!inString && (char === "'" || char === '"' || char === '`')) {
                        inString = true;
                        stringChar = char;
                    } else if (inString && char === stringChar && currentLine[c-1] !== '\\') {
                        inString = false;
                    } else if (!inString) {
                        if (char === '{') openBraces++;
                        if (char === '}') openBraces--;
                        if (char === '(') openParens++;
                        if (char === ')') openParens--;
                    }
                    
                    if (!inString && openBraces === 0 && openParens === 0 && char === ';') {
                        foundSemicolonAtZero = true;
                    }
                }
                
                // If we reach brace 0, paren 0, and we are not on the first line (or we are but it closed), and we found a semicolon, we are done.
                if (openBraces === 0 && openParens === 0 && (!inString) && (j > i || foundSemicolonAtZero)) {
                    // Delete from i to j
                    for (let del = i; del <= j; del++) {
                        lines[del] = null;
                    }
                    i = j;
                    break;
                }
                j++;
            }
        }
    }
    i++;
}

const cleanedLines = lines.filter(l => l !== null);
let newCode = cleanedLines.join('\n');

// Now we need to inject the requires at the top, and initialize the logger and auth
const requires = `
const utils = require('./utils.cjs');
const auth = require('./auth.cjs');
const logger = require('./logger.cjs');
const syncUtils = require('./sync-utils.cjs');
const defectdojoClient = require('./defectdojo-client.cjs');
const redmineClient = require('./redmine-client.cjs');
const compaction = require('./compaction.cjs');

// Expose these into the global or module scope so that the remaining server.cjs functions can access them
// Since the original functions were local variables, the easiest migration without rewriting all call sites
// is to destructure everything we imported.
const { ${Object.keys(utils).join(', ')} } = utils;
const { ${Object.keys(logger).join(', ')} } = logger;
const { ${Object.keys(syncUtils).join(', ')} } = syncUtils;
const { ${Object.keys(defectdojoClient).join(', ')} } = defectdojoClient;
const { ${Object.keys(redmineClient).join(', ')} } = redmineClient;
const { ${Object.keys(compaction).join(', ')} } = compaction;

// Special cases for auth
const { hashPassword, verifyPassword, readUsersFromDisk, createDefaultAdminUser, createRequireAuth, requireAdmin } = auth;
`;

// Insert after the last existing require
newCode = newCode.replace(/(const database = require\('\.\/database\.cjs'\);)/, '$1' + requires);

// Setup Logger intercept
newCode = newCode.replace(
    /const originalLog = console\.log;[\s\S]*?console\.error = originalError;[\s\S]*?};/g, 
    '// Logger intercept removed'
);

fs.writeFileSync('./backend/server.cjs.new', newCode);
console.log('Done refactoring server.cjs into server.cjs.new');
