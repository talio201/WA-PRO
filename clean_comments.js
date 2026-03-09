const fs = require('fs');
const path = require('path');

function removeJsComments(code) {
    // Removemos // e /* */
    // Essa Regex cobre multiline e evita conflito com urls em aspas simples e duplas.
    return code.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm, '').replace(/^\s*[\r\n]/gm, '');
}

function removePyComments(code) {
    let lines = code.split('\n');
    let inMulti = false;
    let newLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let trimmed = line.trim();
        
        // Remove blocos de docstrings """..."""
        if (trimmed.startsWith('"""') && trimmed.endsWith('"""') && trimmed.length > 3) {
            continue;
        }
        
        if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
            inMulti = !inMulti;
            continue;
        }
        
        if (inMulti) continue;
        
        // Remove comentarios normais # no começo ou ao lado, preservando se tiver aspas
        // Aqui assumimos padrao clean limitando regex pra não quebrar URLs no Python
        if (trimmed.startsWith('#')) continue;
        
        const hashIndex = line.indexOf('#');
        if (hashIndex !== -1 && !line.includes("'") && !line.includes('"')) {
            line = line.substring(0, hashIndex);
        }
        
        if (line.trim() !== '') {
            newLines.push(line);
        }
    }
    return newLines.join('\n');
}

function crawlAndClean(dir) {
    const list = fs.readdirSync(dir);
    
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat && stat.isDirectory()) {
            if (!fullPath.includes('node_modules') && !fullPath.includes('.git') && !fullPath.includes('.next')) {
                crawlAndClean(fullPath);
            }
        } else {
            if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
                const code = fs.readFileSync(fullPath, 'utf8');
                const cleaned = removeJsComments(code);
                if (code.length !== cleaned.length) {
                    fs.writeFileSync(fullPath, cleaned, 'utf8');
                    console.log('Cleaned JS:', fullPath);
                }
            } else if (fullPath.endsWith('.py')) {
                const code = fs.readFileSync(fullPath, 'utf8');
                const cleaned = removePyComments(code);
                if (code.length !== cleaned.length) {
                    fs.writeFileSync(fullPath, cleaned, 'utf8');
                    console.log('Cleaned PY:', fullPath);
                }
            }
        }
    });
}

const foldersToClean = [
    path.join(__dirname, 'backend', 'src'),
    path.join(__dirname, 'extension', 'src'),
    path.join(__dirname, 'python_bot')
];

foldersToClean.forEach(folder => {
    if (fs.existsSync(folder)) {
        crawlAndClean(folder);
    }
});

console.log('Varredura Clean Code: OK');
