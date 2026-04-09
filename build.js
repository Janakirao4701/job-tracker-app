const fs = require('fs');
const path = require('path');

// Configuration
const PAGES = [
    {
        src: path.join(__dirname, 'src', 'pages', 'landing.html'),
        dest: path.join(__dirname, 'index.html'),
        name: 'landing.html → index.html'
    },
    {
        src: path.join(__dirname, 'src', 'pages', 'app.html'),
        dest: path.join(__dirname, 'dashboard.html'),
        name: 'app.html → dashboard.html'
    }
];

/**
 * Syncs source pages to root with path adjustments for deployment.
 */
function build() {
    let hasError = false;

    for (const page of PAGES) {
        console.log(`Syncing ${page.name}...`);

        if (!fs.existsSync(page.src)) {
            console.error(`Error: Source file not found at ${page.src}`);
            hasError = true;
            continue;
        }

        try {
            let content = fs.readFileSync(page.src, 'utf8');

            // Path replacements for root deployment:
            // 1. ../../public/ -> public/
            // 2. ../(lib|scripts|styles)/ -> src/$1/
            // 3. href="app.html" -> dashboard.html
            // 4. href="landing.html" -> index.html
            content = content
                .replace(/\.\.\/\.\.\/public\//g, 'public/')
                .replace(/\.\.\/(lib|scripts|styles)\//g, 'src/$1/')
                .replace(/href="app\.html"/g, 'href="dashboard.html"')
                .replace(/href="landing\.html"/g, 'href="index.html"');

            fs.writeFileSync(page.dest, content, 'utf8');
            console.log(`Success: ${page.name} updated.`);
        } catch (err) {
            console.error(`Error building ${page.name}:`, err.message);
            hasError = true;
        }
    }

    if (hasError) {
        process.exit(1);
    }
}

build();
