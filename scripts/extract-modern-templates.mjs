import * as t from '../plugins/qq-chat-exporter/lib/core/exporter/ModernHtmlTemplates.js';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

const files = {
    'modern_css.css': t.MODERN_CSS,
    'modern_toolbar.html': t.MODERN_TOOLBAR_HTML,
    'modern_footer.html': t.MODERN_FOOTER_HTML,
    'modern_single_app.js': t.MODERN_SINGLE_APP_JS,
    'modern_single_scripts.html': t.MODERN_SINGLE_SCRIPTS_HTML,
    'modern_single_top.html': t.MODERN_SINGLE_HTML_TOP_TEMPLATE,
    'modern_single_bottom.html': t.MODERN_SINGLE_HTML_BOTTOM_TEMPLATE,
    'modern_chunked_index.html': t.MODERN_CHUNKED_INDEX_HTML_TEMPLATE,
    'modern_chunked_app.js': t.MODERN_CHUNKED_APP_JS,
};

for (const [name, content] of Object.entries(files)) {
    if (typeof content !== 'string') throw new Error(`missing template: ${name}`);
    fs.writeFileSync(path.join(outDir, name), content);
    console.log(`${name}: ${content.length} chars`);
}
