const sharp = require('sharp');
const fs = require('fs');

async function generateLargeIcons() {
  const source = 'icons/icon128.png';
  const sizes = [
    { size: 192, name: 'icons/icon192.png' },
    { size: 512, name: 'icons/icon512.png' },
  ];

  for (const { size, name } of sizes) {
    if (fs.existsSync(name)) fs.unlinkSync(name);
    await sharp(source)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(name);
    console.log(`Created ${name} (${size}x${size})`);
  }
}

generateLargeIcons().catch(console.error);
