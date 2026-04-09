const fs = require('fs');
const path = require('path');

// Configuration
const SRC_FILE = path.join(__dirname, 'src', 'pages', 'app.html');
const DEST_FILE = path.join(__dirname, 'index.html');

/**
 * Syncs app.html to index.html with path adjustments for root deployment.
 */
function build() {
    console.log('Syncing src/pages/app.html to index.html...');

    if (!fs.existsSync(SRC_FILE)) {
        console.error(`Error: Source file not found at ${SRC_FILE}`);
        process.exit(1);
    }

    try {
        let content = fs.readFileSync(SRC_FILE, 'utf8');

        // Path replacements for root deployment:
        // 1. ../../public/ -> public/
        // 2. ../(lib|scripts|styles)/ -> src/$1/
        
        content = content
            .replace(/\.\.\/\.\.\/public\//g, 'public/')
            .replace(/\.\.\/(lib|scripts|styles)\//g, 'src/$1/');

        fs.writeFileSync(DEST_FILE, content, 'utf8');
        console.log('Success: index.html has been updated.');
    } catch (err) {
        console.error('Error during build:', err.message);
        process.exit(1);
    }
}

build();
