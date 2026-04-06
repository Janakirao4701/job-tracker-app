# deploy.ps1
# This script automatically syncs app.html to index.html and pushes all updates to the live site.

Write-Host "Syncing app.html changes into index.html..." -ForegroundColor Cyan

# 1. Sync app.html to index.html with correct root paths
$appContent = Get-Content src/pages/app.html

# Fix paths:
# ../../public/ -> public/
# ../lib/ -> src/lib/
# ../scripts/ -> src/scripts/
# ../styles/ -> src/styles/
$indexContent = $appContent -replace '\.\./\.\./public/', 'public/' -replace '\.\./(lib|scripts|styles)/', 'src/$1/'

$indexContent | Set-Content index.html

Write-Host "Sync Complete! Deploying to GitHub..." -ForegroundColor Cyan

# 3. Add all file changes to Git
git add .

# 4. Commit them with a descriptive message
git commit -m "fix(blaze): switch to stable v1 API and add model selector"

# 5. Push to GitHub (This automatically triggers Vercel and GitHub pages)
git push

Write-Host "Deployment Successful! The live URL will update in ~60 seconds." -ForegroundColor Green
