import * as fs from 'fs';
let content = fs.readFileSync('LASTPLAN.md', 'utf8');
content = content.replace('prÃ¼fen', 'pruefen');
fs.writeFileSync('LASTPLAN.md', content);
