// Log capture system — intercepts console.log/warn/error and stores recent entries.

const createLogCapture = (maxLogs = 500) => {
    let logs = [];

    const addLog = (level, msg) => {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
        logs.push({ id: Date.now() + Math.random(), time: timestamp, level, text: msg });
        if (logs.length > maxLogs) logs.shift();
    };

    const getLogs = () => logs;

    const clearLogs = () => { logs = []; };

    const installConsoleOverrides = () => {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args) => {
            addLog('info', args.join(' '));
            originalLog(...args);
        };
        console.warn = (...args) => {
            addLog('warn', args.join(' '));
            originalWarn(...args);
        };
        console.error = (...args) => {
            addLog('error', args.join(' '));
            originalError(...args);
        };

        return () => {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
        };
    };

    return { getLogs, addLog, clearLogs, installConsoleOverrides };
};

module.exports = { createLogCapture };
